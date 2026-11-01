// 動画「フォロー獲得リール」の作品選択欄の絞り込み・並べ替え（純粋関数。'use client' からも import 可）。
//
// ・配信先: 公開画面と同じ判定（src/lib/vod-availability.ts の getConfirmedProviders。hidden / unknown / AI低確度 /
//   停止中サービスを除外し、同じサービスを1件に集約）を通った配信だけを、サーバー（follow-target.ts）が作品に付ける。
//   ここではその結果を数える・絞るだけで、配信の判定はしない。
// ・ジャンル: サイトの表示分類（getDisplayWorkType。workDisplayType の明示値 → 作品名の規則）を、作品選択用の大きな分類へ
//   一覧で対応させるだけ（作品名などから新しく推測しない）。配信番組・Web は独立した分類のまま（バラエティ等へ寄せない）。

import type { DisplayWorkType } from '@/types/work';
import type { FollowWork } from '@/lib/video-follow-reel';
import { VOD_PROVIDER_DISPLAY_NAMES } from '@/lib/vod-provider-names';

export const FOLLOW_PICK_GENRES = ['drama', 'movie', 'variety', 'music_idol', 'anime', 'documentary', 'stage_live', 'web', 'other'] as const;
export type FollowPickGenre = (typeof FOLLOW_PICK_GENRES)[number];

export const FOLLOW_PICK_GENRE_LABEL: Record<FollowPickGenre, string> = {
  drama: 'ドラマ',
  movie: '映画',
  variety: 'バラエティ',
  music_idol: '音楽・アイドル番組',
  anime: 'アニメ',
  documentary: 'ドキュメンタリー',
  stage_live: '舞台・ライブ映像',
  web: '配信番組・Web',
  other: 'その他',
};

const DISPLAY_TYPE_TO_PICK_GENRE: Record<DisplayWorkType, FollowPickGenre> = {
  drama: 'drama',
  movie: 'movie',
  variety: 'variety',
  music: 'music_idol',
  idol_show: 'music_idol',
  anime_voice: 'anime',
  documentary: 'documentary',
  stage: 'stage_live',
  live: 'stage_live',
  web: 'web',
  other: 'other',
};

export function followPickGenre(w: Pick<FollowWork, 'genre'>): FollowPickGenre {
  return DISPLAY_TYPE_TO_PICK_GENRE[w.genre] ?? 'other';
}

export function isAvailableFollowWork(w: Pick<FollowWork, 'available'>): boolean {
  return (w.available?.length ?? 0) > 0;
}

export type FollowWorkSort = 'year_desc' | 'year_asc' | 'title';
export const FOLLOW_WORK_SORT_LABEL: Record<FollowWorkSort, string> = { year_desc: '公開年の新しい順', year_asc: '公開年の古い順', title: '作品名順' };

export interface FollowWorkFilter {
  /** 配信先が確認できる作品だけ */
  availableOnly: boolean;
  genre: FollowPickGenre | 'all';
  /** 配信サービス（FollowAvailability.key）。'all' は絞り込まない */
  service: string;
  query: string;
  sort: FollowWorkSort;
}

export const DEFAULT_FOLLOW_WORK_FILTER: FollowWorkFilter = { availableOnly: true, genre: 'all', service: 'all', query: '', sort: 'year_desc' };

const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const byTitle = (a: FollowWork, b: FollowWork) => a.title.localeCompare(b.title, 'ja') || a.id.localeCompare(b.id);

/** 並べ替え（出演年が無い作品はどの年順でも最後。同じ年は作品名順 → ID で固定） */
export function sortFollowWorks(works: FollowWork[], sort: FollowWorkSort): FollowWork[] {
  const out = [...works];
  if (sort === 'title') return out.sort(byTitle);
  const dir = sort === 'year_desc' ? -1 : 1;
  return out.sort((a, b) => {
    if (a.year !== b.year) {
      if (a.year === null) return 1;
      if (b.year === null) return -1;
      return (a.year - b.year) * dir;
    }
    return byTitle(a, b);
  });
}

/** 作品名検索・ジャンル・配信サービス・配信先の有無で絞り、並べ替える */
export function filterFollowWorks(works: FollowWork[], f: FollowWorkFilter): FollowWork[] {
  const q = norm(f.query);
  return sortFollowWorks(
    works.filter(
      (w) =>
        (!f.availableOnly || isAvailableFollowWork(w)) &&
        (f.genre === 'all' || followPickGenre(w) === f.genre) &&
        (f.service === 'all' || (w.available ?? []).some((a) => a.key === f.service)) &&
        (!q || norm(w.title).includes(q)),
    ),
    f.sort,
  );
}

/** ジャンルごとの件数（ジャンル以外の条件で絞った作品を数える。0件のジャンルも返す） */
export function countFollowPickGenres(works: FollowWork[], f: FollowWorkFilter): Record<FollowPickGenre | 'all', number> {
  const base = filterFollowWorks(works, { ...f, genre: 'all' });
  const counts = Object.fromEntries([...FOLLOW_PICK_GENRES, 'all'].map((g) => [g, 0])) as Record<FollowPickGenre | 'all', number>;
  for (const w of base) counts[followPickGenre(w)]++;
  counts.all = base.length;
  return counts;
}

/**
 * 配信サービスの選択肢（配信先として確認できた作品があるサービスだけ。件数はサービス以外の条件で絞った作品の数）。
 * 並びは推しサーチの対応14サービスの順 → それ以外（Prime Video の追加チャンネルなど）を表示名順
 */
export function listFollowServices(works: FollowWork[], f: FollowWorkFilter): Array<{ key: string; label: string; count: number }> {
  const base = filterFollowWorks(works, { ...f, service: 'all' });
  const map = new Map<string, { key: string; label: string; count: number }>();
  for (const w of base) {
    for (const a of w.available ?? []) {
      const e = map.get(a.key) ?? { key: a.key, label: a.provider, count: 0 };
      e.count++;
      map.set(a.key, e);
    }
  }
  const order = Object.keys(VOD_PROVIDER_DISPLAY_NAMES);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return [...map.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, 'ja'));
}
