// /admin/work-check「VOD調査結果 CSVインポート」（/api/admin/csv-import）の判定・保存計画（純粋関数・DB非依存）。
//
// 保存時はクライアントから送られた行データを信用せず、同じ CSV からサーバー側でプレビューを再計算し、
// 1) プレビュー指紋（fingerprint）が画面で確認したものと一致すること
// 2) 承認は「サーバーが保留と判定した Prime Video 行」にだけ、行内容が一致する場合に限り適用すること
// を検証してから保存内容を組み立てる（承認情報の改ざん・行のすり替えで検証を回避できない）。
import { createHash } from 'node:crypto';
import { normalizeProviderName, VOD_SOURCE_PRIORITY, VOD_SOURCE_LABEL } from '@/lib/vod-dedup';
import {
  classifyPrimeVideoRow,
  PRIME_CHANNEL_SUSPECT_WARNING,
  PRIME_HELD_CATEGORIES,
  validateApprovalFields,
} from '@/lib/vod-channel-guard';
import type { VodManualApproval, VodProvider, VodProviderType } from '@/types/vod';

// ─────────────────────────────────────────
// 定数
// ─────────────────────────────────────────

const SERVICE_LOOKUP: Record<string, { id: number; logoPath?: string }> = {
  'Netflix': { id: 8, logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'ネットフリックス': { id: 8, logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'Amazon Prime Video': { id: 9, logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Prime Video': { id: 9, logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Hulu': { id: 15, logoPath: '/giwM8XX4V2AkrgpAKl2LZeBYsHa.jpg' },
  'Disney+': { id: 337, logoPath: '/7rwgEs15tFwyR9NPQ5jpqxXEUAu.jpg' },
  'Disney Plus': { id: 337, logoPath: '/7rwgEs15tFwyR9NPQ5jpqxXEUAu.jpg' },
  'Apple TV+': { id: 350, logoPath: '/6uhKBfmtzFqOcLousHwZuzcrScK.jpg' },
  'AppleTV+': { id: 350, logoPath: '/6uhKBfmtzFqOcLousHwZuzcrScK.jpg' },
  'U-NEXT': { id: 97, logoPath: '/d3ixfcvzppmmvDcHieh5DIDRHYj.jpg' },
  'dTV': { id: 408, logoPath: '/2pCbao9bMSMpJvGdFl3otlMOcfL.jpg' },
  'Paravi': { id: 258, logoPath: '/3Y3fA4bLYjrHbhwk4hlmqLqw6PD.jpg' },
  'TELASA': { id: 395, logoPath: '/eLFqrOBsxyNhCyJO9pjOKJhbmSm.jpg' },
  'FOD': { id: 398, logoPath: '/pPzp1EGjPWwfQS1tWWJBcB1WRNs.jpg' },
  'FODプレミアム': { id: 398, logoPath: '/pPzp1EGjPWwfQS1tWWJBcB1WRNs.jpg' },
  'Lemino': { id: 570, logoPath: '/okMgHqoGP2MzqmKFmP2jJvTzB6f.jpg' },
  'レミノ': { id: 570, logoPath: '/okMgHqoGP2MzqmKFmP2jJvTzB6f.jpg' },
  'ABEMA': { id: 223, logoPath: '/5T4b5p6OI7ZhWgpEnNcHKi5FHZB.jpg' },
  'アベマ': { id: 223, logoPath: '/5T4b5p6OI7ZhWgpEnNcHKi5FHZB.jpg' },
  'NHKプラス': { id: -101 },
  'NHK+': { id: -101 },
  'NHKオンデマンド': { id: -107 },
  'TVer': { id: -102 },
  'YouTube': { id: 192, logoPath: '/oIkQkEkwfmcG7IGpRR1NB8frZZM.jpg' },
  '楽天TV': { id: 35, logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
  'RakutenTV': { id: 35, logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
  'Rakuten TV': { id: 35, logoPath: '/tb4lB5BSPQSF0u5kJT5AklhKzuE.jpg' },
  'DMM TV': { id: -104 },
  'DMMTV': { id: -104 },
  'WOWOW': { id: -105 },
  'WOWOWオンデマンド': { id: -105 },
  'dアニメストア': { id: -106 },
  'バンダイチャンネル': { id: -108 },
};

export const TYPE_MAP: Record<string, VodProviderType> = {
  flatrate: 'flatrate', subscription: 'flatrate', 見放題: 'flatrate',
  rent: 'rent', rental: 'rent', レンタル: 'rent',
  buy: 'buy', purchase: 'buy', 購入: 'buy',
  free: 'free', 無料: 'free',
  ads: 'ads', 'ad-supported': 'ads', 広告付き: 'ads',
  unknown: 'unknown',
};

const REQUIRED_COLS = ['workid', 'vodservice'] as const;

export const EXAMPLE_CSV = `workId,personId,vodService,availabilityType,confidence,sourceUrl,note
tmdb-tv-12345,賀喜遥香,Hulu,flatrate,high,https://www.hulu.jp/...,公式ページで確認
tmdb-tv-12345,賀喜遥香,U-NEXT,flatrate,medium,,`;

// ─────────────────────────────────────────
// 型
// ─────────────────────────────────────────

export type ImportAction = 'add' | 'update' | 'delete' | 'skip' | 'ignore' | 'suspected_channel' | 'error';

export interface ImportPreviewRow {
  rowNum: number;   // CSV行番号。同期モードの削除行は 0
  workId: string;
  personName: string;
  title: string;
  vodService: string;
  availabilityType: string;
  confidence: string;
  sourceUrl: string;
  checkedDate: string;
  note: string;
  // skip: 高優先度ソースが同名サービスを既に持つためCSV側をスキップ
  // suspected_channel: Prime Video 本体名義だが追加チャンネル／レンタルのみ／判定不能（保留・承認されるまで何も変更しない）
  action: ImportAction;
  reason: string;
  /** suspected_channel 行のみ：自動判定の内容と、承認した場合の動作 */
  hold?: {
    category: 'channel' | 'rental' | 'ambiguous';
    detail: string;
    /** 「Prime Video本体の見放題」として承認できるか（種別が flatrate の行のみ） */
    approvable: boolean;
    /** 承認した場合の動作（既存データとの関係で決まる） */
    approvedAction: 'add' | 'update' | 'skip';
    approvedReason: string;
  };
}

/** クライアントから送られる承認（行内容と一致する場合だけ有効） */
export interface RowApprovalInput {
  rowNum: number;
  workId: string;
  personName: string;
  vodService: string;
  officialUrl: string;
  reason: string;
}

export interface ImportWork {
  id: string;
  personName: string;
  title: string;
  vodData: Record<string, unknown>;
}

export interface RawCsvRow {
  rowNum: number;
  workId: string;
  personName: string;
  vodService: string;
  availabilityType: string;
  confidence: string;
  sourceUrl: string;
  checkedDate: string;
  note: string;
}

export interface CsvParseError {
  error: string;
  details?: { foundColumns: string; missingColumns: string; fix: string; example: string };
}

// ─────────────────────────────────────────
// CSV パース
// ─────────────────────────────────────────

// RFC 4180 準拠の簡易 CSV パーサー（BOM・改行コード対応）
export function parseCSV(content: string): string[][] {
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

/** CSV 本文 → 行データ。personId 列が空の行は bodyPersonName（画面で選んだ対象人物）を使う */
export function parseVodImportCsv(csvContent: string, bodyPersonName: string): { rows: RawCsvRow[] } | CsvParseError {
  const rows = parseCSV(csvContent);
  if (rows.length < 2) return { error: 'CSVが空またはヘッダー行のみです' };

  const rawHeader = rows[0];
  const header = rawHeader.map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));

  const missingCols = REQUIRED_COLS.filter((col) => header.indexOf(col) === -1);
  if (missingCols.length > 0) {
    const foundDisplay = rawHeader.map((h) => h.trim()).join(', ') || '（列が見つかりません）';
    const missingDisplay = missingCols.map((c) => (c === 'workid' ? 'workId' : 'vodService')).join(', ');
    return {
      error: '必須列が不足しています',
      details: {
        foundColumns: foundDisplay,
        missingColumns: missingDisplay,
        fix: `CSVに ${missingDisplay} 列を追加してください。列順・余分な列は自由です。`,
        example: EXAMPLE_CSV,
      },
    };
  }

  // 列インデックス（personid / personname 両方認識）
  const COL = {
    workId:           header.indexOf('workid'),
    personId:         Math.max(header.indexOf('personid'), header.indexOf('personname')),
    vodService:       header.indexOf('vodservice'),
    availabilityType: header.indexOf('availabilitytype'),
    confidence:       header.indexOf('confidence'),
    sourceUrl:        header.indexOf('sourceurl'),
    checkedDate:      header.indexOf('checkeddate'),
    note:             header.indexOf('note'),
  };

  return {
    rows: rows.slice(1).map((row, i) => {
      const get = (col: number) => (col >= 0 ? (row[col] ?? '').trim() : '');
      return {
        rowNum: i + 2,
        workId: get(COL.workId),
        personName: get(COL.personId) || bodyPersonName,
        vodService: get(COL.vodService),
        availabilityType: get(COL.availabilityType) || 'flatrate',
        confidence: get(COL.confidence) || 'medium',
        sourceUrl: get(COL.sourceUrl),
        checkedDate: get(COL.checkedDate),
        note: get(COL.note),
      };
    }),
  };
}

/** DB から読み込む (personName, workId) の組 */
export function collectWorkPairs(rows: RawCsvRow[]): Array<{ personName: string; workId: string }> {
  const pairMap = new Map<string, { personName: string; workId: string }>();
  for (const r of rows) {
    if (r.workId && r.personName) pairMap.set(`${r.personName}:${r.workId}`, { personName: r.personName, workId: r.workId });
  }
  return [...pairMap.values()];
}

function normalizeType(availabilityType: string): VodProviderType | undefined {
  return TYPE_MAP[availabilityType?.toLowerCase() ?? ''];
}

function sourceLabelOf(p: VodProvider): string {
  return VOD_SOURCE_LABEL[p.source as keyof typeof VOD_SOURCE_LABEL] ?? p.source;
}

/** 既存データに対して CSV 行を保存する場合の動作（add / update / skip） */
function decideUpsertAction(work: ImportWork, normalizedVodService: string): { action: 'add' | 'update' | 'skip'; reason: string } {
  const existingProviders = (work.vodData.vodProviders ?? []) as VodProvider[];
  const existingByNorm = existingProviders.find((p) => normalizeProviderName(p.providerName) === normalizedVodService);
  if (!existingByNorm) return { action: 'add', reason: '新規追加' };
  const existingPriority = VOD_SOURCE_PRIORITY[existingByNorm.source as keyof typeof VOD_SOURCE_PRIORITY] ?? 99;
  if (existingPriority < VOD_SOURCE_PRIORITY['manual_csv']) {
    // 高優先度ソース（TMDb / AI / manual）が同名サービスを保持 → CSV側をスキップ
    return {
      action: 'skip',
      reason: `${sourceLabelOf(existingByNorm)}由来の「${existingByNorm.providerName}」が既に存在するためスキップ（CSV側は追加しません）`,
    };
  }
  return { action: 'update', reason: '既存のCSVインポートデータを最新情報で上書き' };
}

// ─────────────────────────────────────────
// プレビュー
// ─────────────────────────────────────────

export interface ImportPreview {
  syncMode: boolean;
  previewRows: ImportPreviewRow[];
  addCount: number;
  updateCount: number;
  deleteCount: number;
  skipCount: number;
  ignoreCount: number;
  errorCount: number;
  suspectedChannelCount: number;
  /** 画面で確認した内容と保存時の再計算結果が一致するかを照合するための指紋 */
  fingerprint: string;
}

export function buildImportPreview(rawRows: RawCsvRow[], workMap: Map<string, ImportWork>, syncMode: boolean): ImportPreview {
  const previewRows: ImportPreviewRow[] = [];
  const seenInCsv = new Set<string>();
  // 同期モード用: workキーごとにCSVに登場した正規化 vodService を記録
  const csvServicesPerWork = new Map<string, Set<string>>();
  const markInCsv = (mapKey: string, norm: string) => {
    if (!csvServicesPerWork.has(mapKey)) csvServicesPerWork.set(mapKey, new Set());
    csvServicesPerWork.get(mapKey)!.add(norm);
  };

  for (const r of rawRows) {
    const base = {
      rowNum: r.rowNum, workId: r.workId, personName: r.personName, title: '', vodService: r.vodService,
      availabilityType: r.availabilityType, confidence: r.confidence, sourceUrl: r.sourceUrl,
      checkedDate: r.checkedDate, note: r.note,
    };
    if (!r.workId) {
      previewRows.push({ ...base, workId: '', action: 'error', reason: 'workId が空です' });
      continue;
    }
    if (!r.vodService) {
      previewRows.push({ ...base, vodService: '', action: 'ignore', reason: 'vodService が空のためスキップ' });
      continue;
    }
    if (!r.personName) {
      previewRows.push({
        ...base, personName: '', action: 'error',
        reason: 'personId列がなく対象人物も未選択です。インポート対象の人物をセレクターで選択してください。',
      });
      continue;
    }

    const mapKey = `${r.personName}:${r.workId}`;
    const work = workMap.get(mapKey);
    if (!work) {
      previewRows.push({ ...base, action: 'error', reason: `workId "${r.workId}" が "${r.personName}" の作品として見つかりません` });
      continue;
    }
    const withWork = { ...base, personName: work.personName, title: work.title };

    // CSV 内重複チェック
    const dedupeKey = `${r.personName}:${r.workId}:${r.vodService.toLowerCase()}`;
    if (seenInCsv.has(dedupeKey)) {
      previewRows.push({ ...withWork, action: 'ignore', reason: 'このCSV内で同じ personId+workId+vodService が既出のため無視' });
      continue;
    }
    seenInCsv.add(dedupeKey);

    const normalizedVodService = normalizeProviderName(r.vodService);
    const upsert = decideUpsertAction(work, normalizedVodService);

    // Prime Video 本体名義：追加チャンネル／レンタルのみ／判定不能は保留（承認されるまで何も変更しない）
    const normalizedType = normalizeType(r.availabilityType) ?? 'flatrate';
    const prime = classifyPrimeVideoRow({ providerName: r.vodService, note: r.note, sourceUrl: r.sourceUrl, availabilityType: normalizedType });
    if (PRIME_HELD_CATEGORIES.has(prime.category)) {
      // 同期モードで既存の同名 manual_csv が「CSVに記載なし」として削除されないよう、記載ありとして扱う
      markInCsv(mapKey, normalizedVodService);
      previewRows.push({
        ...withWork,
        action: 'suspected_channel',
        reason: `${prime.detail}。${PRIME_CHANNEL_SUSPECT_WARNING}`,
        hold: {
          category: prime.category as 'channel' | 'rental' | 'ambiguous',
          detail: prime.detail,
          approvable: normalizedType === 'flatrate',
          approvedAction: upsert.action,
          approvedReason: upsert.reason,
        },
      });
      continue;
    }

    // 同期モード用: add/update/skip いずれもCSVに「このサービスが含まれている」として記録
    markInCsv(mapKey, normalizedVodService);
    previewRows.push({ ...withWork, action: upsert.action, reason: upsert.reason });
  }

  // ── 同期モード: CSVにない既存 manual_csv を削除予定行として追加 ──
  // 対象: CSVに登場した personName + workId の組み合わせのみ。TMDb / AI / manual ソースは対象外
  if (syncMode) {
    for (const [mapKey, csvServices] of csvServicesPerWork) {
      const work = workMap.get(mapKey);
      if (!work) continue;
      for (const p of ((work.vodData.vodProviders ?? []) as VodProvider[])) {
        if (p.source !== 'manual_csv') continue;
        if (!csvServices.has(normalizeProviderName(p.providerName))) {
          previewRows.push({
            rowNum: 0, // CSV 由来でない行
            workId: work.id,
            personName: work.personName,
            title: work.title,
            vodService: p.providerName,
            availabilityType: p.type,
            confidence: p.confidence ?? '',
            sourceUrl: p.sourceUrl ?? '',
            checkedDate: p.checkedDate ?? '',
            note: p.note ?? '',
            action: 'delete',
            reason: '同期モード: CSVに記載がないため削除',
          });
        }
      }
    }
  }

  const count = (a: ImportAction) => previewRows.filter((r) => r.action === a).length;
  return {
    syncMode,
    previewRows,
    addCount: count('add'),
    updateCount: count('update'),
    deleteCount: count('delete'),
    skipCount: count('skip'),
    ignoreCount: count('ignore'),
    errorCount: count('error'),
    suspectedChannelCount: count('suspected_channel'),
    fingerprint: previewFingerprint(previewRows, syncMode),
  };
}

/** プレビュー内容の指紋（行・操作・保存される値）。DB や CSV がプレビュー後に変わったら一致しない */
export function previewFingerprint(rows: ImportPreviewRow[], syncMode: boolean): string {
  const h = createHash('sha256');
  h.update(syncMode ? 'sync' : 'upsert');
  for (const r of rows) {
    h.update('\u0001');
    h.update(JSON.stringify([
      r.rowNum, r.action, r.personName, r.workId, r.vodService, r.availabilityType, r.confidence,
      r.sourceUrl, r.checkedDate, r.note, r.hold?.category ?? '', r.hold?.approvedAction ?? '',
    ]));
  }
  return h.digest('hex').slice(0, 32);
}

// ─────────────────────────────────────────
// 承認の検証
// ─────────────────────────────────────────

/**
 * 承認を検証して rowNum → 承認 のマップを返す。
 * 1件でも不正（保留でない行・行内容不一致・承認不可の行・入力不備・重複）があれば全体をエラーにする（部分適用しない）。
 */
export function validateApprovals(
  previewRows: ImportPreviewRow[],
  approvals: unknown,
): { ok: true; approved: Map<number, { officialUrl: string; reason: string }> } | { ok: false; error: string } {
  const approved = new Map<number, { officialUrl: string; reason: string }>();
  if (approvals === undefined || approvals === null) return { ok: true, approved };
  if (!Array.isArray(approvals)) return { ok: false, error: 'approvals の形式が正しくありません' };
  const heldByRow = new Map(previewRows.filter((r) => r.action === 'suspected_channel').map((r) => [r.rowNum, r]));
  for (const a of approvals as Partial<RowApprovalInput>[]) {
    if (!a || typeof a !== 'object' || typeof a.rowNum !== 'number') return { ok: false, error: '承認データの形式が正しくありません' };
    const row = heldByRow.get(a.rowNum);
    if (!row) return { ok: false, error: `${a.rowNum}行目は保留行ではないため承認できません` };
    if (row.workId !== a.workId || row.personName !== a.personName || row.vodService !== a.vodService) {
      return { ok: false, error: `${a.rowNum}行目の承認内容がCSVの行と一致しません。再度プレビューしてください` };
    }
    if (!row.hold?.approvable) {
      return { ok: false, error: `${a.rowNum}行目は種別が見放題（flatrate）ではないため「Prime Video本体の見放題」として承認できません` };
    }
    if (approved.has(a.rowNum)) return { ok: false, error: `${a.rowNum}行目の承認が重複しています` };
    const fieldError = validateApprovalFields(a.officialUrl, a.reason);
    if (fieldError) return { ok: false, error: `${a.rowNum}行目: ${fieldError}` };
    approved.set(a.rowNum, { officialUrl: (a.officialUrl as string).trim(), reason: (a.reason as string).trim() });
  }
  return { ok: true, approved };
}

/**
 * 同期モードで削除を実行してよいか。
 * エラー行・未承認の保留行が残っている場合は、CSV の読み違い・判断待ちのまま既存データを消さないよう削除を行わない
 * （追加・更新・承認済み行の保存は行う）。
 */
export function syncDeleteBlockedReason(previewRows: ImportPreviewRow[], approvedRowNums: ReadonlySet<number>): string | null {
  const errors = previewRows.filter((r) => r.action === 'error').length;
  const unresolvedHeld = previewRows.filter((r) => r.action === 'suspected_channel' && !approvedRowNums.has(r.rowNum)).length;
  if (errors === 0 && unresolvedHeld === 0) return null;
  const parts = [errors > 0 ? `エラー${errors}件` : '', unresolvedHeld > 0 ? `未承認の保留${unresolvedHeld}件` : ''].filter(Boolean);
  return `${parts.join('・')}が残っているため、同期モードの削除は実行しません（解消して再プレビューすると削除できます）`;
}

// ─────────────────────────────────────────
// 保存内容の組み立て
// ─────────────────────────────────────────

function lookupService(name: string): { id: number; logoPath?: string } {
  const key = Object.keys(SERVICE_LOOKUP).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? SERVICE_LOOKUP[key] : { id: stringHash(name) };
}

function stringHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return -(h % 90000) - 10200;
}

export interface SavePlan {
  worksToUpdate: Array<{ personName: string; id: string; vodData: Record<string, unknown> }>;
  savedWorkCount: number;
  savedProviderCount: number;
  deletedProviderCount: number;
  approvedProviderCount: number;
  approvedSkippedCount: number;
  heldProviderCount: number;
  suppressedDeleteCount: number;
  deleteBlockedReason: string | null;
  errors: string[];
}

export function buildSavePlan(
  preview: ImportPreview,
  approved: Map<number, { officialUrl: string; reason: string }>,
  workMap: Map<string, ImportWork>,
  now: Date,
): SavePlan {
  const nowMs = now.getTime();
  const today = now.toISOString().slice(0, 10);
  const rows = preview.previewRows;

  const deleteBlockedReason = preview.syncMode ? syncDeleteBlockedReason(rows, new Set(approved.keys())) : null;
  const deleteRows = preview.syncMode ? rows.filter((r) => r.action === 'delete') : [];
  const suppressedDeleteCount = deleteBlockedReason ? deleteRows.length : 0;

  type Op = { row: ImportPreviewRow; kind: 'upsert' | 'delete'; approval?: VodManualApproval };
  const ops: Op[] = [];
  let approvedSkippedCount = 0;
  for (const r of rows) {
    if (r.action === 'add' || r.action === 'update') ops.push({ row: r, kind: 'upsert' });
    else if (r.action === 'delete' && !deleteBlockedReason) ops.push({ row: r, kind: 'delete' });
    else if (r.action === 'suspected_channel' && approved.has(r.rowNum) && r.hold) {
      if (r.hold.approvedAction === 'skip') { approvedSkippedCount++; continue; } // TMDb等が既に保持 → 追加しない
      const a = approved.get(r.rowNum)!;
      ops.push({
        row: r,
        kind: 'upsert',
        approval: {
          kind: 'prime_video_included',
          officialUrl: a.officialUrl,
          reason: a.reason,
          approvedAt: now.toISOString(),
          heldCategory: r.hold.category,
        },
      });
    }
  }

  // (personName + workId) ごとにグループ化（プレビューに出た組だけ＝CSV対象外の人物・作品には触れない）
  const groups = new Map<string, Op[]>();
  for (const op of ops) {
    const key = `${op.row.personName}:${op.row.workId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(op);
  }

  const worksToUpdate: SavePlan['worksToUpdate'] = [];
  const errors: string[] = [];
  let savedProviderCount = 0;
  let deletedProviderCount = 0;
  let approvedProviderCount = 0;

  for (const [key, workOps] of groups) {
    const dbWork = workMap.get(key);
    if (!dbWork) { errors.push(`保存時に作品が見つかりません: ${key}`); continue; }

    const existingVodData = dbWork.vodData;
    const existingProviders = (existingVodData.vodProviders ?? []) as VodProvider[];
    const nonCsvProviders = existingProviders.filter((p) => p.source !== 'manual_csv');
    const csvProviderMap = new Map<string, VodProvider>();
    for (const p of existingProviders.filter((p) => p.source === 'manual_csv')) {
      csvProviderMap.set(normalizeProviderName(p.providerName), p);
    }

    for (const op of workOps.filter((o) => o.kind === 'delete')) {
      if (csvProviderMap.delete(normalizeProviderName(op.row.vodService))) deletedProviderCount++;
    }

    for (const op of workOps.filter((o) => o.kind === 'upsert')) {
      const r = op.row;
      const serviceInfo = lookupService(r.vodService);
      const providerType = op.approval ? 'flatrate' : (normalizeType(r.availabilityType) ?? 'flatrate');
      const normName = normalizeProviderName(r.vodService);
      const existing = csvProviderMap.get(normName);
      const provider: VodProvider = {
        providerId: serviceInfo.id,
        providerName: r.vodService,
        logoPath: serviceInfo.logoPath,
        type: providerType,
        countryCode: 'JP',
        source: 'manual_csv',
        sourceLabel: 'CSV調査',
        confidence: (['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'medium') as 'high' | 'medium' | 'low',
        sourceUrl: r.sourceUrl || op.approval?.officialUrl || undefined,
        checkedDate: r.checkedDate || today,
        note: r.note || undefined,
        createdAt: existing?.createdAt ?? nowMs,
        updatedAt: nowMs,
      };
      if (op.approval) { provider.manualApproval = op.approval; approvedProviderCount++; }
      csvProviderMap.set(normName, provider);
      savedProviderCount++;
    }

    worksToUpdate.push({
      personName: dbWork.personName,
      id: dbWork.id,
      vodData: {
        ...existingVodData,
        vodProviders: [...nonCsvProviders, ...csvProviderMap.values()],
        vodUpdatedAt: nowMs,
      },
    });
  }

  const heldProviderCount = rows.filter((r) => r.action === 'suspected_channel' && !approved.has(r.rowNum)).length;
  return {
    worksToUpdate,
    savedWorkCount: worksToUpdate.length,
    savedProviderCount,
    deletedProviderCount,
    approvedProviderCount,
    approvedSkippedCount,
    heldProviderCount,
    suppressedDeleteCount,
    deleteBlockedReason,
    errors,
  };
}
