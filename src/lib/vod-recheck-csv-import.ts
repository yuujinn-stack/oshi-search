// VOD再確認CSVの取り込み・反映ロジック（プレビュー・実行の両方を1関数に集約）。
// /api/admin/vod-recheck/csv-import（手動貼り付け・ファイル選択）から呼ばれる。
// workIdのcanonical解決・非活性化作品の拒否・manual_csv保存・監査ログ・処理状態変更の
// ロジックをこの1関数に集約する。
import { MAX_CSV_FILE_BYTES } from '@/lib/csv-parse';
import { parseAndValidateImportCsv, type ParsedImportRow } from '@/lib/vod-recheck-csv';
import { resolveActiveWorkTargets } from '@/lib/vod-recheck-store';
import { upsertManualCsvVodProviders, mergeManualCsvVodProviders, chatgptFullSyncVodProviders, getWork } from '@/lib/work-store';
import { computeChatgptFullSync, type ChatgptSyncServiceInput, type ChatgptSyncDiff, type ChatgptFullSyncOptions } from '@/lib/vod-chatgpt-sync';
import { isSuspectedPrimeChannelRow, describeSuspectedPrimeChannelRow, PRIME_CHANNEL_SUSPECT_WARNING } from '@/lib/vod-channel-guard';
import { insertVodRecheckLog } from '@/db/write';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { detectRecheckReasons } from '@/lib/vod-recheck';
import type { VodProvider, VodProviderType } from '@/types/vod';

export type VodRecheckCsvImportMode = 'merge' | 'chatgpt_full_sync';

// 「同名作品があり対象作品を確実に特定できず」の判定に使う固定フレーズ。
// buildChatgptFullSyncPrompt（vod-research-prompt.ts）が調査者に出力させる文言と一致させている。
const AMBIGUOUS_NOTE_MARKER = '同名作品があり';

// vodService列が実質「未確認/対象なし」を意味する行かどうか（大文字小文字を区別しない）
function isUnknownServiceRow(row: ParsedImportRow): boolean {
  return row.vodService.trim().toLowerCase() === 'unknown';
}

