import { describe, expect, it } from 'vitest';
import type { FollowAvailability, FollowWork } from '../video-follow-reel';
import {
  DEFAULT_FOLLOW_WORK_FILTER,
  FOLLOW_PICK_GENRES,
  countFollowPickGenres,
  filterFollowWorks,
  followPickGenre,
  listFollowServices,
  sortFollowWorks,
  type FollowWorkFilter,
} from '../video-follow-work-filter';
import { DISPLAY_WORK_TYPE_ORDER } from '../work-display-type';

const av = (key: string, provider: string, typeLabel = '見放題', channel = false): FollowAvailability => ({ key, provider, typeLabel, channel });
const work = (id: string, over: Partial<FollowWork> = {}): FollowWork => ({
  id,
  title: `作品${id}`,
  year: 2020,
  genre: 'drama',
  genreLabel: 'ドラマ',
  roleName: null,
  persons: ['佐野勇斗'],
  streaming: [],
  available: [av('unext', 'U-NEXT')],
  ...over,
});
const WORKS: FollowWork[] = [
  work('d1', { title: 'ドラマＡ', year: 2024 }),
  work('d2', { title: 'あいドラマ', year: 2024, available: [av('hulu', 'Hulu'), av('primevideo', 'Prime Video', 'レンタル')] }),
  work('m1', { title: 'Movie One', year: 2019, genre: 'movie', genreLabel: '映画', available: [av('telasaamazonchannel', 'Prime Video内 TELASAチャンネル', '見放題', true)] }),
  work('v1', { title: 'バラエティ', year: null, genre: 'variety', genreLabel: 'バラエティ' }),
  work('i1', { title: 'アイドル番組', year: 2022, genre: 'idol_show', genreLabel: 'アイドル番組' }),
  work('l1', { title: 'ライブ', year: 2023, genre: 'live', genreLabel: 'ライブ・コンサート', available: [] }),
  work('w1', { title: 'Web番組', year: 2021, genre: 'web', genreLabel: '配信番組・Web' }),
  work('n1', { title: '配信なし', year: 2025, available: [] }),
];
const f = (patch: Partial<FollowWorkFilter> = {}) => ({ ...DEFAULT_FOLLOW_WORK_FILTER, ...patch });
const ids = (ws: FollowWork[]) => ws.map((w) => w.id);

describe('フォロー獲得リールの作品選択: 絞り込み', () => {
  it('既定は配信先が確認できる作品だけ（配信先の無い作品は出さない）', () => {
    expect(ids(filterFollowWorks(WORKS, f()))).not.toContain('n1');
    expect(ids(filterFollowWorks(WORKS, f()))).not.toContain('l1');
    expect(ids(filterFollowWorks(WORKS, f({ availableOnly: false })))).toContain('n1');
  });

  it('サイトの表示分類を一覧どおりに対応させる（配信番組・Web は独立した分類。その他へ寄せない）。全分類に対応がある', () => {
    for (const t of DISPLAY_WORK_TYPE_ORDER) expect(FOLLOW_PICK_GENRES, t).toContain(followPickGenre({ genre: t }));
    expect(followPickGenre({ genre: 'web' })).toBe('web');
    expect(followPickGenre({ genre: 'other' })).toBe('other');
    expect(followPickGenre({ genre: 'idol_show' })).toBe('music_idol');
    expect(followPickGenre({ genre: 'music' })).toBe('music_idol');
    expect(followPickGenre({ genre: 'stage' })).toBe('stage_live');
    expect(followPickGenre({ genre: 'live' })).toBe('stage_live');
    expect(ids(filterFollowWorks(WORKS, f({ genre: 'drama' })))).toEqual(['d2', 'd1']);
    expect(ids(filterFollowWorks(WORKS, f({ genre: 'web' })))).toEqual(['w1']);
    expect(ids(filterFollowWorks(WORKS, f({ genre: 'other' })))).toEqual([]);
  });

  it('ジャンルの件数は、ジャンル以外の条件で絞った作品を数える', () => {
    const c = countFollowPickGenres(WORKS, f());
    expect(c).toMatchObject({ all: 6, drama: 2, movie: 1, variety: 1, music_idol: 1, stage_live: 0, web: 1, other: 0 });
    expect(countFollowPickGenres(WORKS, f({ genre: 'movie', service: 'unext' }))).toMatchObject({ all: 4, drama: 1, movie: 0 });
  });

  it('作品名検索は部分一致（全角・半角・大文字小文字・空白の違いは同じとみなす）', () => {
    expect(ids(filterFollowWorks(WORKS, f({ query: 'ドラマ' })))).toEqual(['d2', 'd1']);
    expect(ids(filterFollowWorks(WORKS, f({ query: 'ドラマA' })))).toEqual(['d1']);
    expect(ids(filterFollowWorks(WORKS, f({ query: 'movieone' })))).toEqual(['m1']);
    expect(filterFollowWorks(WORKS, f({ query: '存在しない' }))).toEqual([]);
  });

  it('配信サービスで絞る。Prime Video 本体と追加チャンネルは別のサービス', () => {
    expect(ids(filterFollowWorks(WORKS, f({ service: 'primevideo' })))).toEqual(['d2']);
    expect(ids(filterFollowWorks(WORKS, f({ service: 'telasaamazonchannel' })))).toEqual(['m1']);
    const sv = listFollowServices(WORKS, f());
    expect(sv.map((s) => s.label)).toEqual(['Hulu', 'U-NEXT', 'Prime Video', 'Prime Video内 TELASAチャンネル']);
    expect(sv.find((s) => s.key === 'unext')!.count).toBe(4);
    // 配信先が確認できない作品しかないサービスは候補に出さない
    expect(listFollowServices([work('x', { available: [] })], f())).toEqual([]);
  });

  it('並び順: 公開年の新しい順（同じ年は作品名順・年不明は最後）／古い順／作品名順', () => {
    const all = f({ availableOnly: false });
    expect(ids(filterFollowWorks(WORKS, all))).toEqual(['n1', 'd2', 'd1', 'l1', 'i1', 'w1', 'm1', 'v1']);
    expect(ids(filterFollowWorks(WORKS, { ...all, sort: 'year_asc' }))).toEqual(['m1', 'w1', 'i1', 'l1', 'd2', 'd1', 'n1', 'v1']);
    expect(ids(sortFollowWorks(WORKS, 'title'))[0]).toBe('m1');
    // 入力の順に関係なく同じ結果
    expect(ids(sortFollowWorks([...WORKS].reverse(), 'year_desc'))).toEqual(ids(sortFollowWorks(WORKS, 'year_desc')));
  });

  it('絞り込みは作品の一覧を変えない（選択状態は別に持つため、条件を変えても選んだ作品は残る）', () => {
    const copy = JSON.stringify(WORKS);
    filterFollowWorks(WORKS, f({ genre: 'movie', query: 'x', service: 'hulu', sort: 'title' }));
    expect(JSON.stringify(WORKS)).toBe(copy);
  });
});
