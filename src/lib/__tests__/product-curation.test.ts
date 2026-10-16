import { describe, test, expect } from 'vitest';
import {
  classifyProductForDisplay,
  dedupeProducts,
  demoteBulkResaleSets,
  isBulkResaleSet,
  isUsedListing,
  stripPromoTags,
} from '../product-curation';
import type { RakutenItem } from '@/types/rakuten';

function affUrl(pc: string): string {
  return `https://hb.afl.rakuten.co.jp/hgc/g00q072e.ely9r2fc.g00q072e.ely9s4f4/?pc=${encodeURIComponent(pc)}&m=x`;
}

function makeProduct(overrides: Partial<RakutenItem> = {}): RakutenItem {
  return {
    id: 'p1',
    title: 'テスト商品',
    price: 1000,
    itemUrl: '',
    affiliateUrl: '',
    imageUrl: '',
    reviewCount: 0,
    reviewAverage: 0,
    relevanceScore: 0,
    category: 'グッズ',
    ...overrides,
  };
}

// ─── classifyProductForDisplay ────────────────────────────────────────────
describe('classifyProductForDisplay', () => {
  test('楽天ブックスCD・DVD検索の商品は管理カテゴリをそのまま使う', () => {
    expect(classifyProductForDisplay('是非に及ばず (初回仕様限定盤 CD＋Blu-ray Type-A)', 'CD').section).toBe('CD');
    expect(classifyProductForDisplay('映画 九龍ジェネリックロマンス(特装限定版)【Blu-ray】', 'Blu-ray・DVD').section).toBe('Blu-ray・DVD');
  });

  test('CD・Blu-ray・DVDカテゴリでも、楽天市場の一般ショップ出品は商品名の形式表記に従う', () => {
    const shop = affUrl('https://item.rakuten.co.jp/someshop/abc/');
    const books = affUrl('https://item.rakuten.co.jp/book/123/');
    expect(classifyProductForDisplay('特典ポスター[希望者]★完全生産限定盤★Blu-ray+豪華フォトブックレット', 'CD', shop).section).toBe('Blu-ray・DVD');
    expect(classifyProductForDisplay('Type-C■乃木坂46 CD+DVD【インフルエンサー】', 'CD', shop).section).toBe('CD');
    expect(classifyProductForDisplay('タイトルのみ', 'CD', shop).section).toBe('CD');
    // 楽天ブックスの商品は従来どおり管理カテゴリ
    expect(classifyProductForDisplay('ライブ Blu-ray', 'CD', books).section).toBe('CD');
  });

  test('書籍検索の商品は書籍キーワードがなくても写真集・書籍（従来はグッズに入っていた）', () => {
    expect(classifyProductForDisplay('【楽天ブックス限定特典】美しくありたい(限定絵柄ポストカード1枚)', '写真集').section).toBe('写真集・書籍');
    expect(classifyProductForDisplay('Drama Now! Vol.02【キスマイ舞祭組＆佐藤勝利ピンナップ付き】', '本・雑誌').section).toBe('写真集・書籍');
  });

  test('書籍検索でもカレンダー・トレカ等はグッズ', () => {
    expect(classifyProductForDisplay('乃木坂46：WEEKLY　CALENDAR（2013）', '写真集').section).toBe('グッズ');
    expect(classifyProductForDisplay('乃木坂46 トレーディングコレクションpart.2', '写真集').section).toBe('グッズ');
  });

  test('写真集の購入特典ポストカード（楽天市場）は写真集ではなくグッズ', () => {
    const r = classifyProductForDisplay(
      '【中古】ポストカード 梅澤美波 ポストカード 「乃木坂46 梅澤美波 2nd写真集『透明な覚悟』」 タワーレコード購入特典',
      '中古',
    );
    expect(r.section).toBe('グッズ');
  });

  test('楽天市場: 括弧で明示された形式を優先（「ポスターなし [Blu-ray]」はBlu-ray）', () => {
    expect(classifyProductForDisplay('【中古】Sexy Zone アリーナコンサート 2012 (佐藤 勝利ver.) (特典ポスターなし) [Blu-ray]', '中古').section).toBe('Blu-ray・DVD');
    expect(classifyProductForDisplay('【中古】【Blu−ray】真夏の全国ツアー2017 FINAL！', '中古').section).toBe('Blu-ray・DVD');
    expect(classifyProductForDisplay('【中古】 Sexy Zone/ 君にHITOMEBORE / [CD]', '中古').section).toBe('CD');
  });

  test('楽天市場: 「(Blu-ray Disc付)」は本体がCD', () => {
    expect(classifyProductForDisplay('ポケットモンスター：ピッカーン！（完全生産限定盤B）（Blu−ray　Disc付）', '中古').section).toBe('CD');
  });

  test('楽天市場: グッズの品目名（付属・特典の記述は除く）', () => {
    expect(classifyProductForDisplay('乃木坂46 スティックライト neo 2 真夏の全国ツアー2023 ver.', 'グッズ').section).toBe('グッズ');
    expect(classifyProductForDisplay('アルバム 初回限定盤（クリアファイル付き）', 'グッズ').section).toBe('CD');
  });

  test('判断できない商品は推測せず「その他」（要確認）', () => {
    const r = classifyProductForDisplay('【中古】Summer Paradise 2017 佐藤勝利「佐藤勝利 summer live 2017」', '中古');
    expect(r).toEqual({ section: 'その他', needsReview: true });
  });
});

