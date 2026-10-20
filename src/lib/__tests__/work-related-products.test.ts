import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';
import type { ProductCategory } from '@/types/person';

const mockExecute = vi.hoisted(() => vi.fn());
const mockGetAllStoredProducts = vi.hoisted(() => vi.fn());
const mockGetAllVerdicts = vi.hoisted(() => vi.fn());
vi.mock('@/db/client', () => ({ db: { execute: mockExecute } }));
vi.mock('@/lib/product-store', () => ({ getAllStoredProducts: mockGetAllStoredProducts }));
vi.mock('@/lib/judgment-store', () => ({ getAllVerdicts: mockGetAllVerdicts }));

import {
  WORK_RELATED_CATEGORIES,
  getWorkRelatedProducts,
  normalizeWorkMatchTitle,
  pickWorkRelatedCandidates,
  selectWorkRelatedFromStored,
  type WorkRelatedCandidate,
} from '@/lib/work-related-products';

type Stored = Partial<Record<ProductCategory, { products: RakutenItem[]; fetchedAt: number }>>;
const item = (id: string, title: string, extra: Partial<RakutenItem> = {}): RakutenItem =>
  ({ id, title, price: 1000, imageUrl: `https://img/${id}`, itemUrl: `https://item/${id}`, affiliateUrl: `https://aff/${id}`, ...extra }) as RakutenItem;

// DB の1回目の読み取り（判定 related の ID・商品名・位置）を、保存データと判定から作る（SQL と同じ結果）
function candidatesOf(stored: Stored, verdicts: Record<string, { verdict: string }>): WorkRelatedCandidate[] {
  const out: WorkRelatedCandidate[] = [];
  for (const [category, row] of Object.entries(stored)) {
    if (!(WORK_RELATED_CATEGORIES as readonly string[]).includes(category)) continue;
    row!.products.forEach((p, i) => {
      if (verdicts[String(p.id)]?.verdict === 'related') out.push({ category, ord: i + 1, id: String(p.id), title: p.title });
    });
  }
  return out;
}

// 簡単な乱数（再現できるように固定シード）
function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

describe('作品ページの関連商品：選び方が従来と同じ', () => {
  it('作品名の正規化（小文字化・全角スペース・空白の除去）は従来どおり', () => {
    expect(normalizeWorkMatchTitle('ＳＰＥＣ　翔 Blu-ray BOX')).toBe('ｓｐｅｃ翔blu-raybox');
    expect(normalizeWorkMatchTitle(' A\tB\nC ')).toBe('abc');
  });

  it('無作為なデータ 500通りで、新しい選び方と従来の選び方の結果（商品・順序・件数）が一致する', () => {
    const r = rng(42);
    const words = ['花束', 'みたいな', '恋', 'をした', 'SPEC', 'spec', 'ＳＰＥＣ', '翔', 'Blu-ray', 'DVD', 'ＣＤ', ' ', '　', 'BOX'];
    const cats: ProductCategory[] = ['Blu-ray・DVD', 'CD', '本・雑誌', '写真集', 'グッズ', '中古'];
    const verdictKinds = ['related', 'related', 'uncertain', 'unrelated', 'deleted'];
    for (let n = 0; n < 500; n++) {
      const stored: Stored = {};
      const verdicts: Record<string, { verdict: string }> = {};
      let id = 0;
      for (const c of cats) {
        if (r() < 0.2) continue;
        const len = Math.floor(r() * 15);
        stored[c] = { fetchedAt: 0, products: Array.from({ length: len }, () => {
          const t = Array.from({ length: 1 + Math.floor(r() * 4) }, () => words[Math.floor(r() * words.length)]).join('');
          const pid = r() < 0.1 && id > 0 ? `p${Math.floor(r() * id)}` : `p${id++}`; // 同じIDの重複も含める
          if (r() < 0.9) verdicts[pid] = { verdict: verdictKinds[Math.floor(r() * verdictKinds.length)] };
          return item(pid, t);
        }) };
      }
      const workTitle = [words[Math.floor(r() * words.length)], r() < 0.5 ? words[Math.floor(r() * words.length)] : ''].join('');
      const legacy = selectWorkRelatedFromStored(stored, verdicts as never, workTitle);
      const picked = pickWorkRelatedCandidates(candidatesOf(stored, verdicts), workTitle);
      const fromPicked = picked.map((c) => stored[c.category as ProductCategory]!.products[c.ord - 1]);
      expect(fromPicked).toEqual(legacy);
    }
  });

  it('カテゴリ順（Blu-ray・DVD → CD → 本・雑誌）→ 保存順で最大6件。写真集・グッズ・中古は対象外', () => {
    const cands: WorkRelatedCandidate[] = [
      { category: '本・雑誌', ord: 1, id: 'b1', title: '作品A 本' },
      { category: 'CD', ord: 2, id: 'c2', title: '作品A CD2' },
      { category: 'CD', ord: 1, id: 'c1', title: '作品A CD1' },
      { category: '写真集', ord: 1, id: 'x', title: '作品A 写真集' },
      { category: 'Blu-ray・DVD', ord: 3, id: 'd3', title: '作品A DVD' },
      { category: 'Blu-ray・DVD', ord: 1, id: 'd1', title: '別作品' },
      { category: 'Blu-ray・DVD', ord: 2, id: 'd2', title: null },
    ];
    expect(pickWorkRelatedCandidates(cands, '作品a').map((c) => c.id)).toEqual(['d3', 'c1', 'c2', 'b1']);
    expect(pickWorkRelatedCandidates(cands, '作品A', 2).map((c) => c.id)).toEqual(['d3', 'c1']);
  });
});

