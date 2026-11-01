import { describe, expect, it } from 'vitest';
import {
  FOLLOW_MAX_SECONDS,
  FOLLOW_TEMPLATE_IDS,
  FOLLOW_TEMPLATE_SPECS,
  allocateFollowSlots,
  buildFollowPlan,
  countFollowGenres,
  isActingRoleName,
  isEligibleFollowWork,
  nextMondayJst,
  parseFollowScriptReport,
  validateFollowFacts,
  type FollowFact,
  type FollowSelection,
  type FollowWork,
} from '../video-follow-reel';
import { parseOshiFollowInput, TemplateInputError } from '../video-template-input';

// 2026-11-01 12:00 JST（日曜日）
const NOW = Date.UTC(2026, 10, 1, 3, 0, 0);
const work = (id: string, over: Partial<FollowWork> = {}): FollowWork => ({
  id,
  title: `作品${id}`,
  year: 2020,
  genre: 'drama',
  genreLabel: 'ドラマ',
  roleName: null,
  persons: ['佐野勇斗'],
  streaming: [],
  // 確認済みの配信先（作品選択欄用。見放題でなくてもよい）
  available: [{ key: 'amazonvideo', provider: 'Prime Video', typeLabel: 'レンタル', channel: false }],
  ...over,
});
const WORKS: FollowWork[] = [
  work('a', { title: 'あいうえお', year: 2015, roleName: 'たろう', streaming: [{ provider: 'U-NEXT', typeLabel: '見放題', checkedDate: '2026-10-20' }] }),
  work('b', { title: 'かきくけこ', year: 2020, roleName: 'じろう', genre: 'movie', genreLabel: '映画', streaming: [{ provider: 'Hulu', typeLabel: '見放題', checkedDate: '2026-10-21' }] }),
  work('c', { title: 'さしすせそ', year: 2025, streaming: [{ provider: 'TVer', typeLabel: '無料', checkedDate: null }] }),
  work('d', { title: 'たちつてと', year: null, genre: 'variety', genreLabel: 'バラエティ' }),
];
const READINGS = { fixed: { 'U-NEXT': 'ユーネクスト', Hulu: 'フールー', TVer: 'ティーバー' }, registered: { 佐野勇斗: 'さのはやと', 'M!LK': 'みるく' } };
const empty: FollowSelection = { selectedWorkIds: [], facts: [], periodStart: null, pickWorkId: null };
const fact = (over: Partial<FollowFact>): FollowFact => ({ kind: 'schedule', date: '2026-11-03', sourceUrl: 'https://example.jp/news', checkedAt: '2026-11-01T10:00', ...over });
const plan = (templateId: (typeof FOLLOW_TEMPLATE_IDS)[number], selection: Partial<FollowSelection>, targetType: 'person' | 'group' = 'person') =>
  buildFollowPlan({ templateId, targetType, name: '佐野勇斗', works: WORKS, selection: { ...empty, ...selection }, readings: READINGS, nowMs: NOW });

