// POST /api/admin/vod-recheck/csv-import
// VOD再確認調査の結果CSVを取り込み、manual_csv として配信情報を保存する。
// 必須列: workId, vodService　（1作品1サービス1行）
// 任意列: availabilityType（flatrate/rent/buy/free/unknown）, sourceUrl, confidence, note
//
// CSVはファイル選択・貼り付けのどちらから来ても同じ文字列としてこのAPIへ届くため、
// 検証ロジックは完全に共通（ファイル選択と貼り付けで結果が食い違うことはない）。
//
// workIdの解決は resolveActiveWorkTargets() を使い、候補一覧・CSV出力と同じ対象判定
// ロジックを共有する。work_aliasesに登録された旧workIdはcanonical workIdへ解決され、
// 非活性化（hidden/deleted）された作品・存在しないworkIdは解決不可（拒否）として扱う。
// 同一workIdに複数人物が紐づく場合は、その全員に同じ配信情報を適用する。
// commit=false（デフォルト）: プレビューのみ・DB変更なし。commit=true: 実際に保存 + 監査ログ記録。
// いずれの場合も公開状態（status/deleted）は変更しない（vod_dataのみ更新）。
import { NextRequest, NextResponse } from 'next/server';
import { MAX_CSV_FILE_BYTES } from '@/lib/csv-parse';
import { parseAndValidateImportCsv } from '@/lib/vod-recheck-csv';
import { resolveActiveWorkTargets } from '@/lib/vod-recheck-store';
import { upsertManualCsvVodProviders, mergeManualCsvVodProviders, getWork } from '@/lib/work-store';
import { insertVodRecheckLog } from '@/db/write';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { detectRecheckReasons } from '@/lib/vod-recheck';
import type { VodProvider } from '@/types/vod';

export const dynamic = 'force-dynamic';

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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { csv?: unknown; commit?: unknown };
  const { csv, commit } = body;

  if (typeof csv !== 'string' || !csv.trim()) {
    return NextResponse.json({ error: 'csv（文字列）が必要です' }, { status: 400 });
  }

  // ファイルサイズ相当のチェック（ファイル選択・貼り付けの両方に共通で適用）
  const byteLength = Buffer.byteLength(csv, 'utf8');
  if (byteLength > MAX_CSV_FILE_BYTES) {
    const maxMb = (MAX_CSV_FILE_BYTES / (1024 * 1024)).toFixed(0);
    return NextResponse.json({ error: `CSVのサイズが大きすぎます（上限${maxMb}MB）` }, { status: 400 });
  }

  // CSV解析・行検証（重複行・必須列・availabilityType等）はファイル選択・貼り付け共通のロジック
  const parseResult = parseAndValidateImportCsv(csv);
  if (!parseResult.ok) {
    return NextResponse.json({ error: parseResult.error, details: parseResult.details }, { status: 400 });
  }
  const parsed = parseResult.rows;

  // workId解決: 候補一覧・CSV出力と共通のロジック（resolveActiveWorkTargets）を使う。
  // 旧workId（work_aliases登録済み）はcanonical workIdへ解決され、非活性化・存在しない
  // workIdはunresolvedWorkIdsに入る（DBは変更しない・読み取りのみ）。
  const workIds = [...new Set(parsed.map((p) => p.workId))];
  const { resolved, unresolved: unresolvedWorkIds } = await resolveActiveWorkTargets(workIds);

  // canonical workId単位でVodProviderへ変換（同一canonicalに複数の入力workId・複数サービス行が
  // 集まる場合は1つの配列にまとめる）
  const providersByCanonical = new Map<string, VodProvider[]>();
  const personsByCanonical = new Map<string, string[]>();
  const canonicalByInput = new Map<string, { canonicalWorkId: string; resolvedViaAlias: boolean }>();

  for (const row of parsed) {
    const target = resolved.get(row.workId);
    if (!target) continue; // unresolved（未解決）はスキップ。unresolvedWorkIdsで報告済み
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
    // ── プレビュー: DBは読み取りのみ（現在の状態を見るだけ）。書き込みは一切行わない ──
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
        warnings,
        errors: [] as string[],
      };
    }));

    // 1件でも未解決（存在しない・非活性化されたworkId）があれば反映を無効化する
    const hasFatalErrors = unresolvedWorkIds.length > 0 || preview.some((p) => p.errors.length > 0);

    return NextResponse.json({
      commit: false,
      preview,
      unresolvedWorkIds,
      hasFatalErrors,
      totalWorkIds: providersByCanonical.size,
      totalRows: parsed.length,
    });
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
          console.warn('[vod-recheck/csv-import] 監査ログ書き込み失敗:', String(logErr));
        }

        updatedWorks++;
      } catch (err) {
        applyErrors.push(`${workId} / ${personName}: ${String(err)}`);
      }
    }
  }

  return NextResponse.json({
    commit: true,
    updatedWorks,
    unresolvedWorkIds,
    errors: applyErrors,
  });
}
