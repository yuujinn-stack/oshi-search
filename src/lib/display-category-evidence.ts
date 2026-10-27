// 表示分類の根拠つき補正（楽天ブックスの商品番号の完全一致）。純粋なデータ（DB・API に依存しない）。
//
// 対象は、手動登録で「写真集」等に保存され、商品名だけでは CD か映像か分からない（classifyProductDetailed が「その他」＝要確認にする）
// 楽天ブックスの商品のうち、同じ商品番号の商品が楽天ブックスの CD 検索（または DVD 検索）で取得されて CD（または Blu-ray・DVD）
// カテゴリに保存されているもの。どちらか一方の形式にだけある商品番号だけを載せる（両方にある・どちらにも無い商品は載せない）。
// 商品名の部分一致では判断しない。
//
// この一覧は scripts/display-category/find-evidence.ts（本番DBを読み取り専用で照合）で作成・検証する。
// 補正は「要確認」になる商品にだけ効く（ほかの規則で分類できる商品・保存カテゴリには影響しない。src/lib/product-curation.ts）。
// products の保存カテゴリ・商品ID・リンクは変更しない（表示だけ）。

export interface DisplayCategoryEvidence {
  section: 'CD' | 'Blu-ray・DVD';
  /** 確認時の商品名（記録用。判定には使わない） */
  title: string;
}

/** 確認日（find-evidence.ts で本番データと照合した日） */
export const DISPLAY_CATEGORY_EVIDENCE_CHECKED_AT = '2026-10-27';

/** 楽天ブックスの商品番号（books.rakuten.co.jp/rb/<番号>）→ 表示セクション */
export const DISPLAY_CATEGORY_EVIDENCE: Readonly<Record<string, DisplayCategoryEvidence>> = {
  '12771048': { section: 'CD', title: '夏のFree＆Easy　（通常盤） [ 乃木坂46 ]' },
  '15481699': { section: 'CD', title: '走り出す瞬間 (通常盤) [ けやき坂46 ]' },
  '15814961': { section: 'CD', title: 'キュン (通常盤) [ 日向坂46 ]' },
  '15936497': { section: 'CD', title: 'ドレミソラシド (通常盤) [ 日向坂46 ]' },
  '16024360': { section: 'CD', title: 'こんなに好きになっちゃっていいの？ (通常盤) [ 日向坂46 ]' },
  '16695100': { section: 'CD', title: '君しか勝たん (通常盤) [ 日向坂46 ]' },
  '16857503': { section: 'CD', title: 'ってか (通常盤) [ 日向坂46 ]' },
  '17108618': { section: 'CD', title: '僕なんか (通常盤) [ 日向坂46 ]' },
  '17283380': { section: 'CD', title: '月と星が踊るMidnight (通常盤) [ 日向坂46 ]' },
  '17442369': { section: 'CD', title: 'One choice (通常盤) [ 日向坂46 ]' },
  '17540332': { section: 'CD', title: 'Am I ready? (通常盤) [ 日向坂46 ]' },
  '18506270': { section: 'CD', title: '劇薬中毒 (通常盤 Type F)' },
  '18597461': { section: 'CD', title: '【楽天ブックス限定先着特典】ぱわーオブらぶ / センセーション (初回限定盤) [ FRUITS ZIPPER ]' },
  '18597623': { section: 'CD', title: '【楽天ブックス限定先着特典】ぱわーオブらぶ / センセーション (通常盤) [ FRUITS ZIPPER ]' },
  '16164042': { section: 'Blu-ray・DVD', title: '欅坂46 LIVE at 東京ドーム ～ARENA TOUR 2019 FINAL～(通常盤) [ 欅坂46 ]' },
};
