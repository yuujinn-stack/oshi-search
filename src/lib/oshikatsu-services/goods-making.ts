// 推し活グッズ制作サービス比較（/oshikatsu/goods-making）の掲載内容。
//
// 料金・送料・納期・品目・注文条件は、各サービスの公式サイトで確認できた内容だけを載せる。
// 確認できない項目は推測で書かず CHECK_OFFICIAL（「公式サイトで確認」）にする。
// 体験談・口コミ・ランキング・満足度は載せない（推しサーチは実際に利用していないため）。
// 公式の説明文はコピーせず、推しサーチ側で要約・整理した文章にしている。
// 内容を更新したら GOODS_MAKING_CHECKED_AT と sitemap.ts の lastModified も書き換えること。
// リンク先（公式サイト・将来の広告リンク）は links.ts で管理する（ここには書かない）。

import type { OshikatsuServiceId } from './links';

export const GOODS_MAKING_PATH = '/oshikatsu/goods-making';

/** 各公式サイトの内容（品目・特徴・納期・注文方法など）を確認した日 */
export const GOODS_MAKING_CHECKED_AT = '2026年11月3日';

/** 料金・送料を公式サイトで確認した日（比較表の「料金の目安」「送料」と関連する案内文の金額） */
export const GOODS_MAKING_PRICE_CHECKED_AT = '2026年11月4日';

export const CHECK_OFFICIAL = '公式サイトで確認';

export interface GoodsMakingService {
  id: OshikatsuServiceId;
  /** ページ内アンカー（#gm-svc-...） */
  anchor: string;
  /** アイコン代わりの1文字（公式ロゴ・画像は使わない） */
  mark: string;
  operator: string;
  catchCopy: string;
  items: string[];
  features: string[];
  recommendedFor: string[];
  /** 比較表の各項目 */
  compare: Record<CompareKey, string>;
  /** 確認に使った公式ページ */
  sources: { label: string; url: string }[];
}

export type CompareKey = 'items' | 'minQty' | 'price' | 'shipping' | 'leadTime' | 'howToOrder' | 'notes';

export const COMPARE_ROWS: { key: CompareKey; label: string }[] = [
  { key: 'items', label: '主な制作アイテム' },
  { key: 'minQty', label: '最小注文個数' },
  { key: 'price', label: '料金の目安（税込）' },
  { key: 'shipping', label: '送料（税込）' },
  { key: 'leadTime', label: '制作・発送期間' },
  { key: 'howToOrder', label: '注文方法' },
  { key: 'notes', label: '注意事項' },
];

