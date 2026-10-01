import { describe, it, expect } from 'vitest';
import {
  buildTemplateHistory, templatePostedAt, findPostedCombos, personTemplateChips, shortTemplateLabel, formatPostedDate, unknownTemplatePostedAt,
  type PublishedScheduleRow, type InstagramPostRow,
} from '@/lib/instagram-template-history';
import { SCHEDULABLE_TEMPLATES } from '@/lib/instagram-templates';

const H = 'watch-and-buy';
const G = 'search-too-much';
const J = 'real-screen';
const HGJ = [H, G, J];
const ORDER = SCHEDULABLE_TEMPLATES.map((t) => t.id);
const row = (personName: string, templateId: string, status: string, publishedAt: string | null, mediaId: string | null = publishedAt ? `m-${personName}-${templateId}-${publishedAt}` : null): PublishedScheduleRow =>
  ({ personName, templateId, status, mediaId, publishedAt });

describe('投稿済みの判定（Instagramへの投稿成功だけ）', () => {
  it('A：投稿履歴のない人物 × H/G/J → すべて未投稿', () => {
    const h = buildTemplateHistory([], []);
    expect(HGJ.map((t) => templatePostedAt(h, '松村北斗', t))).toEqual([null, null, null]);
    expect(personTemplateChips(h, '松村北斗', ORDER, HGJ)).toEqual(HGJ.map((t) => ({ templateId: t, postedAt: null, selected: true })));
  });
  it('B：Hのみ投稿済み → Hだけ投稿済み', () => {
    const h = buildTemplateHistory([row('目黒蓮', H, 'published', '2026-09-30T11:24:58.961Z')], []);
    expect(HGJ.map((t) => templatePostedAt(h, '目黒蓮', t))).toEqual(['2026-09-30T11:24:58.961Z', null, null]);
  });
  it('C：Hを2回投稿 → 最新の投稿日時', () => {
    const h = buildTemplateHistory([
      row('目黒蓮', H, 'published', '2026-09-30T11:24:58.961Z'),
      row('目黒蓮', H, 'published', '2026-09-10T03:00:00.000Z'),
    ], []);
    expect(templatePostedAt(h, '目黒蓮', H)).toBe('2026-09-30T11:24:58.961Z');
    expect(formatPostedDate(templatePostedAt(h, '目黒蓮', H)!)).toBe('2026/09/30');
  });
  it('D：予約済み（scheduled・processing）だけ → 投稿済みにしない', () => {
    const h = buildTemplateHistory([row('A', H, 'scheduled', null), row('A', G, 'processing', null)], []);
    expect(templatePostedAt(h, 'A', H)).toBeNull();
    expect(templatePostedAt(h, 'A', G)).toBeNull();
  });
  it('E：failed（needs_review も）→ 投稿済みにしない', () => {
    const h = buildTemplateHistory([row('A', H, 'failed', null), row('A', G, 'needs_review', null)], []);
    expect(h.byPerson).toEqual({});
  });
  it('F：cancelled・draft → 投稿済みにしない', () => {
    const h = buildTemplateHistory([row('A', H, 'cancelled', null), row('A', G, 'draft', null)], []);
    expect(h.byPerson).toEqual({});
  });
  it('G：published → 投稿済み。ただし media_id や公開日時が無い published は数えない', () => {
    const h = buildTemplateHistory([
      row('A', H, 'published', '2026-09-22T00:47:24.137Z'),
      row('A', G, 'published', null, null),
      row('A', J, 'published', '2026-09-22T00:47:24.137Z', null),
    ], []);
    expect(templatePostedAt(h, 'A', H)).toBe('2026-09-22T00:47:24.137Z');
    expect(templatePostedAt(h, 'A', G)).toBeNull();
    expect(templatePostedAt(h, 'A', J)).toBeNull();
  });
  it('H：人物A・人物Bそれぞれの状態を正しく持つ', () => {
    const h = buildTemplateHistory([row('A', H, 'published', '2026-09-30T00:00:00.000Z'), row('B', G, 'published', '2026-09-29T00:00:00.000Z')], []);
    expect(HGJ.map((t) => !!templatePostedAt(h, 'A', t))).toEqual([true, false, false]);
    expect(HGJ.map((t) => !!templatePostedAt(h, 'B', t))).toEqual([false, true, false]);
  });
  it('テンプレートの分からない投稿（予約と media_id で結び付かない instagram_posts）はどのテンプレートにも数えない', () => {
    const posts: InstagramPostRow[] = [
      { personName: '森本慎太郎', mediaId: 'manual-1', publishedAt: '2026-09-21T12:08:55.642Z' },
      { personName: '松村北斗', mediaId: 'm-sched', publishedAt: '2026-09-22T00:47:24.705Z' },
    ];
    const h = buildTemplateHistory([row('松村北斗', 'default-person', 'published', '2026-09-22T00:47:24.137Z', 'm-sched'), row('森本慎太郎', 'default-person', 'cancelled', null)], posts);
    expect(h.unknownTemplate).toEqual({ 森本慎太郎: '2026-09-21T12:08:55.642Z' });
    expect(h.byPerson['森本慎太郎']).toBeUndefined();
    expect(templatePostedAt(h, '松村北斗', 'default-person')).toBe('2026-09-22T00:47:24.137Z');
  });
});

