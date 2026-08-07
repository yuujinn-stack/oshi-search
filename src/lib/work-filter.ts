// 人物ページ「出演作品」セクションの検索・絞り込み・並べ替えを行う純粋関数。
//
// 重要: 「配信中かどうか」の判定は vod-dedup.ts の isConfirmedVodAvailability を
// 唯一の判定ロジックとして再利用する。ここで独自の配信判定を作らない。
// isConfirmedVodAvailability は type==='unknown' / providerName未特定 / hidden /
// AI低確度 / 終了済みサービスをすべて「配信なし」として除外するため、
// unknown が「配信あり」に混入することはない。
import type { WorkRecord } from '@/types/work';
import {
  deduplicateProviders,
  isConfirmedVodAvailability,
  normalizeProviderName,
  getVodProviderDisplayInfo,
} from '@/lib/vod-dedup';
import { getWorkDisplayImage, getRenderableWorkImageUrl } from '@/lib/work-image';

export type WorkSortMode = 'streaming_first' | 'newest' | 'oldest';

export interface WorkFilterOptions {
  searchText: string;
  decade: string;       // 'all' または getWorkDecadeLabel() が返す値
  providerSlug: string; // 'all' または normalizeProviderName() が返す正規化スラグ
  sortMode: WorkSortMode;
}

export const DEFAULT_WORK_FILTER: WorkFilterOptions = {
  searchText: '',
  decade: 'all',
  providerSlug: 'all',
  sortMode: 'streaming_first',
};

export function isDefaultWorkFilter(options: WorkFilterOptions): boolean {
  return (
    options.searchText.trim() === '' &&
    options.decade === 'all' &&
    options.providerSlug === 'all' &&
    options.sortMode === 'streaming_first'
  );
}

// ── 配信中判定（既存ロジックの再利用のみ。新規判定は作らない） ──────────────────
export function hasConfirmedStreaming(work: WorkRecord): boolean {
  return (work.vodProviders ?? []).some((p) => isConfirmedVodAvailability(p));
}

// ── 年代 ─────────────────────────────────────────────────────────────────
export function getWorkDecadeLabel(releaseYear?: number): string | null {
  if (!releaseYear || releaseYear < 1000) return null;
  const decade = Math.floor(releaseYear / 10) * 10;
  return `${decade}年代`;
}

export function getAvailableDecades(works: WorkRecord[]): string[] {
  const set = new Set<string>();
  for (const w of works) {
    const label = getWorkDecadeLabel(w.releaseYear);
    if (label) set.add(label);
  }
  // 新しい年代が先頭に来るよう降順（数値部分で比較）
  return [...set].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
}

// ── 配信サービス一覧（フィルタ用選択肢） ───────────────────────────────────────
export interface WorkProviderOption {
  slug: string;
  displayName: string;
}

export function getAvailableProviders(works: WorkRecord[]): WorkProviderOption[] {
  const map = new Map<string, string>();
  for (const w of works) {
    const confirmed = deduplicateProviders(
      (w.vodProviders ?? []).filter((p) => isConfirmedVodAvailability(p)),
    );
    for (const p of confirmed) {
      const slug = normalizeProviderName(p.providerName);
      if (!map.has(slug)) {
        map.set(slug, getVodProviderDisplayInfo(p.providerName).displayName);
      }
    }
  }
  return [...map.entries()]
    .map(([slug, displayName]) => ({ slug, displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));
}

function workMatchesProvider(work: WorkRecord, providerSlug: string): boolean {
  if (providerSlug === 'all') return true;
  return (work.vodProviders ?? []).some(
    (p) => isConfirmedVodAvailability(p) && normalizeProviderName(p.providerName) === providerSlug,
  );
}

// ── タイトル検索 ─────────────────────────────────────────────────────────────
function workMatchesSearch(work: WorkRecord, searchText: string): boolean {
  const q = searchText.trim().toLowerCase();
  if (!q) return true;
  return (
    work.title.toLowerCase().includes(q) ||
    (work.originalTitle ?? '').toLowerCase().includes(q)
  );
}

// ── 画像アスペクト分類 ────────────────────────────────────────────────────────
// WorkCard.tsx の getPosterLayout と同一の判定基準（TMDb画像=縦長ポスター、
// それ以外（YouTubeサムネイル・OG画像等）=横長）を用いる。表示側と食い違わないよう
// ここでも同じ基準のみを使う。
export type WorkImageAspectGroup = 'portrait' | 'landscape' | 'none';

export function getWorkImageAspectGroup(work: WorkRecord): WorkImageAspectGroup {
  const url = getRenderableWorkImageUrl(getWorkDisplayImage(work));
  if (!url) return 'none';
  return url.includes('image.tmdb.org') ? 'portrait' : 'landscape';
}

// 配信あり優先グループ内で、画像アスペクト比が近いカード同士がなるべく近くに
// 並ぶよう並べ替える（安定ソート＝各グループ内の相対順序は維持する）。
function groupByAspect(works: WorkRecord[]): WorkRecord[] {
  const portrait  = works.filter((w) => getWorkImageAspectGroup(w) === 'portrait');
  const landscape = works.filter((w) => getWorkImageAspectGroup(w) === 'landscape');
  const none      = works.filter((w) => getWorkImageAspectGroup(w) === 'none');
  return [...portrait, ...landscape, ...none];
}

// ── フィルタ＋並べ替え本体 ────────────────────────────────────────────────────
export function filterAndSortWorks(works: WorkRecord[], options: WorkFilterOptions): WorkRecord[] {
  const filtered = works.filter((w) => {
    if (!workMatchesSearch(w, options.searchText)) return false;
    if (options.decade !== 'all' && getWorkDecadeLabel(w.releaseYear) !== options.decade) return false;
    if (!workMatchesProvider(w, options.providerSlug)) return false;
    return true;
  });

  if (options.sortMode === 'newest') {
    return [...filtered].sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
  }
  if (options.sortMode === 'oldest') {
    return [...filtered].sort((a, b) => (a.releaseYear ?? 0) - (b.releaseYear ?? 0));
  }

  // streaming_first（デフォルト）: 配信あり優先が最優先条件。
  // 画像アスペクト分類は「配信あり」「配信なし」各グループの内部でのみ適用し、
  // 配信ありの作品が画像を揃えるために配信なしグループより後ろへ落ちることはない。
  const streaming = filtered.filter(hasConfirmedStreaming);
  const rest = filtered.filter((w) => !hasConfirmedStreaming(w));
  return [...groupByAspect(streaming), ...groupByAspect(rest)];
}
