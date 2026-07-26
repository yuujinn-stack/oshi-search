// VOD再確認CSVの取り込み・反映ロジック（プレビュー・実行の両方を1関数に集約）。
// /api/admin/vod-recheck/csv-import（手動貼り付け・ファイル選択）から呼ばれる。
// workIdのcanonical解決・非活性化作品の拒否・manual_csv保存・監査ログ・処理状態変更の
// ロジックをこの1関数に集約する。
import { MAX_CSV_FILE_BYTES } from '@/lib/csv-parse';
import { parseAndValidateImportCsv } from '@/lib/vod-recheck-csv';
import { resolveActiveWorkTargets } from '@/lib/vod-recheck-store';
import { upsertManualCsvVodProviders, mergeManualCsvVodProviders, getWork } from '@/lib/work-store';
import { insertVodRecheckLog } from '@/db/write';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { detectRecheckReasons } from '@/lib/vod-recheck';
import type { VodProvider, VodProviderType } from '@/types/vod';

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
}

interface PreviewResponse {
  commit: false;
  preview: PreviewWorkEntry[];
  unresolvedWorkIds: string[];
  hasFatalErrors: boolean;
  totalWorkIds: number;
  totalRows: number;
}

interface ApplyResponse {
  commit: true;
  updatedWorks: number;
  unresolvedWorkIds: string[];
  errors: string[];
}

export async function runVodRecheckCsvImport(
  csv: string,
  commit: boolean,
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

  for (const row of parsed) {
    const target = resolved.get(row.workId);
    if (!target) continue;
    canonicalByInput.set(row.workId, { canonicalWorkId: target.canonicalWorkId, resolvedViaAlias: target.resolvedViaAlias });
    personsByCanonical.set(target.canonicalWorkId, target.personNames);

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

      return {
        workId: canonicalWorkId,
        resolvedFrom: resolvedFrom.length > 0 ? resolvedFrom : undefined,
        title: current?.title ?? null,
        persons,
        services: providers.map((p) => ({ providerName: p.providerName, availabilityType: p.type })),
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
        preview,
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
      updatedWorks,
      unresolvedWorkIds,
      errors: applyErrors,
    },
  };
}
