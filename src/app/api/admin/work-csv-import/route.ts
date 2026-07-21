import { NextRequest, NextResponse } from 'next/server';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllWorks, saveWork, upsertManualCsvVodProviders } from '@/lib/work-store';
import { normalizeWorkTitle } from '@/lib/work-processor';
import { normalizeProviderName } from '@/lib/vod-dedup';
import type { WorkRecord, WorkType, DisplayWorkType } from '@/types/work';
import type { VodProvider, VodProviderType } from '@/types/vod';
import { normalizeDisplayWorkType, DISPLAY_WORK_TYPE_LABEL } from '@/lib/work-display-type';

// POST /api/admin/work-csv-import
// body: { csvContent: string, commit?: boolean, personName?: string }
//
// CSVフォーマット（列順自由・余分な列可）:
//   必須: workTitle（または title）, workType（または type）
//   任意: personId / personName, releaseYear, roleName,
//         vodService, availabilityType, sourceUrl, confidence, note
//
// 同一人物・同一タイトルの行が複数ある場合 → 1作品に複数の配信サービスを追加
// vodService が空または "unknown" の行 → 作品は追加するが配信情報はスキップ
// 配信情報の重複（同一作品・同一vodService で source=manual_csv）はスキップ
//
// source = manual_csv / status = auto_published で登録

// ─────────────────────────────────────────
// 型
// ─────────────────────────────────────────

export interface WorkImportPreviewRow {
  rowNum: number;
  personName: string;
  workTitle: string;
  workType: string;
  releaseYear: string;
  roleName: string;
  // 表示カテゴリ
  workDisplayType: string;         // CSV から読んだ生の値（空文字可）
  resolvedDisplayType?: string;    // 正規化後の内部値（バリデーション通過時のみ）
  displayTypeLabel?: string;       // 日本語ラベル（プレビュー表示用）
  displayTypeWarning?: string;     // 不正値の警告メッセージ
  displayTypeAction?: 'set' | 'update' | 'unchanged' | 'none'; // 既存作品への更新状況
  // 作品操作
  action: 'add' | 'existing' | 'error';
  reason: string;
  // VOD 情報
  vodService: string;
  availabilityType: string;
  sourceUrl: string;
  confidence: string;
  note: string;
  vodAction: 'add' | 'skip' | 'none';
  vodSkipReason?: string;
}

// ─────────────────────────────────────────
// 定数
// ─────────────────────────────────────────

const TYPE_MAP: Record<string, WorkType> = {
  // ── movie ──
  movie: 'movie', 映画: 'movie', film: 'movie', motion_picture: 'movie',

  // ── tv（catch-all） ──
  tv: 'tv',
  drama: 'tv', ドラマ: 'tv', drama_series: 'tv', tv_drama: 'tv',
  series: 'tv', テレビ: 'tv', television: 'tv',
  variety: 'tv', バラエティ: 'tv', variety_show: 'tv',
  web: 'tv', web_series: 'tv', web_drama: 'tv', ott: 'tv', streaming: 'tv',
  配信: 'tv', 配信番組: 'tv', 配信限定: 'tv', web番組: 'tv',
  documentary: 'tv', ドキュメンタリー: 'tv', documentary_series: 'tv',
  special: 'tv', 特番: 'tv', スペシャル: 'tv', tv_special: 'tv',
  番組: 'tv', テレビ番組: 'tv', バラエティ番組: 'tv', 情報番組: 'tv', トーク番組: 'tv',
  stage: 'tv', 舞台: 'tv', 舞台映像: 'tv', stage_play: 'tv', musical: 'tv',
  animation: 'tv', anime: 'tv', アニメ: 'tv', animated_series: 'tv',
  reality: 'tv', reality_show: 'tv', game_show: 'tv',
  talk: 'tv', talk_show: 'tv', music: 'tv', music_video: 'tv',
  miniseries: 'tv', limited_series: 'tv', short: 'tv',
};

const AVAILABILITY_TYPE_MAP: Record<string, VodProviderType> = {
  flatrate: 'flatrate', 見放題: 'flatrate', subscription: 'flatrate',
  buy: 'buy', purchase: 'buy', 購入: 'buy',
  rent: 'rent', rental: 'rent', レンタル: 'rent',
  free: 'free', 無料: 'free',
  ads: 'ads', ad: 'ads', 広告: 'ads', 広告付き: 'ads', avod: 'ads',
  unknown: 'unknown', '': 'unknown',
};