// ─── 中古・まとめ買い ───────────────────────────────────────────────────────
describe('isUsedListing / isBulkResaleSet', () => {
  test('【中古】を含む出品は中古', () => {
    expect(isUsedListing('乃木坂46 個別クリアファイル【中古】アイドル')).toBe(true);
    expect(isUsedListing('梅澤美波1st写真集　夢の近く')).toBe(false);
  });

  test('【10枚セット】【100枚セット】各25枚・×100枚 はまとめ買い', () => {
    expect(isBulkResaleSet('【10枚セット】是非に及ばず (初回仕様限定盤 CD＋Blu-ray Type-A) (特典なし)')).toBe(true);
    expect(isBulkResaleSet('【100枚セット】 【クレジットカード決済限定】是非に及ばず(初回仕様限定盤 TYPE-A＋B＋C＋D　各25枚セット)')).toBe(true);
    expect(isBulkResaleSet('是非に及ばず(初回仕様限定盤 TYPE-A×100枚セット)')).toBe(true);
  });

  test('全形態セット・2冊セット・特典の「5枚セット」・「全4枚セット」はまとめ買いではない', () => {
    expect(isBulkResaleSet('是非に及ばず (初回仕様限定盤A＋B＋C＋Dセット) (特典なし)')).toBe(false);
    expect(isBulkResaleSet('透明な覚悟　2冊セット（通常カバー+限定カバー）')).toBe(false);
    expect(isBulkResaleSet('DVDスタンダート・エディション(オリジナルTシャツ＆チェキ風フォトカード5枚セット)')).toBe(false);
    expect(isBulkResaleSet('エトロフ遥かなり 全4枚セット')).toBe(false);
  });

  test('demoteBulkResaleSets はまとめ買いを削除せず末尾へ移し、他の順序は保つ', () => {
    const a = makeProduct({ id: 'a', title: '【10枚セット】X' });
    const b = makeProduct({ id: 'b', title: 'B' });
    const c = makeProduct({ id: 'c', title: 'C' });
    expect(demoteBulkResaleSets([a, b, c]).map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });
});

// ─── dedupeProducts ─────────────────────────────────────────────────────────
describe('dedupeProducts', () => {
  test('同じ商品IDは先勝ちで1件', () => {
    const r = dedupeProducts([
      makeProduct({ id: 'x', title: 'A' }),
      makeProduct({ id: 'x', title: 'A', category: '本・雑誌' }),
    ]);
    expect(r).toHaveLength(1);
  });

  test('同じ商品IDでも実URLが違えば別商品として残す（同一ショップの別商品でIDが重なる既知の不具合への対策）', () => {
    const r = dedupeProducts([
      makeProduct({ id: 'ic-g00tje4e.ely9r2d9.g00tje', title: '【中古】【非売品】乃木坂46 予習DVD', itemUrl: affUrl('https://item.rakuten.co.jp/cocohouse/b014bs1fuu/') }),
      makeProduct({ id: 'ic-g00tje4e.ely9r2d9.g00tje', title: '【中古】乃木坂46 3rd YEAR BIRTHDAY LIVE [DVD]', itemUrl: affUrl('https://item.rakuten.co.jp/cocohouse/b01gg4vc32/') }),
    ]);
    expect(r).toHaveLength(2);
  });

  test('同じ商品ページ（写真集・本・雑誌の両方で取得された同じ本）は1件', () => {
    const url = 'https://books.rakuten.co.jp/rb/16415246/';
    const r = dedupeProducts([
      makeProduct({ id: 'bk-16415246', title: '梅澤美波1st写真集　夢の近く', itemUrl: url, category: '写真集' }),
      makeProduct({ id: 'bk-16415246', title: '梅澤美波1st写真集　夢の近く', itemUrl: url, category: '本・雑誌' }),
    ]);
    expect(r).toHaveLength(1);
  });

  test('アフィリエイトURLは pc の実URLで比較する（ホスト+パスが同一でも別商品は残す）', () => {
    const r = dedupeProducts([
      makeProduct({ id: 'a', title: '是非に及ばず (通常盤)', itemUrl: affUrl('https://item.rakuten.co.jp/book/1/') }),
      makeProduct({ id: 'b', title: '是非に及ばず (Type-A)', itemUrl: affUrl('https://item.rakuten.co.jp/book/2/') }),
      makeProduct({ id: 'c', title: '別タイトル', itemUrl: affUrl('https://item.rakuten.co.jp/book/1/') }),
    ]);
    expect(r.map((p) => p.id)).toEqual(['a', 'b']);
  });

  test('初回盤A/B・通常盤・特典違いは別商品として残る', () => {
    const titles = [
      '是非に及ばず (初回仕様限定盤 CD＋Blu-ray Type-A)',
      '是非に及ばず (初回仕様限定盤 CD＋Blu-ray Type-B)',
      '是非に及ばず (通常盤)',
      '【楽天ブックス限定先着特典】是非に及ばず (通常盤)(ポストカード(通常盤))',
    ];
    const r = dedupeProducts(titles.map((title, i) => makeProduct({ id: `p${i}`, title, category: 'CD' })));
    expect(r).toHaveLength(4);
  });

  test('楽天市場の別ショップの同名出品は1件にまとめる（表記ゆれ: 全半角・空白）', () => {
    const r = dedupeProducts([
      makeProduct({ id: 'a', title: '【中古】【非売品】乃木坂46 予習DVD', itemUrl: affUrl('https://item.rakuten.co.jp/shop1/x/') }),
      makeProduct({ id: 'b', title: '【中古】【非売品】乃木坂４６　予習ＤＶＤ', itemUrl: affUrl('https://item.rakuten.co.jp/shop2/y/') }),
    ]);
    expect(r.map((p) => p.id)).toEqual(['a']);
  });

  test('楽天ブックスは同名・同価格でも商品番号が違えば別商品として残す（目黒蓮「月の満ち欠け」先着特典の再登録の例）', () => {
    const title = '【楽天ブックス限定先着特典】月の満ち欠け 豪華版Blu-ray【Blu-ray】(アクリルキーホルダー)';
    const r = dedupeProducts([
      makeProduct({ id: 'dv-17447015', title, price: 7480, itemUrl: 'https://books.rakuten.co.jp/rb/17447015/', category: 'Blu-ray・DVD' }),
      makeProduct({ id: 'dv-17514703', title, price: 7480, itemUrl: 'https://books.rakuten.co.jp/rb/17514703/', category: 'Blu-ray・DVD' }),
      makeProduct({ id: 'dv-17447015', title, price: 7480, itemUrl: 'https://books.rakuten.co.jp/rb/17447015/', category: 'Blu-ray・DVD' }),
    ]);
    expect(r.map((p) => p.id)).toEqual(['dv-17447015', 'dv-17514703']);
  });
});

// ─── stripPromoTags ─────────────────────────────────────────────────────────
describe('stripPromoTags', () => {
  test('確認できない宣伝タグ（予約・即納・最安値・送料無料・新品・最新 等）を除く', () => {
    expect(stripPromoTags('【二次予約（9/19以降発送）】テレビドラマ Blu-ray BOX【Blu-ray】')).toBe('テレビドラマ Blu-ray BOX【Blu-ray】');
    expect(stripPromoTags('【即納】【最安値挑戦】写真集')).toBe('写真集');
    expect(stripPromoTags('【新品】ポスター【送料無料】')).toBe('ポスター');
    expect(stripPromoTags('【メール便送料無料】【最短翌日配達対応】本')).toBe('本');
    expect(stripPromoTags('★完全生産限定盤★特典映像★10％OFF■乃木坂46 2Blu-ray')).toBe('★完全生産限定盤★特典映像★■乃木坂46 2Blu-ray');
  });

  test('【中古】・限定特典・形式など商品の区別に必要なタグは残す', () => {
    expect(stripPromoTags('【中古】写真集')).toBe('【中古】写真集');
    expect(stripPromoTags('【楽天ブックス限定先着特典】是非に及ばず (通常盤)')).toBe('【楽天ブックス限定先着特典】是非に及ばず (通常盤)');
    expect(stripPromoTags('映画【Blu-ray】')).toBe('映画【Blu-ray】');
  });

  test('除去で空になる場合は元のタイトル', () => {
    expect(stripPromoTags('【予約】')).toBe('【予約】');
  });
});
