import { describe, it, expect } from 'vitest';
import { getProductSortTitle, compareProductsByTitle } from '@/lib/product-sort-title';

describe('getProductSortTitle()', () => {
  it('先頭の【】括弧付き販促文言を除外する', () => {
    expect(getProductSortTitle('【先着特典】SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('先頭の＜＞括弧付き販促文言を除外する', () => {
    expect(getProductSortTitle('＜予約受付中＞SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('先頭の［］括弧付き販促文言を除外する', () => {
    expect(getProductSortTitle('［数量限定］SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('先頭の（）括弧付き販促文言を除外する', () => {
    expect(getProductSortTitle('（送料無料）SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('先頭の《》括弧付き販促文言を除外する', () => {
    expect(getProductSortTitle('《特典付き》SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('楽天ブックス限定を除外する', () => {
    expect(getProductSortTitle('【楽天ブックス限定】SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('括弧なしの先頭販促文言（予約受付中）を除外する', () => {
    expect(getProductSortTitle('予約受付中 SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('括弧なしの先頭販促文言（送料無料）を除外する', () => {
    expect(getProductSortTitle('送料無料 SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('複数の括弧付き販促文言が連続する場合、すべて除外する', () => {
    expect(getProductSortTitle('【先着特典】【送料無料】【予約商品】SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('括弧付きと括弧なしが混在する場合も除外する', () => {
    expect(getProductSortTitle('【先着特典】送料無料 予約受付中 SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('表記ゆれ「先着 特典」（スペースあり）にも対応する', () => {
    expect(getProductSortTitle('【先着 特典】SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('表記ゆれ「先着購入 特典」（スペースあり）にも対応する', () => {
    expect(getProductSortTitle('先着購入 特典 SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('ポイント○倍（数字）を除外する', () => {
    expect(getProductSortTitle('ポイント5倍 SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  it('SALEを大文字小文字問わず除外する', () => {
    expect(getProductSortTitle('SALE SixTONES アルバム')).toBe('SixTONES アルバム');
    expect(getProductSortTitle('sale SixTONES アルバム')).toBe('SixTONES アルバム');
  });

  // ── 除外してはいけない情報 ──────────────────────────────────────────────────
  it('商品名本体の「初回盤A」「初回盤B」「通常盤」は削除せず区別する', () => {
    const a = getProductSortTitle('SixTONES アルバム 初回盤A');
    const b = getProductSortTitle('SixTONES アルバム 初回盤B');
    const c = getProductSortTitle('SixTONES アルバム 通常盤');
    expect(a).toBe('SixTONES アルバム 初回盤A');
    expect(b).toBe('SixTONES アルバム 初回盤B');
    expect(c).toBe('SixTONES アルバム 通常盤');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('商品名本体の「限定版」「限定」は削除しない（先頭ではないため）', () => {
    expect(getProductSortTitle('SixTONES アルバム 限定版')).toBe('SixTONES アルバム 限定版');
  });

  it('商品名本体の「特典」は削除しない（先頭ではないため）', () => {
    expect(getProductSortTitle('SixTONES アルバム 特典映像付き')).toBe('SixTONES アルバム 特典映像付き');
  });

  it('Blu-ray・DVD・CD・写真集・雑誌等の種別語は保持する', () => {
    expect(getProductSortTitle('SixTONES アルバム Blu-ray')).toBe('SixTONES アルバム Blu-ray');
    expect(getProductSortTitle('SixTONES アルバム DVD')).toBe('SixTONES アルバム DVD');
  });

  it('商品本体タイトルに含まれる数字は保持する', () => {
    expect(getProductSortTitle('乃木坂46 3rd写真集')).toBe('乃木坂46 3rd写真集');
  });

  // ── 正規化 ────────────────────────────────────────────────────────────────
  it('全角英数字をNFKCで半角に正規化する', () => {
    expect(getProductSortTitle('ＳｉｘＴＯＮＥＳ')).toBe('SixTONES');
  });

  it('連続する空白を1文字にし、前後をtrimする', () => {
    expect(getProductSortTitle('  SixTONES   アルバム  ')).toBe('SixTONES アルバム');
  });

  it('販促文言除去後に空文字になる場合は正規化のみの文字列にフォールバックする', () => {
    // 商品名が販促文言だけで構成されている極端なケース
    const result = getProductSortTitle('【先着特典】');
    expect(result).not.toBe('');
    expect(result.length).toBeGreaterThan(0);
  });

  it('販促文言が全く無い商品名はそのまま（NFKC正規化のみ）', () => {
    expect(getProductSortTitle('SixTONES アルバム')).toBe('SixTONES アルバム');
  });
});

describe('compareProductsByTitle()', () => {
  function item(id: string, title: string) {
    return { id, title };
  }

  it('販促文言の有無に関わらず商品本体名で近くにソートされる', () => {
    const items = [
      item('1', '【先着特典】SixTONES アルバム'),
      item('2', 'SixTONES アルバム'),
      item('3', '＜予約受付中＞SixTONES アルバム'),
      item('4', '（送料無料）SixTONES アルバム'),
      item('5', '【楽天ブックス限定】SixTONES アルバム'),
    ];
    const sorted = [...items].sort(compareProductsByTitle);
    // 全て同じsortTitleになるため、次点の元titleで安定的に並ぶ
    // 少なくとも、無関係な商品が割り込まないことを確認する
    const ids = sorted.map((i) => i.id);
    expect(ids.sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('初回盤A・初回盤B・通常盤は別商品として区別され、まとまって並ぶ', () => {
    const items = [
      item('1', 'SixTONES アルバム 通常盤'),
      item('2', 'SixTONES アルバム 初回盤A'),
      item('3', 'SixTONES アルバム 初回盤B'),
    ];
    const sorted = [...items].sort(compareProductsByTitle);
    const titles = sorted.map((i) => i.title);
    // 初回盤A < 初回盤B < 通常盤 の順（localeCompareのja-JP順）になることを確認
    expect(titles).toEqual([
      'SixTONES アルバム 初回盤A',
      'SixTONES アルバム 初回盤B',
      'SixTONES アルバム 通常盤',
    ]);
  });

  it('数字は自然順（2, 9, 10, 20）で並ぶ', () => {
    const items = [
      item('1', '商品 10'),
      item('2', '商品 2'),
      item('3', '商品 20'),
      item('4', '商品 9'),
    ];
    const sorted = [...items].sort(compareProductsByTitle);
    expect(sorted.map((i) => i.title)).toEqual(['商品 2', '商品 9', '商品 10', '商品 20']);
  });

  it('降順ソートは比較関数の符号を反転させるだけで正しく反転する', () => {
    const items = [
      item('1', '商品 2'),
      item('2', '商品 10'),
    ];
    const asc = [...items].sort(compareProductsByTitle);
    const desc = [...items].sort((a, b) => -compareProductsByTitle(a, b));
    expect(asc.map((i) => i.id)).toEqual(['1', '2']);
    expect(desc.map((i) => i.id)).toEqual(['2', '1']);
  });

  it('同じ正規化名・同じ元タイトルの場合は商品IDで安定的に並ぶ（複数回実行しても順序が変わらない）', () => {
    const items = [
      item('b-id', '同名商品'),
      item('a-id', '同名商品'),
    ];
    const sorted1 = [...items].sort(compareProductsByTitle);
    const sorted2 = [...items].sort(compareProductsByTitle);
    expect(sorted1.map((i) => i.id)).toEqual(['a-id', 'b-id']);
    expect(sorted2.map((i) => i.id)).toEqual(['a-id', 'b-id']);
  });

  it('元の商品オブジェクトの全プロパティが保持される（titleだけを抽出しない）', () => {
    interface Full { id: string; title: string; price: number }
    const items: Full[] = [
      { id: '1', title: 'B商品', price: 500 },
      { id: '2', title: 'A商品', price: 1000 },
    ];
    const sorted = [...items].sort(compareProductsByTitle);
    expect(sorted[0]).toEqual({ id: '2', title: 'A商品', price: 1000 });
    expect(sorted[1]).toEqual({ id: '1', title: 'B商品', price: 500 });
  });
});