const CONFIDENCE_MAP: Record<string, 'high' | 'medium' | 'low'> = {
  high: 'high', 高: 'high',
  medium: 'medium', mid: 'medium', 中: 'medium',
  low: 'low', 低: 'low',
};

// 列名エイリアス
const COL_ALIASES: Record<string, string[]> = {
  worktitle:       ['worktitle', 'title'],
  worktype:        ['worktype', 'type'],
  workdisplaytype: ['workdisplaytype', 'workgenre', 'displaycategory', 'displaytype', 'genrelabel'],
};

function findColIndex(header: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = header.indexOf(c);
    if (idx >= 0) return idx;
  }
  return -1;
}

const EXAMPLE_CSV = `personName,workTitle,workType,releaseYear,roleName,workDisplayType,vodService,availabilityType,sourceUrl,confidence,note
賀喜遥香,乃木坂スター誕生！SIX,tv,2025,本人,idol_show,,,,,
賀喜遥香,ドラマタイトル,drama,2023,主人公,drama,Netflix,flatrate,,high,
賀喜遥香,映画タイトル,movie,2022,,movie,,,,, `;

// ─────────────────────────────────────────
// CSV パーサー（RFC 4180・BOM対応）
// ─────────────────────────────────────────

function parseCSV(content: string): string[][] {
  const normalized = content
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  return normalized
    .split('\n')
    .map((line) => {
      const fields: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (line[i + 1] === '"') { current += '"'; i++; }
            else inQuotes = false;
          } else current += ch;
        } else {
          if (ch === '"') inQuotes = true;
          else if (ch === ',') { fields.push(current); current = ''; }
          else current += ch;
        }
      }
      fields.push(current);
      return fields;
    })
    .filter((row) => row.some((f) => f.trim() !== ''));
}

// ─────────────────────────────────────────
// workId 生成
// ─────────────────────────────────────────

function generateWorkCsvId(type: WorkType, normalizedTitle: string): string {
  return `csv-${type}-${normalizedTitle.slice(0, 32)}`;
}

