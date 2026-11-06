// ライブ参戦服・ファッションレンタル比較（/oshikatsu/fashion-rental）の掲載内容と、目的別の絞り込み（純粋関数）。
//
// 掲載ルール:
// - 各社の公式サイトで確認できた内容だけを書く（確認日は FASHION_CHECKED_AT）。確認できない項目は「要確認」。
// - 公式サイト内で記載が食い違う場合は、両方の記載をそのまま書き、「公式サイトで最新の内容を確認」と添える（どちらかを推測で選ばない）。
// - 推し色・ブランド・サイズ・在庫が必ず借りられるという表現は書かない（商品の在庫・色・サイズは取得していない）。
// - 料金が安い・お得といった比較の断定は書かない。
// - 広告リンクは管理画面（/admin/affiliates?tab=oshikatsu、ジャンル「ファッションレンタル」）で管理する。ここには書かない。
//
// サービスを追加・削除するときは FASHION_SERVICES を編集し、
// src/lib/oshikatsu-affiliate/constants.ts の OSHIKATSU_PAGE_SERVICE_KEYS.fashion_rental も合わせる。

export const FASHION_RENTAL_PATH = '/oshikatsu/fashion-rental';

/** 各社の公式サイトを確認した日 */
export const FASHION_CHECKED_AT = '2026年11月6日';

export const FASHION_NEEDS_CHECK = '要確認';

export type FashionServiceId = 'mechakari' | 'aircloset';

export type FashionPurposeId = 'self_select' | 'stylist' | 'new_items' | 'buy_later' | 'no_deadline';

export const FASHION_PURPOSES: { id: FashionPurposeId; label: string }[] = [
  { id: 'self_select', label: '自分で服を選びたい' },
  { id: 'stylist', label: 'コーデを提案してほしい' },
  { id: 'new_items', label: '新品の服を借りたい' },
  { id: 'buy_later', label: '気に入った服は買い取りたい' },
  { id: 'no_deadline', label: '返却期限を気にせず使いたい' },
];

/** yes: 公式サイトに明記 / partial: 一部の機能・条件つきで明記。未記載はキーなし（＝明記なし。絞り込みには出さない） */
export type FashionPurposeFit = { fit: 'yes' | 'partial'; note: string };

export interface FashionPlan {
  name: string;
  price: string;
  detail: string;
}

export interface FashionService {
  id: FashionServiceId;
  name: string;
  operator: string;
  officialUrl: string;
  mark: string;
  summary: string;
  plans: FashionPlan[];
  /** 料金表示についての注意（公式サイト内で記載が食い違う場合など） */
  priceNote?: string;
  purposes: Partial<Record<FashionPurposeId, FashionPurposeFit>>;
  items: string;
  selection: string;
  newOrUsed: string;
  /** 配送料・返却手数料 */
  shipping: string;
  exchange: string;
  /** 自動更新の有無 */
  autoRenew: string;
  /** 1か月だけ利用できるか（最低利用期間・解約のタイミング） */
  oneMonth: string;
  /** 長期コース・途中解約金 */
  longTerm: string;
  /** 返却期限（通常時・解約時） */
  returnDeadline: string;
  cancel: string;
  sizes: string;
  /** 汚損・破損・紛失時の費用（通常使用の汚れと、重大な破損・紛失を分けて書く） */
  damage: string;
  /** 補償・弁償条件の公式ページ（補償案内・利用規約） */
  damageLinks: { label: string; url: string }[];
  /** 希望の服・色・サイズが借りられるかについての公式の記載 */
  availability: string;
  purchase: string;
  /** 月額料金以外にかかる費用 */
  extraCosts: string[];
  /**
   * カードで常に表示する「注意したい条件・追加費用」の概要（詳しい条件は折りたたみ内）。
   * 上の各項目の内容を短く言い換えたものだけを書く（新しい情報・推測を足さない）。
   */
  cautionSummary: string[];
  notes: string[];
  sources: { label: string; url: string }[];
}