describe('人物一覧のテンプレート表示（既存テンプレート定義の順。H/G/J決め打ちにしない）', () => {
  const h = buildTemplateHistory([row('松村北斗', 'default-person', 'published', '2026-09-22T00:47:24.137Z')], []);
  it('選んだテンプレート（H/G/J）＋投稿済み（標準）を定義順に', () => {
    expect(personTemplateChips(h, '松村北斗', ORDER, HGJ).map((c) => `${c.templateId}:${c.postedAt ? '済' : '未'}:${c.selected ? '選' : '-'}`)).toEqual([
      'default-person:済:-', `${H}:未:選`, `${G}:未:選`, `${J}:未:選`,
    ]);
  });
  it('テンプレート未選択なら投稿済みのものだけ。履歴も選択もなければ空', () => {
    expect(personTemplateChips(h, '松村北斗', ORDER, []).map((c) => c.templateId)).toEqual(['default-person']);
    expect(personTemplateChips(h, '京本大我', ORDER, [])).toEqual([]);
  });
  it('将来追加されたテンプレート（定義の外）の投稿も末尾に出す', () => {
    const h2 = buildTemplateHistory([row('A', 'new-template-k', 'published', '2026-10-01T00:00:00.000Z')], []);
    expect(personTemplateChips(h2, 'A', ORDER, [H]).map((c) => c.templateId)).toEqual([H, 'new-template-k']);
  });
  it('短縮名：既存テンプレートの定義から作る', () => {
    expect(SCHEDULABLE_TEMPLATES.map((t) => shortTemplateLabel(t.label))).toEqual(['標準', '作品・配信情報', '出演作3選', 'サブスク比較', 'H', 'G', 'J']);
  });
});

describe('予定に含まれる投稿済みの組み合わせ（警告用。除外はしない）', () => {
  const h = buildTemplateHistory([
    row('松村北斗', H, 'published', '2026-09-30T00:00:00.000Z'),
    row('京本大我', G, 'published', '2026-09-28T00:00:00.000Z'),
  ], []);
  it('I・J：投稿済みが複数含まれる → 件数と組み合わせ。予定そのものは変えない', () => {
    const items = [
      { personName: '松村北斗', templateId: H }, { personName: '松村北斗', templateId: G }, { personName: '松村北斗', templateId: J },
      { personName: '京本大我', templateId: H }, { personName: '京本大我', templateId: G }, { personName: '京本大我', templateId: J },
    ];
    const combos = findPostedCombos(items, h);
    expect(combos).toEqual([
      { personName: '松村北斗', templateId: H, postedAt: '2026-09-30T00:00:00.000Z' },
      { personName: '京本大我', templateId: G, postedAt: '2026-09-28T00:00:00.000Z' },
    ]);
    expect(items).toHaveLength(6);
  });
  it('テンプレート未定（自動・null）や履歴なしでは警告しない', () => {
    expect(findPostedCombos([{ personName: '松村北斗', templateId: null }], h)).toEqual([]);
    expect(findPostedCombos([{ personName: '松村北斗', templateId: H }], null)).toEqual([]);
  });
});

