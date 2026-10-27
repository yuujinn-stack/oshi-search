import { describe, it, expect } from 'vitest';
import { classifyProductDetailed, classifyProductForDisplay, suggestManualCategory } from '../product-curation';

// 表示分類の改善（Phase 3）：書籍・CD の検索に入った別の形式の商品を、商品名の明示的な語で正しいタブに出す（DB は変えない）。
// 例は本番の商品データ（読み取りのみで確認）から。
const BOOKS = 'https://hb.afl.rakuten.co.jp/hgc/x/?pc=https%3A%2F%2Fbooks.rakuten.co.jp%2Frb%2F12345678%2F';
const SHOP = 'https://hb.afl.rakuten.co.jp/hgc/x/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshop%2Fitem1%2F';
const sec = (title: string, cat: Parameters<typeof classifyProductForDisplay>[1], url = BOOKS) => classifyProductForDisplay(title, cat, url).section;

describe('写真集・本・雑誌として保存された商品', () => {
  it('CD（CD＋映像のセット・[CD]）は CD', () => {
    expect(sec("Nobody's fault (初回仕様限定盤 Type-B CD＋Blu-ray) [ 櫻坂46 ]", '写真集')).toBe('CD');
    expect(sec('ぐるぐるカーテン（TypeB CD＋DVD） [ 乃木坂46 ]', '写真集')).toBe('CD');
    expect(sec('走れ!Bicycle/乃木坂46[CD]通常盤【返品種別A】', '写真集', SHOP)).toBe('CD');
    expect(sec('NEW KAWAII (初回限定盤 CD＋ブックレット) [ FRUITS ZIPPER ]', '写真集')).toBe('CD');
  });
  it('DVD・Blu-ray・ライブ映像は Blu-ray・DVD', () => {
    expect(sec('ドS刑事 DVD-BOX [ 多部未華子 ]', '写真集')).toBe('Blu-ray・DVD');
    expect(sec('恋はつづくよどこまでも【Blu-ray】 [ 上白石萌音 ]', '写真集')).toBe('Blu-ray・DVD');
    expect(sec('1st LIVE FILM at 日本武道館 FRUITS ZIPPER【Blu-ray】 [ FRUITS ZIPPER ]', '本・雑誌')).toBe('Blu-ray・DVD');
    expect(sec('DVD＞バナナマン：ヘポカボチャ', '写真集')).toBe('Blu-ray・DVD');
  });
  it('写真集・雑誌・文庫・コミックは書籍のまま（DVD付・CD付も書籍）', () => {
    expect(sec('乃木坂46 筒井あやめ1st写真集 感情の隙間', '写真集')).toBe('写真集・書籍');
    expect(sec('anan 2024年1月号 [雑誌]', '本・雑誌')).toBe('写真集・書籍');
    expect(sec('【映画化記念帯】ほどなく、お別れです 文庫1巻〜4巻 (目黒 蓮&浜辺 美波 帯付き)', '写真集')).toBe('写真集・書籍');
    expect(sec('野球少女鷲尾＠comic 鷲尾さんは楽天的でいたい 1〜4巻 セット', '写真集')).toBe('写真集・書籍');
    expect(sec('エリートジャック！！ 6 DVD付特装版', '写真集')).toBe('写真集・書籍');
    expect(sec('はじめてのギター 教則 CD付き', '本・雑誌')).toBe('写真集・書籍');
    expect(sec('写真集 DVD付き 〇〇', '写真集')).toBe('写真集・書籍');
    expect(sec('Eye-Ai+vol.5', '写真集')).toBe('写真集・書籍');
  });
  it('盤だけで CD か映像か分からない商品は「その他」（要確認）', () => {
    const r = classifyProductDetailed("Nobody's fault (通常盤) [ 櫻坂46 ]", '写真集', BOOKS);
    expect(r).toMatchObject({ section: 'その他', needsReview: true, basis: 'none' });
    expect(sec('THE BEST (初回盤A(DVD)＋初回盤B(DVD)＋通常盤セット)', '写真集')).toBe('その他');
  });
  it('グッズの品目は従来どおりグッズ', () => {
    expect(sec('乃木坂46 2026年カレンダー', '写真集')).toBe('グッズ');
    expect(sec('乃木坂46 アクリルスタンド', '本・雑誌')).toBe('グッズ');
  });
});

describe('CD として保存された商品', () => {
  it('【Blu-ray】だけのライブ映像は Blu-ray・DVD（楽天ブックスの商品も）', () => {
    expect(sec('欅坂46 LIVE at 東京ドーム ～ARENA TOUR 2019 FINAL～(初回生産限定盤)【Blu-ray】 [ 欅坂46 ]', 'CD')).toBe('Blu-ray・DVD');
    expect(sec('=LOVE 8th ANNIVERSARY PREMIUM TOUR(初回生産限定盤)【Blu-ray】', 'CD')).toBe('Blu-ray・DVD');
  });
  it('盤に映像の特典が付く CD・CD＋Blu-ray・DVD付は CD のまま', () => {
    expect(sec('【先着特典】THE BEST 2020 - 2025 (初回盤A(DVD)＋初回盤B(DVD)＋通常盤セット)', 'CD')).toBe('CD');
    expect(sec('【先着特典】音故知新 (初回盤A(Blu-ray)＋初回盤B(Blu-ray)＋通常盤セット)', 'CD')).toBe('CD');
    expect(sec('Nobody\'s fault (初回仕様限定盤 Type-A CD＋Blu-ray) [ 櫻坂46 ]', 'CD')).toBe('CD');
    expect(sec('インフルエンサー（TYPE−A）（DVD付）', 'CD')).toBe('CD');
    expect(sec('ぐるぐるカーテン (通常盤) [ 乃木坂46 ]', 'CD')).toBe('CD');
  });
  it('Blu-ray・DVD として保存された商品は従来どおり', () => {
    expect(sec('ライブ 2024【Blu-ray】', 'Blu-ray・DVD')).toBe('Blu-ray・DVD');
  });
});

