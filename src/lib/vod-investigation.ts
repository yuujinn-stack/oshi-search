// VOD自動調査ジョブ機能の純粋関数群（DBアクセスなし）。
// 調査対象CSVアップロード後の自動調査（既存の supplementVodWithAI を再利用）を
// ジョブ単位で管理するための共通ロジック。
import { normalizeProviderName } from '@/lib/vod-dedup';
import type { VodProvider } from '@/types/vod';

// ── 上限・既定値 ──────────────────────────────────────────────────────────────
// 既存のCSV反映（一括操作50件上限）と合わせる
export const MAX_INVESTIGATION_ITEMS = 50;
// 1回のバッチ処理呼び出しで処理する作品数（サーバーレス関数の実行時間制限内に収める）
export const INVESTIGATION_BATCH_SIZE = 3;
// 外部API（OpenAI）への同時実行数の上限
export const INVESTIGATION_CONCURRENCY = 2;
// 自動リトライの上限（無限リトライ防止）。これを超えたら'failed'として確定する
export const MAX_AUTO_RETRY_COUNT = 2;

// 'applied' は承認済み結果を既存CSV反映ロジックへ反映済み（二重反映防止のガード用）
export type InvestigationJobStatus = 'pending' | 'running' | 'paused' | 'completed' | 'applied';
export type InvestigationItemStatus = 'pending' | 'investigating' | 'needs_review' | 'approved' | 'rejected' | 'failed';
export type InvestigationDecision = 'pending' | 'approved' | 'rejected' | 'needs_review' | 'manual';

export const VALID_DECISIONS: readonly InvestigationDecision[] = ['pending', 'approved', 'rejected', 'needs_review', 'manual'];

export function isValidDecision(value: unknown): value is InvestigationDecision {
  return typeof value === 'string' && (VALID_DECISIONS as readonly string[]).includes(value);
}

export interface InvestigationProgress {
  total: number;
  pending: number;
  investigating: number;
  needsReview: number;
  approved: number;
  rejected: number;
  failed: number;
}

export function computeInvestigationProgress(items: Array<{ status: string }>): InvestigationProgress {
  const progress: InvestigationProgress = {
    total: items.length, pending: 0, investigating: 0, needsReview: 0, approved: 0, rejected: 0, failed: 0,
  };
  for (const item of items) {
    switch (item.status) {
      case 'pending': progress.pending++; break;
      case 'investigating': progress.investigating++; break;
      case 'needs_review': progress.needsReview++; break;
      case 'approved': progress.approved++; break;
      case 'rejected': progress.rejected++; break;
      case 'failed': progress.failed++; break;
    }
  }
  return progress;
}

// 一括反映してよいか（1件でも未確認＝decisionがpending/needs_reviewの候補があれば不可）
export function canBulkApply(items: Array<{ decision: string; status: string }>): boolean {
  if (items.length === 0) return false;
  return items.every((i) => i.decision === 'approved' || i.decision === 'manual' || i.decision === 'rejected');
}

function isUnknownProvider(p: VodProvider): boolean {
  const name = (p.providerName ?? '').trim().toLowerCase();
  return name === '' || name === 'unknown' || p.type === 'unknown';
}

/**
 * AI調査結果（生のVodProvider配列）を、候補として保存してよい形に整形する。
 *
 * - 終了済みサービス（dTV等、provider-store.getInactiveProviderSlugsで判定）は候補から除外する。
 *   dTVをLeminoへ自動変換することはしない（単純に除外するのみ）。
 * - フィルタ後に1件も残らない場合（＝有効サービスを確認できなかった場合）のみ、
 *   単一のunknown候補を1件作成する。
 * - フィルタ後に1件以上残る場合はunknownを追加しない（有効サービスとunknownの混在を防ぐ）。
 */
export function buildInvestigationCandidates(
  aiProviders: VodProvider[],
  terminatedSlugs: Set<string>,
): VodProvider[] {
  const filtered = aiProviders.filter((p) => {
    if (isUnknownProvider(p)) return false; // AIが自らunknownを返した場合も除外（重複防止、後段で1件だけ作る）
    return !terminatedSlugs.has(normalizeProviderName(p.providerName ?? ''));
  });

  if (filtered.length > 0) return filtered;

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  return [{
    providerId: 0,
    providerName: 'unknown',
    type: 'unknown',
    countryCode: 'JP',
    source: 'openai_web_search',
    sourceLabel: 'AI Web検索補完',
    confidence: 'low',
    checkedDate: today,
    note: '調査時点で配信サービスを確認できませんでした',
    createdAt: now,
    updatedAt: now,
  }];
}

/**
 * 候補を承認可能か判定する。
 * unknown（配信なし確認済み）は承認可能。ただし、unknown以外（実在サービスを主張する候補）は
 * 1件でもsourceUrl/officialUrlが無いものがあれば承認不可（要再調査・手動修正のみ許可）とする。
 * ＝「公式URLなしの候補を自動承認しない」の安全弁。
 */
export function canApproveCandidates(candidates: VodProvider[]): boolean {
  if (candidates.length === 0) return false;
  return candidates.every((p) => {
    if (isUnknownProvider(p)) return true;
    return Boolean(p.sourceUrl || p.officialUrl);
  });
}

// ── 費用概算 ──────────────────────────────────────────────────────────────────
export interface InvestigationCostEstimate {
  targetCount: number;
  estimatedSearchCalls: number;
  estimatedOpenAiCalls: number;
  estimatedCostUsd: number;
  estimatedCostJpy: number;
  maxItems: number;
}

/**
 * 実績データ（openai_usage_logs の feature='vod_research' 平均）から費用概算を計算する。
 * 実績が無い場合は呼び出し側が保守的な既定値（avgCostPerCallUsd）を渡す。
 */
export function estimateInvestigationCost(
  targetCount: number,
  avgCostPerCallUsd: number,
  usdToJpy: number,
): InvestigationCostEstimate {
  const estimatedOpenAiCalls = targetCount; // 現状は1作品につき1回のWeb検索補完呼び出し
  const estimatedCostUsd = estimatedOpenAiCalls * avgCostPerCallUsd;
  return {
    targetCount,
    estimatedSearchCalls: estimatedOpenAiCalls,
    estimatedOpenAiCalls,
    estimatedCostUsd,
    estimatedCostJpy: estimatedCostUsd * usdToJpy,
    maxItems: MAX_INVESTIGATION_ITEMS,
  };
}

// ── 承認済み候補 → 取り込みCSV変換 ─────────────────────────────────────────────
// 既存の /api/admin/vod-recheck/csv-import と全く同じ列構成のCSVを組み立てることで、
// 「既存のCSV反映ロジックを再利用する」を文字通り実現する（別ロジックを新設しない）。
function csvEscape(val: string): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface ApprovedInvestigationItem {
  workId: string;
  providers: VodProvider[];
}

export function buildImportCsvFromApprovedItems(items: ApprovedInvestigationItem[]): string {
  const header = 'workId,vodService,availabilityType,confidence,sourceUrl,note';
  const rows = items.flatMap((item) =>
    item.providers.map((p) => [
      item.workId,
      p.providerName,
      p.type,
      p.confidence ?? '',
      p.sourceUrl ?? p.officialUrl ?? '',
      p.note ?? '',
    ].map(csvEscape).join(',')),
  );
  return [header, ...rows].join('\n');
}