describe('フォロー獲得リール: 必要な情報が足りないときは台本を作らない', () => {
  it('3作品・意外な出演作は、配信先が確認できない作品を選べない（候補にも出さない）。年表は選べる', () => {
    const none = work('z', { available: [] });
    const works = [...WORKS, none];
    for (const id of ['follow_three_works', 'follow_hidden_works'] as const) {
      expect(isEligibleFollowWork(id, none), id).toBe(false);
      const r = buildFollowPlan({ templateId: id, targetType: 'person', name: '佐野勇斗', works, selection: { ...empty, selectedWorkIds: ['a', 'b', 'z'] }, readings: READINGS, nowMs: NOW });
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.missing.join(' ')).toMatch(/『作品z』は配信先が確認されていません/);
    }
    expect(isEligibleFollowWork('follow_career_timeline', none)).toBe(true);
  });
  it('作品の選択が必要なテンプレートは、未選択なら不足を返す', () => {
    for (const id of FOLLOW_TEMPLATE_IDS.filter((t) => FOLLOW_TEMPLATE_SPECS[t].works.min > 0)) {
      const r = plan(id, {});
      expect(r.ok, id).toBe(false);
    }
  });
  it('事実の入力が必要なテンプレートは、確認済みの情報が無ければ不足を返す', () => {
    for (const id of ['follow_weekly_schedule', 'follow_new_streaming', 'follow_streaming_ending', 'follow_new_release_backcatalog'] as const) {
      const r = plan(id, { selectedWorkIds: id === 'follow_new_release_backcatalog' ? ['a', 'b'] : [], periodStart: '2026-11-02' });
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.missing.join(' ')).toMatch(/確認済み情報を1件以上/);
    }
  });
  it('配信終了予定日が過ぎている・出典URLが無い・確認日時が古い／未来なら生成できない', () => {
    const base = { kind: 'streamEnd' as const, workId: 'a', provider: 'U-NEXT' };
    const errs = (f: Partial<FollowFact>) => validateFollowFacts('follow_streaming_ending', { ...empty, facts: [fact({ ...base, ...f })] }, WORKS, NOW);
    expect(errs({ date: '2026-10-31' }).join()).toMatch(/過ぎています/);
    expect(errs({ date: '2026-11-10', sourceUrl: '' }).join()).toMatch(/公式情報のURL/);
    expect(errs({ date: '2026-11-10', checkedAt: '2026-10-01T10:00' }).join()).toMatch(/14日以上前/);
    expect(errs({ date: '2026-11-10', checkedAt: '2026-11-05T10:00' }).join()).toMatch(/未来/);
    expect(errs({ date: '2026-11-10' })).toEqual([]);
    expect(errs({ date: '2026-11-10', workId: 'zzz' }).join()).toMatch(/登録された出演作品/);
  });
  it('配信開始: 30日より前・未来の開始日は「新しく配信開始」に使えない', () => {
    const errs = (date: string) => validateFollowFacts('follow_new_streaming', { ...empty, facts: [fact({ kind: 'streamStart', workId: 'a', provider: 'U-NEXT', date })] }, WORKS, NOW);
    expect(errs('2026-09-15').join()).toMatch(/30日以上前/);
    expect(errs('2026-11-05').join()).toMatch(/未来/);
    expect(errs('2026-10-25')).toEqual([]);
  });
  it('出演予定: 対象期間の外・過去の日付は不可', () => {
    const errs = (date: string) => validateFollowFacts('follow_weekly_schedule', { ...empty, periodStart: '2026-11-02', facts: [fact({ title: '番組', date })] }, WORKS, NOW);
    expect(errs('2026-11-10').join()).toMatch(/対象期間/);
    expect(errs('2026-10-30').join()).toMatch(/過去/);
    expect(errs('2026-11-04')).toEqual([]);
  });
  it('役柄ギャップはグループを選べず、役名の無い作品は選べない', () => {
    const g = plan('follow_role_gap', { selectedWorkIds: ['a', 'b'] }, 'group');
    expect(g.ok).toBe(false);
    const noRole = plan('follow_role_gap', { selectedWorkIds: ['a', 'c'] });
    expect(!noRole.ok && noRole.missing.join()).toMatch(/役名が登録されていません/);
    expect(isEligibleFollowWork('follow_role_gap', WORKS[2])).toBe(false);
  });
  it('年表は出演年の無い作品を選べない・週末プランは配信が確認された作品だけ', () => {
    expect(plan('follow_career_timeline', { selectedWorkIds: ['a', 'b', 'd'] }).ok).toBe(false);
    expect(plan('follow_weekend_watch', { selectedWorkIds: ['a', 'b', 'd'], pickWorkId: 'a' }).ok).toBe(false);
  });
});

