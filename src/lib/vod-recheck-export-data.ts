// VOD再確認: 選択対象から調査用データ行を解決するDBアクセス層。
// /api/admin/vod-recheck/csv-export（CSVダウンロード）と
// /api/admin/vod-recheck/research-prompt（ChatGPT調査用プロンプト生成）の両方が
// このロジックを共有する。workIdのcanonical解決（旧workId→canonical、非活性化作品の除外）・
// currentVodServicesの算出（unknown除外・終了済みサービス[dTV等]除外）を二重実装しないため。
import { neonSql } from '@/db/client';
import { activeWorkFragment, resolveActiveWorkTargets } from '@/lib/vod-recheck-store';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { deduplicateProviders, isConfirmedVodAvailability } from '@/lib/vod-dedup';
import { detectRecheckReasons, RECHECK_REASON_LABEL, RECHECK_PRIORITY_LABEL } from '@/lib/vod-recheck';
import type { VodProvider } from '@/types/vod';

export interface VodRecheckExportItem {
  personName: string;
  workId: string;
}

export interface VodRecheckExportDataRow {
  workId: string;
  personName: string;
  title: string;
  workType: string;
  releaseYear: number | null;
  roleName: string | null;
  currentVodServices: string;
  lastCheckedAt: string;
  recheckReason: string;
  priority: string;
}

export interface ResolveVodRecheckExportDataResult {
  rows: VodRecheckExportDataRow[];
  unresolvedWorkIds: string[];
}

// 選択された{personName, workId}から、canonical workId解決・非活性化作品除外を経て
// 調査用データ行（1行1人物、既存CSV運用と同じ方式）を組み立てる。
export async function resolveVodRecheckExportData(
  items: VodRecheckExportItem[],
): Promise<ResolveVodRecheckExportDataResult> {
  const workIds = [...new Set(items.map((i) => i.workId))];

  const { resolved, unresolved } = await resolveActiveWorkTargets(workIds);
  const canonicalWorkIds = [...new Set([...resolved.values()].map((t) => t.canonicalWorkId))];

  if (canonicalWorkIds.length === 0) {
    return { rows: [], unresolvedWorkIds: unresolved };
  }

  // 選択されたworkIdに紐づく全人物行を取得（1行1人物・既存CSV運用と同じ方式）
  const dbRows = await neonSql`
    SELECT person_name, id AS work_id, title, type, release_year, role_name, vod_data
    FROM works
    WHERE id = ANY(${canonicalWorkIds}) AND ${activeWorkFragment()}
    ORDER BY id, person_name
  `;

  const terminatedSlugs = await getInactiveProviderSlugs();
  const now = Date.now();

  const rows: VodRecheckExportDataRow[] = dbRows.map((r) => {
    const vodData = (r.vod_data ?? {}) as Record<string, unknown>;
    const vodProviders = (vodData.vodProviders as VodProvider[] | undefined) ?? [];
    const lastVodCheckAt = vodData.lastVodCheckAt as number | undefined;
    const vodAiCheckedAt = vodData.vodAiCheckedAt as number | undefined;

    const detection = detectRecheckReasons({
      vodProviders,
      lastVodCheckAt,
      vodAiCheckedAt,
      terminatedSlugs,
      isHighTraffic: false,
      isPostMergeUnchecked: false,
      now,
    });

    // unknown・終了済みサービス（dTV等）を除外した、現在有効な配信サービス名のみを結合する
    const currentVodServices = deduplicateProviders(vodProviders)
      .filter((p) => isConfirmedVodAvailability(p, terminatedSlugs))
      .map((p) => p.providerName)
      .join(', ');

    const lastCheckedAt = detection.lastCheckedAt
      ? new Date(detection.lastCheckedAt).toISOString().slice(0, 10)
      : '';

    return {
      workId: r.work_id as string,
      personName: r.person_name as string,
      title: r.title as string,
      workType: r.type as string,
      releaseYear: r.release_year != null ? (r.release_year as number) : null,
      roleName: (r.role_name as string | null) ?? null,
      currentVodServices,
      lastCheckedAt,
      recheckReason: detection.codes.map((c) => RECHECK_REASON_LABEL[c]).join('/'),
      priority: RECHECK_PRIORITY_LABEL[detection.priority],
    };
  });

  return { rows, unresolvedWorkIds: unresolved };
}