// ── メチャカリ（https://mechakari.com/） ─────────────────────────────────────────
// 料金は「特定商取引に基づく表記」を基準にする（通常料金）。トップページには別の金額表示（「月額5,980円から」「月額￥3,160~」）が
// あるが、キャンペーン等の条件の説明を公式サイトで確認できないため掲載しない。公式FAQ（faq.mechakari.com）は取得できなかった。
const MECHAKARI: FashionService = {
  id: 'mechakari',
  name: 'メチャカリ',
  operator: '株式会社ストライプインターナショナル',
  officialUrl: 'https://mechakari.com/',
  mark: 'メ',
  summary: 'コーディネートから自分で服を選んで借りるファッションサブスク。公式サイトでは「借りられるアイテムは全て新品」と案内されています。',
  plans: [
    { name: 'ライトプラン', price: '3,476円（税込）/月', detail: '一度に借りられるのは1点' },
    { name: 'ベーシックプラン', price: '6,578円（税込）/月', detail: '一度に借りられるのは3点' },
    { name: 'プレミアムプラン', price: '10,978円（税込）/月', detail: '一度に借りられるのは5点' },
  ],
  priceNote: '月額料金は「特定商取引に基づく表記」の通常料金です（別途、返却手数料418円（税込）/回）。トップページには別の金額表示がありますが、適用条件の説明を確認できないため掲載していません。最新の料金は公式サイトで確認してください。',
  purposes: {
    self_select: { fit: 'yes', note: '豊富なコーディネートから自分で洋服を選ぶ' },
    new_items: { fit: 'yes', note: '「借りられるアイテムは全て新品」' },
    buy_later: { fit: 'yes', note: '割引価格で購入、または60日間借り続けると無償で譲り受けられる（条件あり）' },
    no_deadline: { fit: 'yes', note: '「返却期限 なし」と案内（解約するときは当社が指定する期限までに返却）' },
  },
  items: 'koe、earth music&ecology、YECCA VECCA、CRAFT STANDARD BOUTIQUE、Green Parks、AMERICAN HOLIC などのブランドを掲載（オフィス・プライベート・オケージョンのスタイル）。レディース・メンズの別は要確認',
  selection: '自分で選ぶ（豊富なコーディネートから洋服を選ぶ）。スタイリストによる提案の有無は要確認',
  newOrUsed: '新品（「借りられるアイテムは全て新品」と案内）',
  shipping: '返却手数料 418円（税込）/回（返却は1点から可・クリーニング不要）。お届け時の送料は要確認',
  exchange: '交換回数は無制限と案内（レンタル枠がいっぱいのときは次に借りたい服を予約し、枠が空いてから発送）',
  autoRenew: 'あり（1か月単位の自動更新）',
  oneMonth: '最低利用期間の記載は要確認。月額料金は解約手続きが完了するまで毎月発生し、更新日前に解約しても日割りの返金はなし。レンタル中・予約中・返却後の状態確認が終わるまでは解約手続きができない',
  longTerm: '長期コース・途中解約金の記載はなし',
  returnDeadline: '通常は返却期限なし。解約後は当社が指定する返却期限までに返却（日数は要確認。期限内に返却しない場合は違約金の対象）',
  cancel: 'アプリで手続き。レンタル中のアイテムがなければ1か月単位のスキップ（月額料金なし）が可能',
  sizes: FASHION_NEEDS_CHECK,
  damage: '利用規約では、盗難・紛失や使用できない破損・汚損は当社標準販売価格の100％、修繕可能な場合は20％の違約金。軽微な汚れの扱いは要確認。実際の負担は利用規約と状態の確認結果によって異なります',
  damageLinks: [{ label: '利用規約（第13条・第16条）', url: 'https://mechakari.com/agreement.html' }],
  availability: '希望の服を借りられると約束する記載はなく、予約した服はレンタル枠が空いてから発送されます。色・サイズの指定についての記載は要確認',
  purchase: '購入できる（表示価格からさらに10％OFF〜と案内）。出荷完了から60日間経過し、月額料金を支払っている場合は無償で譲り受けられる。購入後の返品・返金は不可',
  cautionSummary: [
    '1か月単位の自動更新。更新日前に解約しても日割りの返金なし',
    '返却手数料418円（税込）/回（お届け時の送料は要確認）',
    '紛失・使用できない破損は当社標準販売価格の100％、修繕可能な場合は20％の違約金',
    '解約後は当社が指定する期限までに返却（日数は要確認）',
  ],
  extraCosts: [
    '返却手数料：418円（税込）/回',
    'お届け時の送料：要確認',
    '紛失・破損・汚損の違約金（当社標準販売価格の20％または100％）',
    '購入する場合の代金',
  ],
  notes: [
    '月額料金は、その月に1回もレンタルしなくても発生します',
    '18歳未満は保護者の承諾が必要です',
  ],
  sources: [
    { label: 'トップページ', url: 'https://mechakari.com/' },
    { label: '特定商取引に基づく表記', url: 'https://mechakari.com/transactions.html' },
    { label: '利用規約', url: 'https://mechakari.com/agreement.html' },
  ],
};