describe('3状態の表示（✓ 投稿済みと確認できる／○ 未投稿と確認できる／？ テンプレ不明）', () => {
  const chipsOf = (h: ReturnType<typeof buildTemplateHistory>, person: string) =>
    personTemplateChips(h, person, ORDER, HGJ).map((c) => `${c.postedAt ? '✓' : '○'}${c.templateId}`);
  const manual = (personName: string, at: string): InstagramPostRow => ({ personName, mediaId: `manual-${personName}-${at}`, publishedAt: at });
  it('A：H投稿済み → ✓H（最新投稿日）、G/J は ○', () => {
    const h = buildTemplateHistory([row('目黒蓮', H, 'published', '2026-09-10T00:00:00.000Z'), row('目黒蓮', H, 'published', '2026-09-30T11:24:58.961Z')], []);
    expect(chipsOf(h, '目黒蓮')).toEqual([`✓${H}`, `○${G}`, `○${J}`]);
    expect(personTemplateChips(h, '目黒蓮', ORDER, HGJ)[0].postedAt).toBe('2026-09-30T11:24:58.961Z');
  });
  it('B：H/G/J すべて履歴なし → ○H ○G ○J（テンプレ不明の投稿もなし）', () => {
    const h = buildTemplateHistory([], []);
    expect(chipsOf(h, '京本大我')).toEqual([`○${H}`, `○${G}`, `○${J}`]);
    expect(unknownTemplatePostedAt(h, '京本大我')).toBeNull();
  });
  it('C：テンプレ不明の投稿だけ → ○ を出さない（未投稿と断定しない）。日時は「？ テンプレ不明」用に返す', () => {
    const h = buildTemplateHistory([], [manual('森本慎太郎', '2026-09-21T12:08:55.642Z')]);
    expect(chipsOf(h, '森本慎太郎')).toEqual([]);
    expect(unknownTemplatePostedAt(h, '森本慎太郎')).toBe('2026-09-21T12:08:55.642Z');
  });
  it('D：テンプレ不明の投稿＋H投稿済み → ✓H だけ（G/J は断定しない）＋テンプレ不明の日時', () => {
    const h = buildTemplateHistory([row('A', H, 'published', '2026-09-30T00:00:00.000Z', 'm-sched-a')], [
      { personName: 'A', mediaId: 'm-sched-a', publishedAt: '2026-09-30T00:00:01.000Z' },
      manual('A', '2026-09-21T00:00:00.000Z'),
    ]);
    expect(chipsOf(h, 'A')).toEqual([`✓${H}`]);
    expect(unknownTemplatePostedAt(h, 'A')).toBe('2026-09-21T00:00:00.000Z');
  });
  it('テンプレ不明の投稿だけでは「投稿済み」警告を出さない（テンプレートIDが一致した場合だけ）', () => {
    const h = buildTemplateHistory([], [manual('森本慎太郎', '2026-09-21T12:08:55.642Z')]);
    expect(HGJ.map((t) => templatePostedAt(h, '森本慎太郎', t))).toEqual([null, null, null]);
    expect(findPostedCombos(HGJ.map((t) => ({ personName: '森本慎太郎', templateId: t })), h)).toEqual([]);
  });
  it('E：failed / cancelled / 予約済み（scheduled）は ✓ にしない（○のまま）', () => {
    const h = buildTemplateHistory([row('B', H, 'failed', null), row('B', G, 'cancelled', null), row('B', J, 'scheduled', null)], []);
    expect(chipsOf(h, 'B')).toEqual([`○${H}`, `○${G}`, `○${J}`]);
  });
});
