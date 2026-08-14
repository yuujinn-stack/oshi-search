// /admin/vod-recheck の一覧データ組み立て（DBアクセス + 理由判定 + 表示ラベル付与）。
// API route（/api/admin/vod-recheck/candidates）とサーバーコンポーネント（page.tsx の初回表示）
// の両方から呼ばれるため、ロジックをここに集約して重複させない。
import { neonSql } from '@/db/client';
import {
  getRecheckCandidates,
  getClickCountsForWorkIds,
  getHighTrafficWorkIds,
  getChatgptResearchProgress,
  activeWorkFragment,
  DEFAULT_PAGE_SIZE,
  type RecheckListParams,
  type ChatgptResearchProgress,
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
import { getVodStaleStatus, VOD_STALE_STATUS_LABEL, type VodStaleStatus } from '@/lib/vod-stale';

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
  /** 確認からの経過日数による分類（fresh/aging/stale/unknown）。既存の再確認優先度とは別の補助表示。 */
  staleStatus: VodStaleStatus;
  staleStatusLabel: string;
  /** Redisから正常に取得できた場合のみ数値。取得できなかった場合はnull（「0件」と誤認させないため） */
  clickCount: number | null;
  reasonCodes: RecheckReasonCode[];
  reasonLabels: string[];
  priority: RecheckPriority;
  priorityLabel: string;
  processStatus: string;
  processStatusLabel: string;
  workUrl: string | null;
  adminUrl: string;
  /** 完全一致タイトルの別workIdが存在する場合true（簡易チェック。正規化タイトルの厳密比較ではない） */
  hasSameTitleWork: boolean;
  /** ChatGPT完全調査の履歴（未調査ならnull） */
  lastChatgptResearchAt: number | null;
  chatgptResultCount: number | null;
}

export interface RecheckListResult {
  items: RecheckListItem[];
  total: number;
  page: number;
  pageSize: number;
  /** アクセス数（Redis work:click:*）を正常に取得できたか。falseの場合は一覧のclickCountが全件nullになる */
  clickCountsAvailable: boolean;
  /** ChatGPT完全調査の進捗（全公開作品に対する調査済み件数） */
  chatgptProgress: ChatgptResearchProgress;
}

export async function fetchRecheckListPage(params: RecheckListParams): Promise<RecheckListResult> {
  // アクセス上位セットは常に一度だけ計算する（バッジ表示・high_traffic系フィルタ双方で使用）。
  // Redis未設定・接続失敗時は空配列（= 全件「アクセス上位ではない」として継続表示）。
  const [terminatedSlugs, highTrafficWorkIds, chatgptProgress] = await Promise.all([
    getInactiveProviderSlugs(),
    getHighTrafficWorkIds(),
    getChatgptResearchProgress(),
  ]);
  const highTrafficSet = new Set(highTrafficWorkIds);

  const result = await getRecheckCandidates({ ...params, highTrafficWorkIds });
  const { counts: clickCounts, available: clickCountsAvailable } = await getClickCountsForWorkIds(result.rows.map((r) => r.workId));
  const now = Date.now();

  // 同名作品チェック（簡易版・完全一致タイトルのみ）: 今回のページに表示するタイトルのうち、
  // 異なるworkIdが2件以上存在するものを検出する。正規化タイトルでの厳密比較はコストが高いため
  // 行わない（既存のCSVインポート安全化[vod-work-match.ts]とは別の、一覧表示専用の簡易注意表示）。
  const pageTitles = [...new Set(result.rows.map((r) => r.title))];
  const sameTitleSet = await getExactSameTitleWorkIds(pageTitles);

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
    const daysSinceLastCheck = detection.daysSinceLastCheck ?? null;
    const staleStatus = getVodStaleStatus(daysSinceLastCheck);

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
      daysSinceLastCheck,
      staleStatus,
      staleStatusLabel: VOD_STALE_STATUS_LABEL[staleStatus],
      clickCount: clickCountsAvailable ? (clickCounts.get(row.workId) ?? 0) : null,
      reasonCodes: detection.codes,
      reasonLabels: detection.codes.map((c) => RECHECK_REASON_LABEL[c]),
      priority: detection.priority,
      priorityLabel: RECHECK_PRIORITY_LABEL[detection.priority],
      processStatus,
      processStatusLabel: RECHECK_STATUS_LABEL[processStatus],
      workUrl: getWorkPublicUrl({ workId: row.workId }),
      adminUrl: '/admin/work-check',
      hasSameTitleWork: sameTitleSet.has(row.workId),
      lastChatgptResearchAt: row.lastChatgptResearchAt ?? null,
      chatgptResultCount: row.chatgptResultCount ?? null,
    };
  });

  return { items, total: result.total, page: result.page, pageSize: result.pageSize, clickCountsAvailable, chatgptProgress };
}

// 指定タイトル群のうち、実際に異なるworkIdが2件以上ヒットするタイトルに該当するworkIdの集合を返す。
// 完全一致文字列での判定（正規化はしない）。0件・1件しかヒットしないタイトルは対象外。
async function getExactSameTitleWorkIds(titles: string[]): Promise<Set<string>> {
  if (titles.length === 0) return new Set();
  const rows = await neonSql`
    SELECT title, array_agg(DISTINCT id) AS work_ids
    FROM works
    WHERE title = ANY(${titles}) AND ${activeWorkFragment()}
    GROUP BY title
    HAVING COUNT(DISTINCT id) > 1
  `;
  const ids = new Set<string>();
  for (const r of rows) {
    for (const id of (r.work_ids as string[])) ids.add(id);
  }
  return ids;
}
