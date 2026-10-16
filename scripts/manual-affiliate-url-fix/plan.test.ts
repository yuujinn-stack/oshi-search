import { describe, it, expect } from 'vitest';
import {
  assertOnlyAffiliateUrlChanged,
  booksProductNumber,
  buildRowUpdates,
  buildSourceIndex,
  evaluateRows,
  maskAffiliateUrl,
  pickSourceUrl,
  summarize,
  titlesMatch,
  type ProductRow,
  type SourceLink,
} from './plan';

const HGC = 'aaaa1111.bbbb2222.aaaa1111.cccc3333';
const aff = (rb: string, scheme = 'https', hgc = HGC) =>
  `${scheme}://hb.afl.rakuten.co.jp/hgc/${hgc}/?pc=${encodeURIComponent(`${scheme}://books.rakuten.co.jp/rb/${rb}/`)}`;
const plain = (rb: string) => `http://books.rakuten.co.jp/rb/${rb}/`;
const manual = (id: string, rb: string, title: string, o: Record<string, unknown> = {}) => ({
  id, title, price: 1980, itemUrl: plain(rb), affiliateUrl: plain(rb), imageUrl: 'x.jpg', category: '写真集', ...o,
});
const src = (rb: string, title: string, o: Partial<SourceLink> = {}): SourceLink => ({ id: `bk-${rb}`, title, url: aff(rb), ...o });

describe('URL判定', () => {
  it('通常の楽天ブックスURLから商品番号を取り出す', () => {
    expect(booksProductNumber('http://books.rakuten.co.jp/rb/18507785/')).toBe('18507785');
    expect(booksProductNumber('https://books.rakuten.co.jp/rb/18507785')).toBe('18507785');
    expect(booksProductNumber('https://a.r10.to/hkQkHO')).toBeNull();
    expect(booksProductNumber('https://item.rakuten.co.jp/book/18507785/')).toBeNull();
  });

  it('http/https の違いだけなら既存の https を使い、別URLが混ざれば決めない', () => {
    expect(pickSourceUrl(new Set([aff('1', 'http'), aff('1', 'https')]))).toBe(aff('1', 'https'));
    expect(pickSourceUrl(new Set([aff('1'), aff('1', 'https', 'zzzz9999.yyyy8888.zzzz9999.xxxx7777')]))).toBeNull();
  });

  it('商品名は全半角・空白・【】付記の違いだけ吸収する', () => {
    expect(titlesMatch('【楽天ブックス限定特典】乃木坂46 梅澤美波2nd写真集　透明な覚悟', '乃木坂46　梅澤美波2nd写真集 透明な覚悟')).toBe(true);
    expect(titlesMatch('是非に及ばず (Type-A)', '別の商品')).toBe(false);
  });

  it('表示用にアフィリエイトの識別部分を伏せる', () => {
    expect(maskAffiliateUrl(aff('1'))).not.toContain(HGC);
  });
});

describe('evaluateRows', () => {
  const rows: ProductRow[] = [
    {
      personName: '梅澤美波',
      category: '写真集',
      items: [
        { id: 'bk-1', title: 'API商品', itemUrl: 'https://books.rakuten.co.jp/rb/1/', affiliateUrl: aff('1') },
        manual('mn-a', '100', '写真集A'),
        manual('mn-b', '200', '写真集B'),
        manual('mn-c', '300', '写真集C', { affiliateUrl: 'https://a.r10.to/xyz', itemUrl: 'https://a.r10.to/xyz' }),
        manual('mn-d', '400', '写真集D'),
        manual('mn-e', '500', '写真集E'),
      ],
    },
  ];
  const index = buildSourceIndex([
    src('100', '写真集A'),
    src('200', 'まったく別の本'),
    src('500', '写真集E'),
    src('500', '写真集E', { url: aff('500', 'https', 'zzzz9999.yyyy8888.zzzz9999.xxxx7777') }),
  ]);
  const results = evaluateRows(rows, index, HGC);
  const st = (id: string) => results.find((r) => r.id === id)?.status;

  it('同じ商品番号・同じ商品名の既存アフィリエイトURLがある商品だけ pending', () => {
    expect(st('mn-a')).toBe('pending');
    expect(results.find((r) => r.id === 'mn-a')?.after).toBe(aff('100'));
  });
  it('商品名が違えば変更しない（誤リンク防止）', () => expect(st('mn-b')).toBe('title_mismatch'));
  it('短縮URLは変更しない', () => expect(st('mn-c')).toBe('skip_unverified'));
  it('流用元が無ければ変更しない（URLを組み立てない）', () => expect(st('mn-d')).toBe('no_source'));
  it('流用元が複数で決められなければ変更しない', () => expect(st('mn-e')).toBe('ambiguous_source'));
  it('手動登録以外（API商品）は対象外', () => expect(st('bk-1')).toBeUndefined());

  it('流用元の識別部分が楽天ブックス共通の値と違えば変更しない', () => {
    const r = evaluateRows(rows, index, 'other.hgc.value.x');
    expect(r.find((x) => x.id === 'mn-a')?.status).toBe('invalid_source');
  });

  it('同じ行に同じ商品IDが複数あれば変更しない（商品ID重複による誤更新防止）', () => {
    const dupRows: ProductRow[] = [{ personName: 'p', category: 'CD', items: [manual('mn-x', '100', '写真集A'), manual('mn-x', '100', '写真集A')] }];
    const r = evaluateRows(dupRows, index, HGC);
    expect(r.every((x) => x.status === 'duplicate_id_in_row')).toBe(true);
  });

  it('affiliateUrl だけを差し替え、商品ID・itemUrl・商品名・価格・他の要素は変えない', () => {
    const updates = buildRowUpdates(rows, results);
    expect(updates).toHaveLength(1);
    const [u] = updates;
    expect(u.changes.map((c) => c.id)).toEqual(['mn-a']);
    const before = rows[0].items[1];
    const after = u.afterItems[1];
    expect(after.affiliateUrl).toBe(aff('100'));
    expect({ ...after, affiliateUrl: undefined }).toEqual({ ...before, affiliateUrl: undefined });
    expect(u.afterItems.filter((_, i) => i !== 1)).toEqual(rows[0].items.filter((_, i) => i !== 1));
    expect(rows[0].items[1].affiliateUrl).toBe(plain('100')); // 入力は変更しない
  });

  it('判定後に DB の状態が変わっていたら例外（部分反映しない）', () => {
    const changed: ProductRow[] = [{ ...rows[0], items: rows[0].items.map((it, i) => (i === 1 ? { ...it, affiliateUrl: 'https://example.com' } : it)) }];
    expect(() => buildRowUpdates(changed, results)).toThrow();
  });

  it('affiliateUrl 以外の変更を検出する', () => {
    expect(() => assertOnlyAffiliateUrlChanged([manual('mn-a', '1', 't')], [{ ...manual('mn-a', '1', 't'), price: 1 }])).toThrow();
  });

  it('適用後に再実行すると already_applied（冪等）', () => {
    const applied: ProductRow[] = [{ ...rows[0], items: buildRowUpdates(rows, results)[0].afterItems }];
    const r = evaluateRows(applied, index, HGC);
    expect(r.find((x) => x.id === 'mn-a')?.status).toBe('already_applied');
    expect(summarize(r).byStatus.pending).toBe(0);
  });
});