describe('フォロー獲得リール: 台本とシーン', () => {
  it('3作品: 冒頭→3作品→締めの5シーン・読み未登録なし・目安17秒', () => {
    const r = plan('follow_three_works', { selectedWorkIds: ['a', 'b', 'c'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenes.map((s) => s.id)).toEqual(['01-hook', '02-item', '03-item', '04-item', '05-outro']);
    expect(r.unresolved).toEqual([]);
    expect(r.lines[0].kana).toBe('さのはやとをもっとしりたいひとへ。みてほしいさんさく');
    expect(r.lines[1].text).toBe('まずは『あいうえお』、たろう役');
    expect(r.scenes.reduce((a, s) => a + s.slotSeconds, 0)).toBeCloseTo(17, 1);
    // 画面のカードは登録情報だけ（出演年・種類・役名・配信）
    expect(r.scenes[1].lines).toEqual(['2015年・ドラマ', 'たろう役', 'U-NEXTで見放題']);
  });
  it('読みが見つからない語は未登録として返し、読みに表記のまま残す（推測しない）', () => {
    const r = buildFollowPlan({ templateId: 'follow_hidden_works', targetType: 'person', name: '佐野勇斗', works: [work('x', { title: '漢字の作品' })], selection: { ...empty, selectedWorkIds: ['x'] }, readings: READINGS, nowMs: NOW });
    expect(r.ok && r.unresolved).toEqual(['漢字の作品']);
    expect(r.ok && r.lines[1].kana).toContain('「漢字の作品」');
  });
  it('出演予定: 日付・時刻の読み（日付の読み方）と出典の注記', () => {
    const r = plan('follow_weekly_schedule', { periodStart: '2026-11-02', facts: [fact({ title: 'ばんぐみ', date: '2026-11-03', time: '19:30' })] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines[1].kana).toBe('こんかいのきかんはこちら');
    expect(r.scenes[1].title).toBe('11/2(月)〜11/8(日)');
    expect(r.lines[2].kana).toBe('じゅういちがつみっかじゅうくじさんじゅっぷん、「ばんぐみ」');
    expect(r.scenes[2].note).toBe('確認日 2026/11/01・出典 example.jp');
    expect(r.sourceUrls).toEqual(['https://example.jp/news']);
  });
  it('ジャンル集計は同じ作品を1件として数え、全出演作品ではない旨を注記する', () => {
    expect(countFollowGenres(WORKS).map((g) => [g.label, g.count])).toEqual([['ドラマ', 2], ['バラエティ', 1], ['映画', 1]]);
    const r = plan('follow_genre_breakdown', {});
    expect(r.ok && r.scenes[1].note).toMatch(/全出演作品ではありません/);
    expect(plan('follow_genre_breakdown', {}).ok).toBe(true);
    expect(buildFollowPlan({ templateId: 'follow_genre_breakdown', targetType: 'person', name: '佐野勇斗', works: WORKS.slice(0, 2), selection: empty, readings: READINGS, nowMs: NOW }).ok).toBe(false);
  });
  it('配信終了: 残り日数は出さず、確認済みの終了予定日だけを読む', () => {
    const r = plan('follow_streaming_ending', { facts: [fact({ kind: 'streamEnd', workId: 'a', provider: 'U-NEXT', date: '2026-11-20' })] });
    expect(r.ok && r.lines[1].kana).toBe('「あいうえお」、ユーネクストでのはいしんはじゅういちがつはつかまで');
  });
  it('シーンの長さは1シーン12秒・合計は上限21秒の範囲（目安17秒まで伸ばす）', () => {
    const slots = allocateFollowSlots([{ kana: 'あ' }, { kana: 'い' }, { kana: 'う' }], ['hook', 'item', 'outro']);
    expect(slots.reduce((a, b) => a + b, 0)).toBeCloseTo(17, 1);
    expect(Math.max(...allocateFollowSlots([{ kana: 'あ'.repeat(200) }], ['item']))).toBe(12);
    expect(FOLLOW_MAX_SECONDS).toBe(21);
  });
});

describe('フォロー獲得リール: 補助', () => {
  it('役名として扱わない登録値', () => {
    for (const r of ['出演', 'M!LKメンバー', 'ゴチ27レギュラー', '佐野勇斗', '', null]) expect(isActingRoleName(r, '佐野勇斗')).toBe(false);
    for (const r of ['アラジン', 'スマーティー・パンツ（日本版声優）', '瀬尾瑞樹']) expect(isActingRoleName(r, '佐野勇斗')).toBe(true);
    // 日本語の表記が無い役名（TMDb のローマ字表記）は使わない
    expect(isActingRoleName('Mizuki Seo', '佐野勇斗')).toBe(false);
  });
  it('来週の月曜日', () => {
    expect(nextMondayJst(NOW)).toBe('2026-11-02');
    expect(nextMondayJst(Date.UTC(2026, 10, 2, 3))).toBe('2026-11-09');
  });
  it('Worker の報告（固定辞書）', () => {
    expect(parseFollowScriptReport({ version: 1, fixedReadings: { Hulu: 'フールー', bad: 1 } })).toEqual({ version: 1, fixedReadings: { Hulu: 'フールー' } });
    expect(parseFollowScriptReport({ version: 2 })).toBeNull();
  });
});

describe('フォロー獲得リール: template_input の検証', () => {
  const lines = [
    { id: '01-hook', text: 'a', kana: 'あ' },
    { id: '02-outro', text: 'b', kana: 'い' },
  ];
  it('画面から送るのは選択・事実・台本だけ（サーバーが付ける項目は受け取らない）', () => {
    const p = parseOshiFollowInput({ version: 1, targetType: 'group', selectedWorkIds: ['a'], facts: [], lines, scenes: [{ id: 'x' }], personNames: ['x'] });
    expect(p.targetType).toBe('group');
    expect(p.templateCategory).toBe('follow_growth');
    expect('scenes' in p).toBe(false);
    expect('personNames' in p).toBe(false);
  });
  it('台本が無い・形が違う入力は受け付けない（CapCut 音声付きは台本を元のジョブから付け直すので省略可）', () => {
    expect(() => parseOshiFollowInput({ targetType: 'person', lines: [] })).toThrow(TemplateInputError);
    expect(() => parseOshiFollowInput({ targetType: 'person', lines: [{ id: 'hook', text: 'a', kana: 'a' }, ...lines] })).toThrow(TemplateInputError);
    const audio = { sourceJobId: '12345678-1234-1234-1234-123456789abc', wavUrl: 'https://x.public.blob.vercel-storage.com/video-jobs/12345678-1234-1234-1234-123456789abc/capcut-a.wav', srtUrl: 'https://x.public.blob.vercel-storage.com/video-jobs/12345678-1234-1234-1234-123456789abc/capcut-a.srt' };
    expect(parseOshiFollowInput({ targetType: 'person', lines: null, audio }).lines).toEqual([]);
    expect(() => parseOshiFollowInput({ targetType: 'person', lines: null, audio: { ...audio, wavUrl: 'https://evil.example/a.wav' } })).toThrow(TemplateInputError);
  });
});