// ─────────────────────────────────────────
// ハンドラー
// ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    csvContent,
    commit = false,
    personName: bodyPersonName = '',
  } = body as {
    csvContent?: string;
    commit?: boolean;
    personName?: string;
  };

  if (!csvContent || typeof csvContent !== 'string') {
    return NextResponse.json({ error: 'csvContent が必要です' }, { status: 400 });
  }

  // ── CSV パース ──
  const rows = parseCSV(csvContent);
  if (rows.length < 2) {
    return NextResponse.json({ error: 'CSVが空またはヘッダー行のみです' }, { status: 400 });
  }

  const rawHeader = rows[0];
  const header = rawHeader.map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));

  // 必須列チェック
  const hasWorkTitle = COL_ALIASES['worktitle'].some((c) => header.includes(c));
  const hasWorkType  = COL_ALIASES['worktype'].some((c)  => header.includes(c));
  const missing: string[] = [
    ...(!hasWorkTitle ? ['workTitle（またはtitle）'] : []),
    ...(!hasWorkType  ? ['workType（またはtype）'] : []),
  ];
  if (missing.length > 0) {
    const foundDisplay = rawHeader.map((h) => h.trim()).join(', ') || '（列が見つかりません）';
    return NextResponse.json(
      {
        error: '必須列が不足しています',
        details: {
          foundColumns: foundDisplay,
          missingColumns: missing.join(', '),
          fix: `CSVに ${missing.join(', ')} 列を追加してください。列順・余分な列は自由です。`,
          example: EXAMPLE_CSV,
        },
      },
      { status: 400 },
    );
  }

  // 列インデックス
  const COL = {
    personId:         findColIndex(header, ['personid', 'personname']),
    workTitle:        findColIndex(header, COL_ALIASES['worktitle']),
    workType:         findColIndex(header, COL_ALIASES['worktype']),
    releaseYear:      header.indexOf('releaseyear'),
    roleName:         header.indexOf('rolename'),
    workDisplayType:  findColIndex(header, COL_ALIASES['workdisplaytype']),
    vodService:       header.indexOf('vodservice'),
    availabilityType: header.indexOf('availabilitytype'),
    sourceUrl:        header.indexOf('sourceurl'),
    confidence:       header.indexOf('confidence'),
    note:             header.indexOf('note'),
  };

  // ── 人物名セット・既存作品をロード ──
  const allPersons = await getAllPersonsMerged();
  const personNameSet = new Set(allPersons.map((p) => p.name));

  // personName → normalizedTitle → WorkRecord のキャッシュ
  const personWorkCache = new Map<string, Map<string, WorkRecord>>();

  async function getPersonWorkMap(personName: string): Promise<Map<string, WorkRecord>> {
    if (!personWorkCache.has(personName)) {
      const works = await getAllWorks(personName);
      const m = new Map<string, WorkRecord>();
      for (const w of works) m.set(normalizeWorkTitle(w.title), w);
      personWorkCache.set(personName, m);
    }
    return personWorkCache.get(personName)!;
  }

  // ── データ行をパース・バリデーション ──
  const previewRows: WorkImportPreviewRow[] = [];

  // CSV内重複チェック用
  const seenWorksInCsv  = new Set<string>();  // personName:normalizedTitle
  const seenVodInCsv    = new Set<string>();  // personName:normalizedTitle:vodService

  const dataRows = rows.slice(1);
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const get = (col: number) => (col >= 0 ? (row[col] ?? '').trim() : '');

    const csvPersonId          = get(COL.personId);
    const workTitle            = get(COL.workTitle);
    const workTypeRaw          = get(COL.workType);
    const releaseYear          = get(COL.releaseYear);
    const roleName             = get(COL.roleName);
    const workDisplayTypeRaw   = get(COL.workDisplayType);
    const vodService           = get(COL.vodService);
    const availabilityType     = get(COL.availabilityType);
    const sourceUrl            = get(COL.sourceUrl);
    const confidence           = get(COL.confidence);
    const note                 = get(COL.note);

    // workDisplayType の正規化とバリデーション
    let resolvedDisplayType: DisplayWorkType | undefined;
    let displayTypeLabel: string | undefined;
    let displayTypeWarning: string | undefined;
    if (workDisplayTypeRaw) {
      const normalized = normalizeDisplayWorkType(workDisplayTypeRaw);
      if (normalized) {
        resolvedDisplayType = normalized;
        displayTypeLabel = DISPLAY_WORK_TYPE_LABEL[normalized];
      } else {
        displayTypeWarning = `workDisplayType "${workDisplayTypeRaw}" は未対応の値です（movie / drama / variety / idol_show / live / documentary / stage / music / web / anime_voice / other）`;
      }
    }

    const effectivePersonName = csvPersonId || bodyPersonName;

    const baseRow = {
      rowNum: i + 2,
      personName: effectivePersonName,
      workTitle,
      workType: workTypeRaw,
      releaseYear,
      roleName,
      workDisplayType: workDisplayTypeRaw,
      resolvedDisplayType,
      displayTypeLabel,
      displayTypeWarning,
      vodService,
      availabilityType,
      sourceUrl,
      confidence,
      note,
    };

    // ── 人物バリデーション ──
    if (!effectivePersonName) {
      previewRows.push({ ...baseRow, action: 'error', reason: 'personId列がなく対象人物も未選択です', vodAction: 'none' });
      continue;
    }
    if (!personNameSet.has(effectivePersonName)) {
      previewRows.push({ ...baseRow, action: 'error', reason: `"${effectivePersonName}" は登録されていない人物です`, vodAction: 'none' });
      continue;
    }
    if (!workTitle) {
      previewRows.push({ ...baseRow, action: 'error', reason: 'workTitle が空です', vodAction: 'none' });
      continue;
    }
    const workType = TYPE_MAP[workTypeRaw.toLowerCase()];
    if (!workType) {
      previewRows.push({ ...baseRow, action: 'error', reason: `workType "${workTypeRaw}" は未対応です（movie / drama / variety / documentary / web / special / stage 等を指定）`, vodAction: 'none' });
      continue;
    }

    const normalizedTitle = normalizeWorkTitle(workTitle);
    const workKey = `${effectivePersonName}:${normalizedTitle}`;

    // ── 作品の存在確認 ──
    const workMap = await getPersonWorkMap(effectivePersonName);
    const existingWork = workMap.get(normalizedTitle);

    let workAction: 'add' | 'existing';
    let workReason: string;

    // displayTypeAction: 既存作品に対して workDisplayType を更新するか
    let displayTypeAction: WorkImportPreviewRow['displayTypeAction'] = 'none';

    if (existingWork) {
      workAction = 'existing';
      workReason = '既存作品に紐付け';
      if (resolvedDisplayType) {
        if (!existingWork.workDisplayType) {
          displayTypeAction = 'set';
        } else if (existingWork.workDisplayType !== resolvedDisplayType) {
          displayTypeAction = 'update';
        } else {
          displayTypeAction = 'unchanged';
        }
      }
    } else if (seenWorksInCsv.has(workKey)) {
      workAction = 'existing';
      workReason = 'このCSVの前の行で追加済み';
    } else {
      workAction = 'add';
      workReason = '新規追加';
      seenWorksInCsv.add(workKey);
    }

    // ── VOD 判定 ──
    const vodServiceTrimmed = vodService.trim();
    let vodAction: 'add' | 'skip' | 'none';
    let vodSkipReason: string | undefined;

    if (!vodServiceTrimmed || vodServiceTrimmed.toLowerCase() === 'unknown') {
      vodAction = 'none';
    } else {
      const vodKey = `${effectivePersonName}:${normalizedTitle}:${vodServiceTrimmed.toLowerCase()}`;
      if (seenVodInCsv.has(vodKey)) {
        vodAction = 'skip';
        vodSkipReason = 'CSV内で同一作品・同一サービスが重複';
      } else if (existingWork) {
        const alreadyHas = (existingWork.vodProviders ?? []).some(
          (p) => p.source === 'manual_csv' &&
                 normalizeProviderName(p.providerName) === normalizeProviderName(vodServiceTrimmed),
        );
        if (alreadyHas) {
          vodAction = 'skip';
          vodSkipReason = '同一サービスのVOD情報が既に登録済み';
        } else {
          vodAction = 'add';
          seenVodInCsv.add(vodKey);
        }
      } else {
        vodAction = 'add';
        seenVodInCsv.add(vodKey);
      }
    }

    previewRows.push({ ...baseRow, action: workAction, reason: workReason, vodAction, vodSkipReason, displayTypeAction });
  }

  const addCount      = previewRows.filter((r) => r.action === 'add').length;
  const existingCount = previewRows.filter((r) => r.action === 'existing').length;
  const errorCount    = previewRows.filter((r) => r.action === 'error').length;
  const vodAddCount   = previewRows.filter((r) => r.vodAction === 'add').length;
  const vodSkipCount  = previewRows.filter((r) => r.vodAction === 'skip').length;

  if (!commit) {
    return NextResponse.json({ addCount, existingCount, errorCount, vodAddCount, vodSkipCount, previewRows });
  }

  // ── コミット ──
  const now = Date.now();
  let savedCount   = 0;
  let vodSavedCount = 0;
  let skipCount    = 0;
  let vodSkippedCount = 0;
  const errors: string[] = [];

  // Phase 1: 新規作品を作成（重複は一度のみ）
  const createdWorkIds = new Map<string, string>();  // workKey → workId

  for (const row of previewRows) {
    if (row.action !== 'add') continue;
    const workKey = `${row.personName}:${normalizeWorkTitle(row.workTitle)}`;
    if (createdWorkIds.has(workKey)) continue;  // 同一キーは1回のみ

    const workType    = TYPE_MAP[row.workType.toLowerCase()] as WorkType;
    const nt          = normalizeWorkTitle(row.workTitle);
    const workId      = generateWorkCsvId(workType, nt);
    const yearNum     = parseInt(row.releaseYear, 10);

    // Phase1では seenWorksInCsv を使わず workMap を再チェック（コミット間に他が追加された場合の保護）
    const workMap = await getPersonWorkMap(row.personName);
    if (workMap.get(nt)) {
      // プレビュー取得後に追加されていた場合は既存扱い
      createdWorkIds.set(workKey, workMap.get(nt)!.id);
      skipCount++;
      continue;
    }

    const work: WorkRecord = {
      id: workId,
      personName: row.personName,
      title: row.workTitle,
      normalizedTitle: nt,
      type: workType,
      source: 'manual_csv',
      releaseYear: isNaN(yearNum) ? undefined : yearNum,
      roleName: row.roleName || undefined,
      workDisplayType: row.resolvedDisplayType as DisplayWorkType | undefined,
      confidenceScore: 100,
      status: 'auto_published',
      vodProviders: [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      await saveWork(work);
      // キャッシュを更新（Phase2でVODを追加できるように）
      workMap.set(nt, work);
      createdWorkIds.set(workKey, workId);
      savedCount++;
    } catch (err) {
      errors.push(`${row.personName}「${row.workTitle}」作品作成: ${String(err)}`);
    }
  }

  // Phase 1.5: 既存作品の workDisplayType を更新
  const updatedDisplayTypeCount = { count: 0 };
  for (const row of previewRows) {
    if (row.action !== 'existing') continue;
    if (row.displayTypeAction !== 'set' && row.displayTypeAction !== 'update') continue;
    if (!row.resolvedDisplayType) continue;

    const nt = normalizeWorkTitle(row.workTitle);
    const workMap = await getPersonWorkMap(row.personName);
    const existing = workMap.get(nt);
    if (!existing) continue;

    const updated: WorkRecord = {
      ...existing,
      workDisplayType: row.resolvedDisplayType as DisplayWorkType,
      updatedAt: now,
    };
    try {
      await saveWork(updated);
      workMap.set(nt, updated);
      updatedDisplayTypeCount.count++;
    } catch (err) {
      errors.push(`${row.personName}「${row.workTitle}」カテゴリ更新: ${String(err)}`);
    }
  }

  // Phase 2: VOD情報を追加
  for (const row of previewRows) {
    if (row.vodAction !== 'add') {
      if (row.vodAction === 'skip') vodSkippedCount++;
      continue;
    }

    const nt = normalizeWorkTitle(row.workTitle);
    const workMap = await getPersonWorkMap(row.personName);
    const work    = workMap.get(nt);

    if (!work) {
      errors.push(`${row.personName}「${row.workTitle}」VOD追加: 対象作品が見つかりません`);
      continue;
    }

    const availType  = AVAILABILITY_TYPE_MAP[row.availabilityType.toLowerCase()] ?? 'unknown';
    const confVal    = CONFIDENCE_MAP[row.confidence.toLowerCase()] ?? undefined;

    const provider: VodProvider = {
      providerId:       0,
      providerName:     row.vodService,
      type:             availType,
      countryCode:      'JP',
      source:           'manual_csv',
      sourceUrl:        row.sourceUrl || undefined,
      confidence:       confVal,
      note:             row.note || undefined,
      checkedDate:      new Date(now).toISOString().slice(0, 10),
      createdAt:        now,
      updatedAt:        now,
    };

    try {
      const result = await upsertManualCsvVodProviders(row.personName, work.id, [provider]);
      if (result.added > 0 || result.updated > 0) {
        vodSavedCount++;
      } else {
        vodSkippedCount++;
      }
      // キャッシュ内の vodProviders を更新
      const cached = workMap.get(nt);
      if (cached) {
        const existing = cached.vodProviders ?? [];
        const idx = existing.findIndex(
          (p) => p.source === 'manual_csv' && normalizeProviderName(p.providerName) === normalizeProviderName(row.vodService),
        );
        if (idx >= 0) existing[idx] = provider;
        else existing.push(provider);
        cached.vodProviders = existing;
      }
    } catch (err) {
      errors.push(`${row.personName}「${row.workTitle}」VOD(${row.vodService}): ${String(err)}`);
    }
  }

  const failedCount = previewRows.filter((r) => r.action === 'add').length - savedCount - skipCount;
  return NextResponse.json({
    savedCount, existingCount, skipCount,
    vodSavedCount, vodSkippedCount, failedCount,
    displayTypeUpdatedCount: updatedDisplayTypeCount.count,
    errors,
  });
}