describe('getWorkRelatedProducts（DB からは必要な商品だけ読む）', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockGetAllStoredProducts.mockReset();
    mockGetAllVerdicts.mockReset();
  });

  it('1回目は ID・商品名・位置だけ、2回目は表示する商品だけを読み、全商品・全判定は読まない', async () => {
    const d = item('d1', '作品A Blu-ray', { shopName: 'shop' });
    const c = item('c1', '作品A CD');
    mockExecute
      .mockResolvedValueOnce({ rows: [
        { category: 'CD', ord: 4, id: 'c1', title: '作品A CD' },
        { category: 'Blu-ray・DVD', ord: 2, id: 'd1', title: '作品A Blu-ray' },
        { category: 'CD', ord: 1, id: 'c0', title: '別の作品' },
      ] })
      .mockResolvedValueOnce({ rows: [
        { category: 'Blu-ray・DVD', ord: 2, item: d },
        { category: 'CD', ord: 4, item: c },
      ] });
    const res = await getWorkRelatedProducts('成田凌', '作品A');
    expect(res).toEqual([d, c]); // 商品の全項目（アフィリエイトURL等）をそのまま返す
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockGetAllStoredProducts).not.toHaveBeenCalled();
    expect(mockGetAllVerdicts).not.toHaveBeenCalled();
  });

  it('該当する商品が無ければ2回目の読み取りをしない', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [{ category: 'CD', ord: 1, id: 'c0', title: '別の作品' }] });
    expect(await getWorkRelatedProducts('成田凌', '作品A')).toEqual([]);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('読み取りの間に商品が更新され位置の商品が変わったら、従来の方法で選び直す（関連商品を減らさない）', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ category: 'CD', ord: 1, id: 'c1', title: '作品A CD' }] })
      .mockResolvedValueOnce({ rows: [{ category: 'CD', ord: 1, item: item('other', '入れ替わった商品') }] });
    const c1 = item('c1', '作品A CD');
    mockGetAllStoredProducts.mockResolvedValue({ CD: { products: [item('new', '新商品'), c1], fetchedAt: 0 } });
    mockGetAllVerdicts.mockResolvedValue({ c1: { verdict: 'related' }, new: { verdict: 'related' } });
    expect(await getWorkRelatedProducts('成田凌', '作品A')).toEqual([c1]);
    expect(mockGetAllStoredProducts).toHaveBeenCalledWith('成田凌');
  });

  it('DB エラー時は従来どおり空配列（ページは表示される）', async () => {
    mockExecute.mockRejectedValueOnce(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await getWorkRelatedProducts('成田凌', '作品A')).toEqual([]);
    spy.mockRestore();
  });
});