describe('中古（楽天市場）', () => {
  it('従来どおり商品名で判定', () => {
    expect(sec('【中古】【CD＋DVD】君の名は希望 Type－B / 乃木坂46', '中古', SHOP)).toBe('CD');
    expect(sec('【中古】 ちはやふる 下の句 [レンタル落ち] [Blu-ray]', '中古', SHOP)).toBe('Blu-ray・DVD');
    expect(sec('【中古】生写真 乃木坂46', '中古', SHOP)).toBe('グッズ');
    expect(classifyProductDetailed('【中古】よく分からない商品', '中古', SHOP)).toMatchObject({ section: 'その他', needsReview: true });
  });
});

describe('根拠の表示（管理画面用）', () => {
  it('保存カテゴリ／商品名／根拠なしを区別する', () => {
    expect(classifyProductDetailed('ドS刑事 DVD-BOX', '写真集', BOOKS)).toMatchObject({ basis: 'title', section: 'Blu-ray・DVD' });
    expect(classifyProductDetailed('ほげ', '写真集', BOOKS)).toMatchObject({ basis: 'source_category', section: '写真集・書籍' });
    expect(classifyProductDetailed('ほげ', 'CD', BOOKS)).toMatchObject({ basis: 'source_category', section: 'CD' });
    expect(classifyProductDetailed('ほげ', 'CD', BOOKS).reason).toContain('保存カテゴリ（CD）');
  });
});

describe('手動登録のカテゴリの候補（自動では選ばない）', () => {
  it('商品名から候補と理由を返す。分からなければ null', () => {
    expect(suggestManualCategory('ぐるぐるカーテン（TypeB CD＋DVD） [ 乃木坂46 ]')?.category).toBe('CD');
    expect(suggestManualCategory('ライブ2024【Blu-ray】')?.category).toBe('Blu-ray・DVD');
    expect(suggestManualCategory('乃木坂46 筒井あやめ1st写真集')?.category).toBe('写真集');
    expect(suggestManualCategory('ほどなく、お別れです 文庫1巻〜4巻')?.category).toBe('本・雑誌');
    expect(suggestManualCategory('乃木坂46 アクリルスタンド')?.category).toBe('グッズ');
    expect(suggestManualCategory('【中古】乃木坂46 生写真')?.category).toBe('中古');
    expect(suggestManualCategory('なにかの商品')).toBeNull();
    expect(suggestManualCategory('')).toBeNull();
  });
});

describe('商品番号の根拠による補正（src/lib/display-category-evidence.ts）', () => {
  const books = (n: string) => `https://hb.afl.rakuten.co.jp/hgc/x/?pc=https%3A%2F%2Fbooks.rakuten.co.jp%2Frb%2F${n}%2F`;
  it('一覧の商品番号と完全一致したときだけ、要確認の商品を CD／映像に', () => {
    expect(classifyProductDetailed('キュン (通常盤) [ 日向坂46 ]', '写真集', books('15814961'))).toMatchObject({ section: 'CD', basis: 'product_number', needsReview: false });
    expect(classifyProductDetailed('欅坂46 LIVE at 東京ドーム ～ARENA TOUR 2019 FINAL～(通常盤) [ 欅坂46 ]', '写真集', 'https://books.rakuten.co.jp/rb/16164042/')).toMatchObject({ section: 'Blu-ray・DVD', basis: 'product_number' });
    // 商品番号が違えば（名前が同じでも）補正しない
    expect(classifyProductDetailed('キュン (通常盤) [ 日向坂46 ]', '写真集', books('15814960')).section).toBe('その他');
    expect(classifyProductDetailed('キュン (通常盤) [ 日向坂46 ]', '写真集', 'https://item.rakuten.co.jp/shop/15814961/').section).toBe('その他');
  });
  it('根拠が両方にある・根拠の無い商品は要確認のまま', () => {
    expect(classifyProductDetailed('欅坂46 LIVE at 東京ドーム ～ARENA TOUR 2019 FINAL～(初回生産限定盤) [ 欅坂46 ]', '写真集', books('16164041')).section).toBe('その他');
    expect(classifyProductDetailed('制服のマネキン（通常盤） [ 乃木坂46 ]', '写真集', books('12064985')).section).toBe('その他');
    expect(classifyProductDetailed("Nobody's fault (通常盤) [ 櫻坂46 ]", '写真集', books('16500432')).section).toBe('その他');
    expect(classifyProductDetailed('KawaiiってMagic (通常盤) [ FRUITS ZIPPER ]', '写真集', books('18158363')).section).toBe('その他');
  });
  it('要確認以外の商品には効かない（商品名・保存カテゴリの判定が優先）', () => {
    // 一覧にある商品番号でも、商品名で書籍・CD と分かる商品・CD/映像として保存された商品はそのまま
    expect(classifyProductDetailed('〇〇 1st写真集', '写真集', books('16164042')).section).toBe('写真集・書籍');
    expect(classifyProductDetailed('なにかのCD', 'CD', books('16164042'))).toMatchObject({ section: 'CD', basis: 'source_category' });
    expect(classifyProductDetailed('ほげ', '写真集', books('15814961'))).toMatchObject({ section: '写真集・書籍', basis: 'source_category' });
  });
  it('一覧を作るときは補正を使わない（useEvidence: false）', () => {
    expect(classifyProductDetailed('キュン (通常盤) [ 日向坂46 ]', '写真集', books('15814961'), { useEvidence: false }).section).toBe('その他');
  });
});