// ── サービス辞書（work-vod-import / vod-title-import と同じテーブルをこの機能専用に複製） ──
const SERVICE_LOOKUP: Record<string, { id: number; logoPath?: string }> = {
  'Netflix':             { id: 8,    logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'ネットフリックス':    { id: 8,    logoPath: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg' },
  'Amazon Prime Video':  { id: 9,    logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Prime Video':         { id: 9,    logoPath: '/emthp39XA2YScoYL1p0sdbAH2WA.jpg' },
  'Hulu':                { id: 15,   logoPath: '/giwM8XX4V2AkrgpAKl2LZeBYsHa.jpg' },
  'Disney+':             { id: 337,  logoPath: '/7rwgEs15tFwyR9NPQ5jpqxXEUAu.jpg' },
  'U-NEXT':              { id: 97,   logoPath: '/d3ixfcvzppmmvDcHieh5DIDRHYj.jpg' },
  'dTV':                 { id: 408,  logoPath: '/2pCbao9bMSMpJvGdFl3otlMOcfL.jpg' },
  'Paravi':              { id: 258,  logoPath: '/3Y3fA4bLYjrHbhwk4hlmqLqw6PD.jpg' },
  'TELASA':              { id: 395,  logoPath: '/eLFqrOBsxyNhCyJO9pjOKJhbmSm.jpg' },
  'FOD':                 { id: 398,  logoPath: '/pPzp1EGjPWwfQS1tWWJBcB1WRNs.jpg' },
  'Lemino':              { id: 570,  logoPath: '/okMgHqoGP2MzqmKFmP2jJvTzB6f.jpg' },
  'ABEMA':               { id: 223,  logoPath: '/5T4b5p6OI7ZhWgpEnNcHKi5FHZB.jpg' },
};

function lookupService(name: string): { id: number; logoPath?: string } {
  const key = Object.keys(SERVICE_LOOKUP).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) {
    let h = 5381;
    for (let i = 0; i < name.length; i++) h = (Math.imul(h, 33) ^ name.charCodeAt(i)) >>> 0;
    return { id: -(h % 90000) - 10200 };
  }
  return SERVICE_LOOKUP[key];
}

export type RunCsvImportResult =
  | { status: 400; body: { error: string; details?: string[] } }
  | { status: 200; body: PreviewResponse | ApplyResponse };

interface PreviewWorkEntry {
  workId: string;
  resolvedFrom?: string[];
  title: string | null;
  persons: string[];
  services: Array<{ providerName: string; availabilityType: VodProviderType }>;
  currentVodCount: number;
  afterVodCount: number;
  currentUnknownCount: number;
  afterUnknownCount: number;
  warnings: string[];
  errors: string[];
  /** chatgpt_full_sync モード限定: 対象14サービスの追加/更新/削除/変更なし内訳 */
  diff?: ChatgptSyncDiff;
  /** chatgpt_full_sync モード限定: 同名作品等で対象作品を特定できなかった旨のnoteが含まれる */
  ambiguous?: boolean;
  /** Prime Video 追加チャンネルの可能性があり取り込みを保留した行（vod-channel-guard.ts） */
  heldRows?: string[];
}

interface PreviewResponse {
  commit: false;
  mode: VodRecheckCsvImportMode;
  preview: PreviewWorkEntry[];
  unresolvedWorkIds: string[];
  hasFatalErrors: boolean;
  totalWorkIds: number;
  totalRows: number;
  /** chatgpt_full_sync モード限定: 追加/更新/削除/変更なし/VODなしの集計 */
  summary?: { added: number; updated: number; removed: number; unchanged: number; zeroVod: number };
  /** 直前に生成したChatGPTプロンプトの対象workIdのうち、今回のCSVに含まれていないもの */
  missingFromLastPrompt?: string[];
  /** Prime Video 追加チャンネルの可能性があり取り込みを保留した行数 */
  heldRowCount?: number;
}

interface ApplyResponse {
  commit: true;
  mode: VodRecheckCsvImportMode;
  updatedWorks: number;
  unresolvedWorkIds: string[];
  errors: string[];
  /** chatgpt_full_sync モード限定: 失敗した作品（部分失敗時は調査済みにされない） */
  failedWorkIds?: string[];
  /** Prime Video 追加チャンネルの可能性があり取り込みを保留した行（人間の確認後、正式名で再取り込みする） */
  heldRows?: string[];
}

export async function runVodRecheckCsvImport(
  csv: string,
  commit: boolean,
  mode: VodRecheckCsvImportMode = 'merge',
  expectedWorkIds?: string[],
): Promise<RunCsvImportResult> {
  if (!csv.trim()) {
    return { status: 400, body: { error: 'csv（文字列）が必要です' } };
  }

  const byteLength = Buffer.byteLength(csv, 'utf8');
  if (byteLength > MAX_CSV_FILE_BYTES) {
    const maxMb = (MAX_CSV_FILE_BYTES / (1024 * 1024)).toFixed(0);
    return { status: 400, body: { error: `CSVのサイズが大きすぎます（上限${maxMb}MB）` } };
  }

  const parseResult = parseAndValidateImportCsv(csv);
  if (!parseResult.ok) {
    return { status: 400, body: { error: parseResult.error, details: parseResult.details } };
  }
  const parsed = parseResult.rows;

  const workIds = [...new Set(parsed.map((p) => p.workId))];
  const { resolved, unresolved: unresolvedWorkIds } = await resolveActiveWorkTargets(workIds);

  const providersByCanonical = new Map<string, VodProvider[]>();
  const personsByCanonical = new Map<string, string[]>();
  const canonicalByInput = new Map<string, { canonicalWorkId: string; resolvedViaAlias: boolean }>();
  // chatgpt_full_sync モード専用: vodService=unknown の行は「対象サービスなし」を意味するため
  // provider化しない（既存のmergeManualCsvVodProviders用providersByCanonicalとは別に集計する）
  const chatgptServicesByCanonical = new Map<string, ChatgptSyncServiceInput[]>();
  const ambiguousWorkIds = new Set<string>();
  const allCanonicalWorkIds = new Set<string>();
  // Prime Video 名義だが追加チャンネルの可能性がある行（取り込まず保留。providerの自動書き換えはしない）
  const heldByCanonical = new Map<string, string[]>();
  const holdRow = (canonicalWorkId: string, row: ParsedImportRow) => {
    const list = heldByCanonical.get(canonicalWorkId) ?? [];
    list.push(describeSuspectedPrimeChannelRow({ providerName: row.vodService, note: row.note, sourceUrl: row.sourceUrl, workId: row.workId }));
    heldByCanonical.set(canonicalWorkId, list);
  };
  const isHeld = (row: ParsedImportRow) =>
    !isUnknownServiceRow(row) && isSuspectedPrimeChannelRow({ providerName: row.vodService, note: row.note, sourceUrl: row.sourceUrl });

  for (const row of parsed) {
    const target = resolved.get(row.workId);
    if (!target) continue;
    canonicalByInput.set(row.workId, { canonicalWorkId: target.canonicalWorkId, resolvedViaAlias: target.resolvedViaAlias });
    personsByCanonical.set(target.canonicalWorkId, target.personNames);
    allCanonicalWorkIds.add(target.canonicalWorkId);

    if (mode === 'chatgpt_full_sync') {
      if (row.note && row.note.includes(AMBIGUOUS_NOTE_MARKER)) {
        ambiguousWorkIds.add(target.canonicalWorkId);
      }
      if (isHeld(row)) {
        // 保留: Prime Video として同期しない。既存の Prime Video 情報は同期時に保持する（preserveSlugs）
        holdRow(target.canonicalWorkId, row);
        if (!chatgptServicesByCanonical.has(target.canonicalWorkId)) chatgptServicesByCanonical.set(target.canonicalWorkId, []);
        continue;
      }
      if (!isUnknownServiceRow(row)) {
        const list = chatgptServicesByCanonical.get(target.canonicalWorkId) ?? [];
        list.push({
          providerName: row.vodService,
          type: row.availabilityType,
          sourceUrl: row.sourceUrl,
          confidence: row.confidence,
          note: row.note,
        });
        chatgptServicesByCanonical.set(target.canonicalWorkId, list);
      } else if (!chatgptServicesByCanonical.has(target.canonicalWorkId)) {
        // 「unknown」行のみで実サービス行が1件もない場合でも、この作品を対象として扱う
        // （0件配信済みとして記録するため、空配列を明示的に持たせる）
        chatgptServicesByCanonical.set(target.canonicalWorkId, []);
      }
      continue;
    }

    if (isHeld(row)) {
      holdRow(target.canonicalWorkId, row);
      if (!providersByCanonical.has(target.canonicalWorkId)) providersByCanonical.set(target.canonicalWorkId, []);
      continue;
    }

    const svc = lookupService(row.vodService);
    const list = providersByCanonical.get(target.canonicalWorkId) ?? [];
    list.push({
      providerId: svc.id,
      providerName: row.vodService,
      logoPath: svc.logoPath,
      type: row.availabilityType,
      countryCode: 'JP',
      source: 'manual_csv',
      sourceLabel: 'CSV',
      sourceUrl: row.sourceUrl,
      confidence: row.confidence,
      note: row.note,
      checkedDate: new Date().toISOString().slice(0, 10),
      updatedAt: Date.now(),
    });
    providersByCanonical.set(target.canonicalWorkId, list);
  }

  const missingFromLastPrompt = expectedWorkIds
    ? expectedWorkIds.filter((id) => {
        const target = resolved.get(id);
        const canonicalId = target?.canonicalWorkId ?? id;
        return !allCanonicalWorkIds.has(canonicalId);
      })
    : undefined;

  if (mode === 'chatgpt_full_sync') {
    return commit
      ? await applyChatgptFullSync(chatgptServicesByCanonical, personsByCanonical, ambiguousWorkIds, unresolvedWorkIds, heldByCanonical)
      : await previewChatgptFullSync(
          chatgptServicesByCanonical, personsByCanonical, canonicalByInput, ambiguousWorkIds,
          unresolvedWorkIds, parsed.length, missingFromLastPrompt, heldByCanonical,
        );
  }

  if (!commit) {
    const terminatedSlugs = await getInactiveProviderSlugs();
    const now = Date.now();

    const preview = await Promise.all([...providersByCanonical.entries()].map(async ([canonicalWorkId, providers]) => {
      const persons = personsByCanonical.get(canonicalWorkId) ?? [];
      const representativePerson = persons[0];
      const current = representativePerson ? await getWork(representativePerson, canonicalWorkId) : null;
      const currentProviders = current?.vodProviders ?? [];

      const currentDetection = detectRecheckReasons({
        vodProviders: currentProviders,
        lastVodCheckAt: current?.lastVodCheckAt,
        vodAiCheckedAt: current?.vodAiCheckedAt,
        terminatedSlugs,
        isHighTraffic: false,
        isPostMergeUnchecked: false,
        now,
      });

      // 実際の upsertManualCsvVodProviders() と同じマージ関数でシミュレーション（DB書き込みなし）
      const { merged } = mergeManualCsvVodProviders(currentProviders, providers);
      const afterDetection = detectRecheckReasons({
        vodProviders: merged,
        lastVodCheckAt: current?.lastVodCheckAt,
        vodAiCheckedAt: current?.vodAiCheckedAt,
        terminatedSlugs,
        isHighTraffic: false,
        isPostMergeUnchecked: false,
        now,
      });

      const resolvedFrom = [...canonicalByInput.entries()]
        .filter(([, v]) => v.canonicalWorkId === canonicalWorkId && v.resolvedViaAlias)
        .map(([inputWorkId]) => inputWorkId);

      const warnings: string[] = [];
      if (!current) warnings.push('現在のVOD情報を取得できませんでした（新規登録として扱われます）');
      const held = heldByCanonical.get(canonicalWorkId);
      if (held) warnings.push(`${PRIME_CHANNEL_SUSPECT_WARNING} 対象: ${held.join(' / ')}`);

      return {
        workId: canonicalWorkId,
        resolvedFrom: resolvedFrom.length > 0 ? resolvedFrom : undefined,
        title: current?.title ?? null,
        persons,
        services: providers.map((p) => ({ providerName: p.providerName, availabilityType: p.type })),
        heldRows: held,
        currentVodCount: currentDetection.activeCount,
        afterVodCount: afterDetection.activeCount,
        currentUnknownCount: currentDetection.unknownCount,
        afterUnknownCount: afterDetection.unknownCount,
        warnings,
        errors: [] as string[],
      };
    }));

    // 1件でも未解決（存在しない・非活性化されたworkId）があれば反映を無効化する
    const hasFatalErrors = unresolvedWorkIds.length > 0 || preview.some((p) => p.errors.length > 0);

    return {
      status: 200,
      body: {
        commit: false,
        mode: 'merge',
        preview,
        heldRowCount: [...heldByCanonical.values()].reduce((n, l) => n + l.length, 0),
        unresolvedWorkIds,
        hasFatalErrors,
        totalWorkIds: providersByCanonical.size,
        totalRows: parsed.length,
      },
    };
  }

  // ── 実行 ──
  const terminatedSlugs = await getInactiveProviderSlugs();
  const now = Date.now();
  let updatedWorks = 0;
  const applyErrors: string[] = [];

  for (const [workId, providers] of providersByCanonical.entries()) {
    if (providers.length === 0) continue; // 保留行のみの作品は何も変更しない
    const persons = personsByCanonical.get(workId) ?? [];
    for (const personName of persons) {
      try {
        const before = await getWork(personName, workId);
        const beforeDetection = before ? detectRecheckReasons({
          vodProviders: before.vodProviders,
          lastVodCheckAt: before.lastVodCheckAt,
          vodAiCheckedAt: before.vodAiCheckedAt,
          terminatedSlugs,
          isHighTraffic: false,
          isPostMergeUnchecked: false,
          now,
        }) : undefined;

        // vod_dataのみ更新。status/deleted（公開状態）は一切変更しない
        await upsertManualCsvVodProviders(personName, workId, providers);

        const after = await getWork(personName, workId);
        const afterDetection = after ? detectRecheckReasons({
          vodProviders: after.vodProviders,
          lastVodCheckAt: after.lastVodCheckAt,
          vodAiCheckedAt: after.vodAiCheckedAt,
          terminatedSlugs,
          isHighTraffic: false,
          isPostMergeUnchecked: false,
          now,
        }) : undefined;

        try {
          await insertVodRecheckLog({
            personName,
            workId,
            action: 'complete',
            performedBy: 'admin:vod-recheck-csv-import',
            note: `CSVインポート: ${providers.length}件のVOD情報を反映`,
            updatedProviderCount: providers.length,
            activeCountBefore: beforeDetection?.activeCount,
            activeCountAfter: afterDetection?.activeCount,
            unknownCountBefore: beforeDetection?.unknownCount,
            unknownCountAfter: afterDetection?.unknownCount,
            vodCheckStatusAfter: after?.vodCheckStatus,
          });
        } catch (logErr) {
          console.warn('[vod-recheck-csv-import] 監査ログ書き込み失敗:', String(logErr));
        }

        updatedWorks++;
      } catch (err) {
        applyErrors.push(`${workId} / ${personName}: ${String(err)}`);
      }
    }
  }

  return {
    status: 200,
    body: {
      commit: true,
      mode: 'merge',
      updatedWorks,
      unresolvedWorkIds,
      errors: applyErrors,
      heldRows: heldByCanonical.size > 0 ? [...heldByCanonical.values()].flat() : undefined,
    },
  };
}

// 保留行がある作品では、既存の Prime Video 情報を同期で変更しない（追加・更新・削除しない）
function syncOptionsFor(heldByCanonical: Map<string, string[]>, canonicalWorkId: string): ChatgptFullSyncOptions | undefined {
  return heldByCanonical.has(canonicalWorkId) ? { preserveSlugs: new Set(['primevideo']) } : undefined;
}

// ── chatgpt_full_sync モード: プレビュー ────────────────────────────────────
async function previewChatgptFullSync(
  chatgptServicesByCanonical: Map<string, ChatgptSyncServiceInput[]>,
  personsByCanonical: Map<string, string[]>,
  canonicalByInput: Map<string, { canonicalWorkId: string; resolvedViaAlias: boolean }>,
  ambiguousWorkIds: Set<string>,
  unresolvedWorkIds: string[],
  totalRows: number,
  missingFromLastPrompt: string[] | undefined,
  heldByCanonical: Map<string, string[]>,
): Promise<RunCsvImportResult> {
  const preview: PreviewWorkEntry[] = await Promise.all(
    [...chatgptServicesByCanonical.entries()].map(async ([canonicalWorkId, services]) => {
      const persons = personsByCanonical.get(canonicalWorkId) ?? [];
      const representativePerson = persons[0];
      const current = representativePerson ? await getWork(representativePerson, canonicalWorkId) : null;
      const currentProviders = current?.vodProviders ?? [];

      // DB書き込みなしでシミュレーション（実際の反映と同じcomputeChatgptFullSyncを再利用）
      const { diff, resultCount } = computeChatgptFullSync(currentProviders, services, undefined, syncOptionsFor(heldByCanonical, canonicalWorkId));

      const resolvedFrom = [...canonicalByInput.entries()]
        .filter(([, v]) => v.canonicalWorkId === canonicalWorkId && v.resolvedViaAlias)
        .map(([inputWorkId]) => inputWorkId);

      const warnings: string[] = [];
      if (!current) warnings.push('現在のVOD情報を取得できませんでした（新規登録として扱われます）');
      const isAmbiguous = ambiguousWorkIds.has(canonicalWorkId);
      if (isAmbiguous) warnings.push('ChatGPTが同名作品等の理由で対象作品を特定できなかった旨のnoteが含まれています。内容を確認してください。');
      const held = heldByCanonical.get(canonicalWorkId);
      if (held) warnings.push(`${PRIME_CHANNEL_SUSPECT_WARNING} 既存のPrime Video情報は変更しません。対象: ${held.join(' / ')}`);

      return {
        workId: canonicalWorkId,
        resolvedFrom: resolvedFrom.length > 0 ? resolvedFrom : undefined,
        title: current?.title ?? null,
        persons,
        services: services.map((s) => ({ providerName: s.providerName, availabilityType: s.type })),
        currentVodCount: currentProviders.length,
        afterVodCount: resultCount,
        currentUnknownCount: 0,
        afterUnknownCount: 0,
        warnings,
        errors: [] as string[],
        diff,
        ambiguous: isAmbiguous,
        heldRows: held,
      };
    }),
  );

  const hasFatalErrors = unresolvedWorkIds.length > 0 || preview.some((p) => p.errors.length > 0);
  const summary = preview.reduce(
    (acc, p) => {
      acc.added += p.diff?.added.length ?? 0;
      acc.updated += p.diff?.updated.length ?? 0;
      acc.removed += p.diff?.removed.length ?? 0;
      acc.unchanged += p.diff?.unchanged.length ?? 0;
      if (p.afterVodCount === 0) acc.zeroVod += 1;
      return acc;
    },
    { added: 0, updated: 0, removed: 0, unchanged: 0, zeroVod: 0 },
  );

  return {
    status: 200,
    body: {
      commit: false,
      mode: 'chatgpt_full_sync',
      preview,
      unresolvedWorkIds,
      hasFatalErrors,
      totalWorkIds: chatgptServicesByCanonical.size,
      totalRows,
      summary,
      missingFromLastPrompt,
      heldRowCount: [...heldByCanonical.values()].reduce((n, l) => n + l.length, 0),
    },
  };
}

// ── chatgpt_full_sync モード: 実行 ────────────────────────────────────────
// workId単位で「その作品に紐づく全人物行」への反映が全て成功した場合のみ調査済みとして扱う。
// 1件でも失敗した人物行があれば、その作品全体を失敗扱いとし調査済み更新は行わない
// （chatgptFullSyncVodProviders自体は人物行ごとに独立して調査履歴を書き込むため、
// 途中で失敗した場合に「一部の人物行だけ調査済み」という中途半端な状態が残りうる。
// これは既存のmanual_csvマージにも共通する複数人物行の性質であり、今回新たに導入した
// ものではない。失敗した作品はfailedWorkIdsとして報告し、管理者が再実行を判断できるようにする）。
async function applyChatgptFullSync(
  chatgptServicesByCanonical: Map<string, ChatgptSyncServiceInput[]>,
  personsByCanonical: Map<string, string[]>,
  ambiguousWorkIds: Set<string>,
  unresolvedWorkIds: string[],
  heldByCanonical: Map<string, string[]>,
): Promise<RunCsvImportResult> {
  let updatedWorks = 0;
  const applyErrors: string[] = [];
  const failedWorkIds: string[] = [];

  for (const [workId, services] of chatgptServicesByCanonical.entries()) {
    const persons = personsByCanonical.get(workId) ?? [];
    let workFailed = false;

    for (const personName of persons) {
      try {
        const before = await getWork(personName, workId);

        // 保留行が無い作品は従来どおりの呼び出し（オプションなし）
        const syncOptions = syncOptionsFor(heldByCanonical, workId);
        const result = syncOptions
          ? await chatgptFullSyncVodProviders(personName, workId, services, syncOptions)
          : await chatgptFullSyncVodProviders(personName, workId, services);
        if (!result) throw new Error('対象の作品行が見つかりません（非公開・削除済みの可能性）');

        try {
          await insertVodRecheckLog({
            personName,
            workId,
            action: 'complete',
            performedBy: 'admin:vod-recheck-csv-import:chatgpt_full_sync',
            note: `ChatGPT完全同期: 追加${result.diff.added.length}/更新${result.diff.updated.length}/削除${result.diff.removed.length}` +
              (ambiguousWorkIds.has(workId) ? '（同名作品等で特定不可の可能性あり）' : ''),
            updatedProviderCount: result.resultCount,
            activeCountBefore: before?.vodProviders?.length,
            activeCountAfter: result.resultCount,
          });
        } catch (logErr) {
          console.warn('[vod-recheck-csv-import] 監査ログ書き込み失敗:', String(logErr));
        }

        updatedWorks++;
      } catch (err) {
        workFailed = true;
        applyErrors.push(`${workId} / ${personName}: ${String(err)}`);
      }
    }

    if (workFailed) failedWorkIds.push(workId);
  }

  return {
    status: 200,
    body: {
      commit: true,
      mode: 'chatgpt_full_sync',
      updatedWorks,
      unresolvedWorkIds,
      errors: applyErrors,
      failedWorkIds: failedWorkIds.length > 0 ? failedWorkIds : undefined,
      heldRows: heldByCanonical.size > 0 ? [...heldByCanonical.values()].flat() : undefined,
    },
  };
}