export const GOODS_MAKING_SERVICES: GoodsMakingService[] = [
  {
    id: 'shimauma_plus',
    anchor: 'gm-svc-shimauma',
    mark: 'し',
    operator: '株式会社しまうまプリント',
    catchCopy: 'スマホの写真などの画像から、アクリルグッズやステッカーを1個から作れる',
    items: [
      'アクリルスタンド・フォトスタンド',
      'アクリルキーホルダー・フォトキーホルダー・ネームキーホルダー',
      'アクリルカード（フォトカード・プロフィールカードなど）とカードスタンド',
      'カットステッカー・モチーフステッカー',
    ],
    features: [
      '自分で用意した画像をアップロードして、完成イメージを見ながら作れる（パソコン・スマホに対応）',
      'アクリルスタンドは画像の自動切り抜き機能を使って作れる',
      '1個から注文でき、1注文あたりの個数に上限はない（デザインは1注文249種まで）',
      '自宅配送のほか、対象商品はカメラのキタムラの店頭で受け取ることもできる（送料無料。対象商品は公式サイトで確認）',
    ],
    recommendedFor: [
      '自分で撮った写真などの画像で、アクリルグッズを作りたい人',
      'まずは1個、安く試してみたい人',
      'ステッカーやカードなど、いろいろな種類を作りたい人',
    ],
    compare: {
      items: 'アクリルスタンド、アクリルキーホルダー、アクリルカード、ステッカーなど',
      minQty: '1個から（1注文の個数上限なし。デザインは249種まで）',
      // 2026-11-04 公式（pages/price・pages/delivery・pages/first）で確認。
      // アクリルスタンドは価格表に通常価格と割引価格（Sサイズ600円・500円）の表記が混在し、
      // 割引の適用条件を確認できなかったため金額を載せない（M・Lも再確認できていないため同様）。
      // 「3,000円以上送料無料」は公式トップに表示が残るが、確認できたキャンペーンの終了日が2026年3月31日のため載せない。
      price: '150円〜（商品による）。アクリルキーホルダー450円〜。アクリルスタンドは公式サイトで確認',
      shipping: '自宅配送（ゆうパケット）330円。対象商品はカメラのキタムラの店頭受取で送料無料（対象商品は公式サイトで確認）。送料無料キャンペーンなどの条件は公式サイトで確認',
      leadTime: '発送予定は注文から2週間（確認時点の目安。時期により変わる）、発送から2〜3日程度でお届け（一部地域を除く）。店頭受取は店舗到着まで約20日',
      howToOrder: 'Webでアイテムを選び、画像をアップロードしてデザインを確認・調整して注文',
      notes: '受注製造のため自己都合の返品・交換は不可。注文完了後30分以内なら自分でキャンセルできる。第三者の権利を侵害する注文は出荷停止（返金なし）',
    },
    sources: [
      { label: '価格', url: 'https://www.shimauma-plus.n-pri.jp/pages/price' },
      { label: '配送・納期', url: 'https://www.shimauma-plus.n-pri.jp/pages/delivery' },
      { label: 'はじめての方へ', url: 'https://www.shimauma-plus.n-pri.jp/pages/first' },
      { label: 'よくあるご質問', url: 'https://www.shimauma-plus.n-pri.jp/pages/faq' },
      { label: '特定商取引に基づく表記', url: 'https://www.shimauma-plus.n-pri.jp/pages/law' },
    ],
  },
  {
    id: 'cherish_palette',
    anchor: 'gm-svc-cherish',
    mark: 'C',
    operator: '株式会社ソルトワークス',
    catchCopy: '手持ちの推しグッズを飾るフレームやスタンドなどを、推し色2色の組み合わせで注文できる',
    items: [
      'アクリルカードフレーム（カードサイズ・ポストカードサイズ）',
      'アクリル缶バッジフレーム（57mm・75mm）',
      'アクリルスタンドフレーム',
      'ぬいスタンド・俵型ぬいスタンド',
      'アクリルキーホルダー',
    ],
    features: [
      '自分の画像やデザインでグッズを作るサービスではなく、用意されたデザインのアイテムを推し色で注文する方式',
      'テンプレートを選んで色を2色選ぶだけ。1アイテムにつき9色×9色の81通りから選べる',
      '画像データのアップロードは不要',
      'カードフレーム・缶バッジフレーム・ぬいスタンドなど、手持ちの推し活グッズと組み合わせて楽しめるアイテムがある',
      '推しの名前や記念日を入れられるデザインもある',
    ],
    recommendedFor: [
      '髪色・目の色・衣装の色など、推し色の組み合わせでアイテムを作りたい人',
      '持っているカード・缶バッジ・ぬいぐるみを推し色のアイテムと組み合わせたい人',
      '画像を用意せずに、オリジナルのアイテムを作りたい人',
    ],
    compare: {
      items: 'アクリルカードフレーム、缶バッジフレーム、アクリルスタンドフレーム、ぬいスタンド、アクリルキーホルダー',
      minQty: '1点から（1回の注文は最大10点まで）',
      // 2026-11-04 公式（products・guide/delivery）で確認。最低価格は860円（アクリルキーホルダー）。
      // 11/3 の記録の「950円」は俵型ぬいスタンドの価格。有料オプションの追加料金は金額を確認できなかったため載せない。
      price: '860円〜（商品・オプションによる）。アクリルキーホルダー860円〜、俵型ぬいスタンド950円、カードフレーム2,830円〜、アクリルスタンドフレーム4,030円。有料オプションの追加料金は公式サイトで確認',
      shipping: 'ゆうパケット1,000円・ゆうパック1,400円。4,500円（税込）以上の購入でゆうパケットは無料、ゆうパックは400円',
      leadTime: '受注生産で、注文から20日前後でお届け（混雑時期・一部地域は遅れる場合あり）',
      howToOrder: 'Webでテンプレートを選び、2色を選んで注文（画像のアップロード不要）',
      notes: '自己都合の返品は不可。注文確定後1時間以内ならマイページからキャンセルできる。画面と実物で色が多少異なる場合がある',
    },
    sources: [
      { label: 'Cherish Paletteとは', url: 'https://cherish-palette.jp/about' },
      { label: 'すべてのアイテム', url: 'https://cherish-palette.jp/products' },
      { label: '配送について', url: 'https://cherish-palette.jp/guide/delivery' },
      { label: 'キャンセル・返品について', url: 'https://cherish-palette.jp/guide/cancel' },
      { label: '特定商取引法に基づく表示', url: 'https://cherish-palette.jp/law/' },
    ],
  },
];