// ── airCloset（https://www.air-closet.com/） ───────────────────────────────────
// 月額料金はトップページ・ヘルプ「途中解約金について」の1ヵ月コースの正規価格。ヘルプの一部に異なる金額の記載があるが、
// 2024年9月2日に価格改定の案内があり、旧料金と思われるため掲載しない。3・6・12ヵ月コースの割引後の金額は要確認。
// 補償条件は、補償案内（/compensation/）と月額会員規約（第10条）で記載が異なり、適用関係の説明がないため断定しない。
const AIRCLOSET: FashionService = {
  id: 'aircloset',
  name: 'airCloset（エアークローゼット）',
  operator: '株式会社エアークローゼット',
  officialUrl: 'https://www.air-closet.com/',
  mark: 'a',
  summary: 'スタイリストが選んだ3着1セットが届くファッションレンタル。お届け前のリクエストや、一部のアイテムを自分で選ぶ機能も案内されています。',
  plans: [
    { name: 'ライト', price: '7,980円（税込）/月', detail: '1ヵ月コースの正規価格。月3着。交換回数は毎月1回付与（付与から6か月有効。登録初月は交換不可）' },
    { name: 'レギュラー', price: '10,980円（税込）/月', detail: '1ヵ月コースの正規価格。交換回数は無制限（借り放題）。1回のお届けは3点1セット' },
  ],
  priceNote: '料金は1ヵ月コースの正規価格です。3・6・12ヵ月コースは月額料金の割引があります（割引後の金額は公式サイトで確認してください）。別途、配送料330円（税込）/配送（沖縄県は990円）がかかります。2024年9月1日以前に登録した人は旧価格の場合があります。',
  purposes: {
    stylist: { fit: 'yes', note: 'スタイリストが選定。お届け前にリクエスト・着たくない服の登録が可能' },
    self_select: { fit: 'partial', note: '次回のコーデのうち1着を選べる「ワンセレクト」、自分でアイテムを選べる「セルフセレクト機能」の案内あり' },
    buy_later: { fit: 'yes', note: 'レンタル中のアイテムを購入できる（返却前に購入）' },
    no_deadline: { fit: 'yes', note: '「返却期限は設けておりません」と案内（解約するときは申請日から7日以内に返却）' },
  },
  items: '300ブランド・50万着と案内（Mila Owen、SNIDEL、FRAY I.D、NANO universe など）。オン・オフどちらにも。レディース・メンズの別は要確認。妊婦専用アイテムは取り扱いなし',
  selection: '基本はスタイリストが選ぶ。お届け前にスタイリングの方針確認・リクエストが可能。ワンセレクト（1着を自分で選ぶ）やセルフセレクト機能、ブランドセレクト（有料オプション）もあり',
  newOrUsed: '要確認（「クリーニング済みのキレイな服が届く」と案内）',
  shipping: '配送料 330円（税込）/配送（沖縄県は990円）。交換でお届けするたびにかかる。通常の返却時の支払いはなし（返却忘れの品などを後から送る場合はお客様負担）',
  exchange: 'ライトは毎月1回の交換回数を使って交換、レギュラーは月内に何回でも交換可能。返却は購入品を除いてまとめて',
  autoRenew: 'あり（選んだコースの期間ごとに同じ条件で自動更新）',
  oneMonth: '1ヵ月コースあり（後払いは1ヵ月コースのみ）。登録完了後のキャンセルは不可で、登録日から1か月分の月額料金が発生。解約は次回の更新日の前日までに申請',
  longTerm: '3・6・12ヵ月コースは月額の割引あり。コース途中で解約すると途中解約金（コース割引前の月額料金1か月分。例：ライト7,980円・レギュラー10,980円）。最終月分の支払い後に解約申請すれば途中解約金なし。自動更新後に途中解約すると再び発生',
  returnDeadline: '通常は返却期限なし（延滞料なし）。解約するときは申請日から7日以内に倉庫必着で返却し、返却が確認されると解約が確定',
  cancel: '会員情報ページ・アプリからいつでも申請。一時停止（休会）機能はなし',
  sizes: 'XS〜3Lまで対応と案内（レギュラーのヘルプでは選べるサイズはXS〜Lの4サイズと記載。プランにより異なるため要確認）。身長146〜174cmに対応',
  damage: '通常の使用による汚れ・微細な傷は費用なし（当社でメンテナンス）。修繕が必要な汚れ・破損は修繕費用など（補償案内に例：シミ660円/1着、ほつれ275円/1か所）、修繕できない破損や紛失・盗難は弁償金がかかります。補償案内と月額会員規約で記載が異なる部分があり、実際の負担は規約と適用条件によって異なるため、公式の補償案内と規約を確認してください',
  damageLinks: [
    { label: '補償について（公式）', url: 'https://www.air-closet.com/compensation/' },
    { label: '月額会員規約（第10条）', url: 'https://www.air-closet.com/member-agreement/monthly/' },
  ],
  availability: '会員規約で、すべての会員に合う在庫を保証するものではなく、カラー・サイズなど一定の条件の商品のレンタルを一時的に停止する場合があると案内。リクエストはできるが、その服が届くとは限らない',
  purchase: '購入できる（ウェブサイトに掲載の金額。返却前に購入）。購入時の送料550円（税込）。購入後の返品・返金は不可',
  cautionSummary: [
    '選んだコースの期間ごとに自動更新。登録完了後のキャンセルは不可',
    '配送料330円（税込）/配送（沖縄県は990円）。交換でお届けするたびにかかる',
    '3・6・12ヵ月コースを途中で解約すると途中解約金（割引前の月額料金1か月分）',
    '解約するときは申請日から7日以内に倉庫必着で返却',
    '修繕が必要な汚れ・破損は修繕費用など、修繕できない破損・紛失・盗難は弁償金',
  ],
  extraCosts: [
    '配送料：330円（税込）/配送（沖縄県は990円）。交換するたびにかかります',
    'オプション：スタイリスト指名550円/回、アクセサリー1,100円/回、ブランドセレクト（ブランドにより異なる）など',
    '購入する場合の代金と送料550円（税込）',
    '修繕が必要な汚れ・破損の修繕費用、修繕できない破損・紛失の弁償金',
    '3・6・12ヵ月コースを途中で解約する場合の途中解約金',
  ],
  notes: [
    '月額料金は、その月にレンタルしたかどうかにかかわらず発生します',
    '登録完了後のキャンセルはできません',
  ],
  sources: [
    { label: 'トップページ', url: 'https://www.air-closet.com/' },
    { label: '補償について', url: 'https://www.air-closet.com/compensation/' },
    { label: '特定商取引法に基づく表記', url: 'https://www.air-closet.com/trade/' },
    { label: '月額会員規約', url: 'https://www.air-closet.com/member-agreement/monthly/' },
    { label: 'よくあるご質問', url: 'https://help.air-closet.com/ja' },
  ],
};

export const FASHION_SERVICES: FashionService[] = [MECHAKARI, AIRCLOSET];

/** 目的で絞り込む（公式サイトに明記・一部明記のサービス）。空なら全件 */
export function servicesForPurpose(purpose: FashionPurposeId | '', services: readonly FashionService[] = FASHION_SERVICES): FashionService[] {
  if (!purpose) return [...services];
  return services.filter((s) => s.purposes[purpose] !== undefined);
}

export function isFashionPurposeId(v: unknown): v is FashionPurposeId {
  return typeof v === 'string' && FASHION_PURPOSES.some((p) => p.id === v);
}
