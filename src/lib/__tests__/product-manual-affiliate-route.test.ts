import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RakutenItem } from '@/types/rakuten';

const appendProductToCategory = vi.fn();
const updateProductInCategory = vi.fn();
const getStoredProductItemById = vi.fn();
const saveVerdict = vi.fn();
const dbExecute = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/ranking', () => ({ RANKING_DATA_CACHE_TAG: 'ranking' }));
vi.mock('@/lib/judgment-store', () => ({ saveVerdict: (...a: unknown[]) => saveVerdict(...a) }));
vi.mock('@/lib/product-store', () => ({
  appendProductToCategory: (...a: unknown[]) => appendProductToCategory(...a),
  updateProductInCategory: (...a: unknown[]) => updateProductInCategory(...a),
  getStoredProductItemById: (...a: unknown[]) => getStoredProductItemById(...a),
}));
vi.mock('@/db/client', () => ({ db: { execute: (...a: unknown[]) => dbExecute(...a) } }));

import { POST, PUT } from '@/app/api/admin/product-manual/route';

const HGC = 'aaaa1111.bbbb2222.aaaa1111.cccc3333';
const page = 'https://books.rakuten.co.jp/rb/18507785/';
const aff = (p: string, hgc = HGC) => `https://hb.afl.rakuten.co.jp/hgc/${hgc}/?pc=${encodeURIComponent(p)}`;
const req = (method: string, body: unknown) =>
  new Request('http://localhost/api/admin/product-manual', { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) as never;
const savedProduct = () => appendProductToCategory.mock.calls[0][2] as RakutenItem;

beforeEach(() => {
  vi.clearAllMocks();
  appendProductToCategory.mockResolvedValue('created');
  updateProductInCategory.mockResolvedValue(true);
  dbExecute.mockResolvedValue({ rows: [] });
});

describe('POST /api/admin/product-manual（手動登録）', () => {
  const base = { personNames: ['音嶋莉沙'], title: '櫻撮 VOL.01', category: '写真集' };

  it('楽天検索から渡された正規 affiliateUrl を保存（DBを探さない）', async () => {
    const res = await POST(req('POST', { ...base, itemUrl: page, affiliateUrl: aff(page) }));
    const json = await res.json();
    expect(savedProduct().affiliateUrl).toBe(aff(page));
    expect(savedProduct().itemUrl).toBe(page); // 元の商品URLは保持
    expect(json.linkStatus).toBe('verified');
    expect(dbExecute).not.toHaveBeenCalled();
  });

  it('通常URLだけの場合、既存DBの同じ商品・同じ名前の正規URLを使う', async () => {
    dbExecute.mockResolvedValueOnce({ rows: [{ id: 'bk-18507785', title: '櫻撮　VOL．01', affiliateUrl: aff(page) }] });
    const json = await (await POST(req('POST', { ...base, itemUrl: page }))).json();
    expect(savedProduct().affiliateUrl).toBe(aff(page));
    expect(json.linkStatus).toBe('verified');
  });

  it('正規URLが見つからない通常URLは affiliateUrl を空にして要確認（通常URLを affiliateUrl に入れない）', async () => {
    const json = await (await POST(req('POST', { ...base, itemUrl: page }))).json();
    expect(savedProduct().affiliateUrl).toBe('');
    expect(savedProduct().itemUrl).toBe(page);
    expect(json).toMatchObject({ linkStatus: 'plain_needs_review', linkStatusLabel: '通常URLのため要確認' });
    expect(saveVerdict).toHaveBeenCalledWith('音嶋莉沙', expect.stringMatching(/^mn-/), 'related', 100, 'manual'); // 判定の扱いは従来どおり
  });

  it('同名でも別の商品番号のURLは使わない', async () => {
    dbExecute.mockResolvedValueOnce({ rows: [{ id: 'bk-1', title: '櫻撮 VOL.01', affiliateUrl: aff('https://books.rakuten.co.jp/rb/1/') }] });
    await POST(req('POST', { ...base, itemUrl: page }));
    expect(savedProduct().affiliateUrl).toBe('');
  });

  it('短縮URLは変換せず、DBも探さない', async () => {
    const json = await (await POST(req('POST', { ...base, itemUrl: 'https://a.r10.to/abc' }))).json();
    expect(savedProduct().affiliateUrl).toBe('');
    expect(json.linkStatus).toBe('short_needs_review');
    expect(dbExecute).not.toHaveBeenCalled();
  });

  it('DBの読み取りに失敗しても推測せず要確認として登録する', async () => {
    dbExecute.mockRejectedValueOnce(new Error('db down'));
    const json = await (await POST(req('POST', { ...base, itemUrl: page }))).json();
    expect(savedProduct().affiliateUrl).toBe('');
    expect(json.linkStatus).toBe('plain_needs_review');
  });

  it('商品URL未設定は従来どおり400', async () => {
    const res = await POST(req('POST', { ...base, itemUrl: '' }));
    expect(res.status).toBe(400);
    expect(appendProductToCategory).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/product-manual（手動商品の編集）', () => {
  const key = { personName: '音嶋莉沙', productId: 'mn-a', category: 'CD' };

  it('商品URLが変わらなければ affiliateUrl を変更しない', async () => {
    getStoredProductItemById.mockResolvedValue({ id: 'mn-a', title: 'A', itemUrl: page, affiliateUrl: aff(page) });
    await PUT(req('PUT', { ...key, title: 'A', itemUrl: page, price: 1 }));
    expect(updateProductInCategory.mock.calls[0][3]).not.toHaveProperty('affiliateUrl');
  });

  it('同じ商品を指すURLに変えても、確認済みの正規URLを通常URLで上書きしない', async () => {
    getStoredProductItemById.mockResolvedValue({ id: 'mn-a', title: 'A', itemUrl: page, affiliateUrl: aff(page) });
    await PUT(req('PUT', { ...key, itemUrl: 'http://books.rakuten.co.jp/rb/18507785' }));
    expect(updateProductInCategory.mock.calls[0][3].affiliateUrl).toBe(aff(page));
  });

  it('別の商品に変えたら決め直す（以前は itemUrl だけ変わりリンク先が古いままだった）', async () => {
    getStoredProductItemById.mockResolvedValue({ id: 'mn-a', title: 'A', itemUrl: page, affiliateUrl: aff(page) });
    const json = await (await PUT(req('PUT', { ...key, itemUrl: 'https://books.rakuten.co.jp/rb/999/' }))).json();
    expect(updateProductInCategory.mock.calls[0][3].affiliateUrl).toBe('');
    expect(json.linkStatus).toBe('plain_needs_review');
  });
});