/** ②「どんなグッズを作りたい？」の案内（サービスカードへ移動） */
export const WANT_OPTIONS: { label: string; desc: string; serviceId: OshikatsuServiceId }[] = [
  { label: '写真などの画像でアクリルグッズ', desc: 'アクスタ・キーホルダー・ステッカーなど', serviceId: 'shimauma_plus' },
  { label: '推し色を組み合わせたアイテム', desc: '用意されたデザインを2色の組み合わせで注文', serviceId: 'cherish_palette' },
  { label: '手持ちのグッズを飾るアイテム', desc: 'カード・缶バッジ・ぬいぐるみ用のフレームやスタンド', serviceId: 'cherish_palette' },
];

/** ⑤ 目的別の選び方（理由は上の確認済みの内容に基づく） */
export const CHOOSE_GUIDES: { want: string; serviceId: OshikatsuServiceId; reason: string }[] = [
  {
    want: '自分のデザインでアクリルグッズを作りたい',
    serviceId: 'shimauma_plus',
    reason: '自分の画像をアップロードして、アクリルスタンドやキーホルダーを作れます。Cherish Paletteは画像を使わず色を選ぶ方式です。',
  },
  {
    want: '推し色を組み合わせたグッズが欲しい',
    serviceId: 'cherish_palette',
    reason: '1つのアイテムに2色を組み合わせられ、9色×9色の81通りから選べます。',
  },
  {
    want: '持っているカードや缶バッジ、ぬいぐるみと組み合わせたい',
    serviceId: 'cherish_palette',
    reason: 'カードフレーム・缶バッジフレーム・ぬいスタンドなど、手持ちの推し活グッズと組み合わせて楽しめるアイテムがあります。',
  },
  {
    want: 'まずは1個だけ、安く試してみたい',
    serviceId: 'shimauma_plus',
    reason: 'どちらも1個から注文できます。しまうまプラスは150円〜（商品による）で、自宅配送（ゆうパケット）の送料は330円です。',
  },
];

export const GOODS_MAKING_FAQ: { q: string; a: string }[] = [
  {
    q: '1個だけでも注文できますか？',
    a: 'どちらのサービスも1個から注文できます。しまうまプラスは1注文あたりの個数に上限はなく（デザインは249種まで）、Cherish Paletteは1回の注文で最大10点までです。',
  },
  {
    q: '推しの写真や公式画像を使ってグッズを作ってもいいですか？',
    a: '芸能人・アイドルの写真、公式ロゴ、キャラクターなどは、権利者の許可なく使うことはできません。しまうまプラスでは、第三者の権利を侵害する注文は出荷が停止され、返金もされないと案内されています。自分で撮影した写真や自分で描いたオリジナルのイラストを使いましょう。',
  },
  {
    q: '注文してから届くまで、どれくらいかかりますか？',
    a: `${GOODS_MAKING_CHECKED_AT}時点で、しまうまプラスは注文から2週間で発送し、発送から2〜3日程度でお届け（一部地域を除く）、Cherish Paletteは注文から20日前後でお届けと案内されています。時期によって変わるため、イベントなどに合わせる場合は各公式サイトで最新の目安を確認してください。`,
  },
  {
    q: '注文した後にキャンセルや返品はできますか？',
    a: 'どちらも注文を受けてから作るため、自己都合の返品はできません。キャンセルは、しまうまプラスが注文完了後30分以内、Cherish Paletteが注文確定後1時間以内に限り、自分で手続きできます。不良品の場合の対応は各公式サイトで確認してください。',
  },
];
