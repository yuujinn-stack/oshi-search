/**
 * Instagram予約投稿のstatus表示に関する定数・ヘルパー。
 * クライアントコンポーネント（ScheduleList等）とサーバーコード（schedule-store.ts等）の
 * 両方から参照する純粋な定義のみを置く（server-onlyな処理は含めない）。
 *
 * MAX_AUTO_RETRY_ATTEMPTSは元々schedule-store.ts（server-only）にあったが、
 * 管理画面での表示（「再試行回数: 2/3」等）にも必要なため、ここへ移動し
 * schedule-store.ts側はここから読み込む形にした（値の定義箇所は1か所のまま）。
 */

export type ScheduleStatus = 'draft' | 'scheduled' | 'processing' | 'published' | 'failed' | 'cancelled' | 'needs_review';

/** 自動再試行の上限（Cronのdue条件・管理画面の表示の両方で使う唯一の定義） */
export const MAX_AUTO_RETRY_ATTEMPTS = 3;

export const STATUS_LABEL: Record<ScheduleStatus, string> = {
  draft: '下書き',
  scheduled: '予約済み',
  processing: '投稿処理中',
  published: '投稿済み',
  failed: '投稿失敗',
  cancelled: 'キャンセル済み',
  needs_review: '要確認',
};

export const STATUS_STYLE: Record<ScheduleStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-50 text-blue-700',
  processing: 'bg-amber-50 text-amber-700',
  published: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400',
  needs_review: 'bg-orange-100 text-orange-800',
};

const FALLBACK_LABEL = '不明な状態';
const FALLBACK_STYLE = 'bg-gray-100 text-gray-500';

/** 未知のstatus文字列が来ても例外を投げず、画面が壊れないようにするための安全な取得関数 */
export function getStatusLabel(status: string): string {
  return (STATUS_LABEL as Record<string, string>)[status] ?? `${FALLBACK_LABEL}（${status}）`;
}

export function getStatusStyle(status: string): string {
  return (STATUS_STYLE as Record<string, string>)[status] ?? FALLBACK_STYLE;
}

export const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'scheduled', label: '予約済み' },
  { value: 'processing', label: '投稿処理中' },
  { value: 'published', label: '投稿済み' },
  { value: 'failed', label: '投稿失敗' },
  { value: 'needs_review', label: '要確認' },
  { value: 'cancelled', label: 'キャンセル済み' },
];
