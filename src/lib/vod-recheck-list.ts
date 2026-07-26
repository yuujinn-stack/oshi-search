// /admin/vod-recheck の一覧データ組み立て（DBアクセス + 理由判定 + 表示ラベル付与）。
// API route（/api/admin/vod-recheck/candidates）とサーバーコンポーネント（page.tsx の初回表示）
// の両方から呼ばれるため、ロジックをここに集約して重複させない。
import {
  getRecheckCandidates,
  getClickCountsForWorkIds,
  getHighTrafficWorkIds,
  DEFAULT_PAGE_SIZE,
  type RecheckListParams,
} from '@/lib/vod-recheck-store';
import {
  detectRecheckReasons,
  resolveRecheckProcessStatus,
  RECHECK_REASON_LABEL,
  RECHECK_PRIORITY_LABEL,
  RECHECK_STATUS_LABEL,
  type RecheckReasonCode,
  type RecheckPriority,
} from '@/lib/vod-recheck';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { getWorkPublicUrl } from '@/lib/work-url';
import { WORK_TYPE_LABEL, type WorkType, type WorkRecord } from '@/types/work';

export { DEFAULT_PAGE_SIZE };

export interface RecheckListItem {
  workId: string;
  personName: string;
  title: string;
  workType: string;
  workTypeLabel: string;
  releaseYear: number | null;
  personCount: number;
  activeCount: number;
  unknownCount: number;
  lastCheckedAt: number | null;
  daysSinceLastCheck: number | null;
  clickCount: number;
  reasonCodes: RecheckReasonCode[];
  reasonLabels: string[];
  priority: RecheckPriority;
  priorityLabel: string;
  processStatus: string;
  processStatusLabel: string;
  workUrl: string | null;
  adminUrl: string;
}

export interface RecheckListResult {
  items: RecheckListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchRecheckListPage(params: RecheckListParams): Promise<RecheckListResult> {
  // アクセス上位セットは常に一度だけ計算する（バッジ表示・high_traffic系フィルタ双方で使用）。
  // Redis未設定・接続失敗時は空配列（= 全件「アクセス上位ではない」として継続表示）。
  const [terminatedSlugs, highTrafficWorkIds] = await Promise.all([
    getInactiveProviderSlugs(),
    getHighTrafficWorkIds(),
  ]);
  const highTrafficSet = new Set(highTrafficWorkIds);

  const result = await getRecheckCandidates({ ...params, highTrafficWorkIds });
  const clickCounts = await getClickCountsForWorkIds(result.rows.map((r) => r.workId));
  const now = Date.now();

  const items: RecheckListItem[] = result.rows.map((row) => {
    const isPostMergeUnchecked = row.mergedAt !== undefined && (
      (row.lastVodCheckAt === undefined && row.vodAiCheckedAt === undefined) ||
      Math.max(row.lastVodCheckAt ?? 0, row.vodAiCheckedAt ?? 0) < row.mergedAt
    );
    const detection = detectRecheckReasons({
      vodProviders: row.vodProviders,
      lastVodCheckAt: row.lastVodCheckAt,
      vodAiCheckedAt: row.vodAiCheckedAt,
      terminatedSlugs,
      isHighTraffic: highTrafficSet.has(row.workId),
      isPostMergeUnchecked,
      now,
    });
    const processStatus = resolveRecheckProcessStatus(row.vodCheckStatus as WorkRecord['vodCheckStatus']);

    return {
      workId: row.workId,
      personName: row.personName,
      title: row.title,
      workType: row.workType,
      workTypeLabel: WORK_TYPE_LABEL[row.workType as WorkType] ?? row.workType,
      releaseYear: row.releaseYear,
      personCount: row.personCount,
      activeCount: detection.activeCount,
      unknownCount: detection.unknownCount,
      lastCheckedAt: detection.lastCheckedAt ?? null,
      daysSinceLastCheck: detection.daysSinceLastCheck ?? null,
      clickCount: clickCounts.get(row.workId) ?? 0,
      reasonCodes: detection.codes,
      reasonLabels: detection.codes.map((c) => RECHECK_REASON_LABEL[c]),
      priority: detection.priority,
      priorityLabel: RECHECK_PRIORITY_LABEL[detection.priority],
      processStatus,
      processStatusLabel: RECHECK_STATUS_LABEL[processStatus],
      workUrl: getWorkPublicUrl({ workId: row.workId }),
      adminUrl: '/admin/work-check',
    };
  });

  return { items, total: result.total, page: result.page, pageSize: result.pageSize };
}
