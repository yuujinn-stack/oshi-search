// 推し活グッズ買取サービス比較（/oshikatsu/goods-buyback）の掲載内容と、グループ・グッズ種類での絞り込み（純粋関数）。
//
// 掲載ルール:
// - 各社の公式サイトで確認できた内容だけを書く（確認日は BUYBACK_CHECKED_AT）。確認できない項目は「要確認」。
// - 買取対象グループは、公式サイトにグループ名・アーティスト名が明記されているものだけ（groups）。
//   「ジャニーズ」「K-POP」「アイドル」などのジャンル表記（genreNotes）からは、個別のグループを推測して対象にしない。
// - 表示名は公式サイトの表記のまま。略称・誤字と思われる表記も、公式サイトに正式名称の記載がない限り別のグループ名に変換しない
//   （例: 買取王子の「乃木坂」「AKB」は公式サイトに正式名称の記載がないため、そのまま掲載）。
// - 検索用の別名（searchAliases）は、運営者が明示的に指定したものだけ（現在は買取王子の 乃木坂→乃木坂46・櫻坂→櫻坂46・
//   日向坂→日向坂46・AKB→AKB48 の4件）。表示・保存は公式表記のまま、絞り込みの照合にだけ使う。ほかの略称・誤字には自動で適用しない。
//   公式サイト内で正式名称と補足が並んでいる場合だけ、補足を official・note に分ける（例: JUSTY「超特急(EBiDAN)」→ 超特急）。
// - グループによって査定対象のグッズが限られる場合は goodsOnly に書く（例: 推しトクの嵐は DVD・Blu-ray のみ）。
// - 買取価格が高い・高く売れるといった表現は書かない。
// - 広告リンクは管理画面（/admin/affiliates?tab=oshikatsu、ジャンル「グッズ買取」）で管理する。ここには書かない。
//
// サービスを追加・削除するときは BUYBACK_SERVICES を編集し、
// src/lib/oshikatsu-affiliate/constants.ts の OSHIKATSU_PAGE_SERVICE_KEYS.goods_buyback も合わせる。

export const GOODS_BUYBACK_PATH = '/oshikatsu/goods-buyback';

/** 各社の公式サイトを確認した日 */
export const BUYBACK_CHECKED_AT = '2026年11月6日';

export const NEEDS_CHECK = '要確認';

export type BuybackServiceId = 'kaitori_ouji' | 'justy' | 'oshitoku' | 'surugaya';

export type BuybackGoodsTypeId =
  | 'uchiwa' | 'penlight' | 'acrylic' | 'keyholder' | 'can_badge' | 'photo' | 'dvd' | 'cd'
  | 'photobook' | 'towel' | 'apparel' | 'plush' | 'pamphlet' | 'poster' | 'calendar';

export const BUYBACK_GOODS_TYPES: { id: BuybackGoodsTypeId; label: string }[] = [
  { id: 'uchiwa', label: 'うちわ' },
  { id: 'penlight', label: 'ペンライト' },
  { id: 'acrylic', label: 'アクリルグッズ' },
  { id: 'keyholder', label: 'キーホルダー・ストラップ' },
  { id: 'can_badge', label: '缶バッジ' },
  { id: 'photo', label: '生写真・チェキ・トレカ' },
  { id: 'dvd', label: 'DVD・Blu-ray' },
  { id: 'cd', label: 'CD' },
  { id: 'photobook', label: '写真集' },
  { id: 'towel', label: 'タオル' },
  { id: 'apparel', label: 'Tシャツなどの衣類' },
  { id: 'plush', label: 'ぬいぐるみ' },
  { id: 'pamphlet', label: 'パンフレット・会報' },
  { id: 'poster', label: 'ポスター・タペストリー' },
  { id: 'calendar', label: 'カレンダー' },
];

/** yes: 公式サイトに買取対象として明記 / conditional: 条件つきで明記 / excluded: 買取できないと明記。未記載はキーなし（＝明記なし） */
export type BuybackGoodsStatus = { status: 'yes' | 'conditional' | 'excluded'; note?: string };

export interface BuybackGroup {
  /** 表示名（絞り込みのキー） */
  name: string;
  /** 公式サイトの表記が表示名と違う場合の公式表記 */
  official?: string;
  /** 公式サイトに書かれている条件など */
  note?: string;
  /** このグループで査定対象になるグッズが限られている場合の種類（未指定はサービス全体のグッズ条件に従う） */
  goodsOnly?: BuybackGoodsTypeId[];
  /**
   * 推しサーチ内部の検索用別名（運営者が明示的に指定したものだけ）。照合と絞り込みの選択肢にだけ使い、表示する公式表記（name）は変えない。
   * 例: 買取王子の公式表記「乃木坂」→ 別名「乃木坂46」
   */
  searchAliases?: string[];
}

export interface BuybackService {
  id: BuybackServiceId;
  name: string;
  /** 運営会社（公式サイトで確認できたもののみ） */
  operator: string | null;
  /** 公式サイト。確認できないサービスは null（リンクを出さない） */
  officialUrl: string | null;
  mark: string;
  summary: string;
  groups: BuybackGroup[];
  /** グループ名ではないジャンル表記（公式サイトの記載どおり。絞り込みには使わない） */
  genreNotes: string[];
  goods: Partial<Record<BuybackGoodsTypeId, BuybackGoodsStatus>>;
  excluded: string[];
  mailIn: string;
  shipping: string;
  appraisalFee: string;
  cancel: string;
  returnShipping: string;
  payment: string;
  notes: string[];
  sources: { label: string; url: string }[];
}

const YES: BuybackGoodsStatus = { status: 'yes' };

// ── 買取王子（https://www.kaitoriouji.jp/） ──────────────────────────────────────
const KAITORI_OUJI: BuybackService = {
  id: 'kaitori_ouji',
  name: '買取王子',
  operator: '株式会社ティーバイティー',
  officialUrl: 'https://www.kaitoriouji.jp/item/idolgoods/',
  mark: '王',
  summary: 'アーティスト・アイドルグッズの宅配買取。買取箱の取り寄せと佐川急便の集荷に対応し、査定に納得できない場合の返送料も無料と案内されています。',
  groups: [
    // 公式サイトの表記のまま保存・表示する。検索用の別名は運営者の指定による（この4件だけ）
    { name: '乃木坂', searchAliases: ['乃木坂46'] },
    { name: '櫻坂', searchAliases: ['櫻坂46'] },
    { name: '日向坂', searchAliases: ['日向坂46'] },
    { name: 'AKB', searchAliases: ['AKB48'] },
    { name: 'モーニング娘。' },
    { name: 'ハロプロ' },
    { name: 'さくら学園', note: '公式サイトの表記のまま掲載' },
    { name: 'アンジェルム', note: '公式サイトの表記のまま掲載' },
    { name: 'BABYMETAL' },
    { name: 'BTS' },
    { name: '氷室京介' },
    { name: 'Bz', note: '公式サイトの表記のまま掲載' },
    { name: 'エレファントカシマシ' },
    { name: '長渕剛' },
    { name: 'X-JAPAN' },
    { name: '吉井和哉' },
    { name: 'イエモン', note: '公式サイトの表記のまま掲載' },
    { name: '米津玄師' },
  ],
  genreNotes: ['ジャニーズ', '宝塚', 'K-POP', '韓国アイドル', '上記に掲載の無いアイドル・アーティスト', '脱退、引退したメンバーのグッズ'],
  goods: {
    uchiwa: YES,
    penlight: YES,
    acrylic: YES,
    keyholder: YES,
    can_badge: YES,
    photo: { status: 'yes', note: '生写真' },
    dvd: YES,
    cd: { status: 'conditional', note: '同一のCD・DVD・Blu-rayは買取不可' },
    photobook: YES,
    towel: { status: 'conditional', note: '開封済みの布製品は買取不可' },
    apparel: { status: 'conditional', note: '開封済みの布製品は買取不可' },
    poster: { status: 'excluded' },
  },
  excluded: [
    '同一のCD・DVD・Blu-ray・書籍',
    '開封済みの布製品',
    '自作やコピー品などの公式ではないもの',
    'ポスターやチラシ、フライヤー、切り抜き',
    '汚れなどがあり再販売が難しいもの',
    '同一アイテム（タイトル）の3点以上（法人を除く）',
  ],
  mailIn: '対応（買取箱を無料で取り寄せ可。初回は佐川急便の集荷が必須）',
  shipping: '無料（箱数や査定金額を問わず買取王子が負担。着払いで発送）。1回のご利用は2箱まで',
  appraisalFee: '無料',
  cancel: '査定金額に承諾する前ならキャンセル可（返却は送った商品すべて。一部だけの返却は不可）。承諾後・「自動承認」を選んだ場合はキャンセル不可',
  returnShipping: '無料（買取できない品物は送料お客様負担で返送される場合あり）',
  payment: '銀行振込（翌日〜2営業日程度）・Amazonギフトカード・選べるe-GIFT・買取王子ポイント。初回は本人確認のため銀行振込のみ',
  notes: [
    '18歳未満は利用できません',
    '本人確認書類が必要です（初回は身分証に記載の住所からのみ利用可）',
    '査定金額の提示から7日以内に回答がない場合は承諾したものとみなされます',
    '値段が付かなかった品物は返送されず、買取王子での引き取りになります',
  ],
  sources: [
    { label: 'アーティスト・アイドルグッズ買取', url: 'https://www.kaitoriouji.jp/item/idolgoods/' },
    { label: 'よくあるご質問', url: 'https://www.kaitoriouji.jp/faq/' },
    { label: 'ご利用の流れ', url: 'https://www.kaitoriouji.jp/flow/' },
    { label: '特定商取引法に基づく表記', url: 'https://www.kaitoriouji.jp/tokusho/' },
  ],
};

// ── JUSTY（https://justy-consul.com/idols/） ─────────────────────────────────────
const JUSTY_LOW_PRICE = '公式サイトで「価格が付きにくいグループ」として掲載（買取は行っている）';
const JUSTY: BuybackService = {
  id: 'justy',
  name: 'JUSTY',
  operator: '株式会社JUSTY',
  officialUrl: 'https://justy-consul.com/idols/',
  mark: 'J',
  summary: 'アイドル・アーティストグッズの宅配買取。梱包キット・査定料・当社宛送料は無料と案内されています。キャンセル時の返送料はお客様負担です。',
  groups: [
    // 公式サイト「買取強化グループ」（アイドル系）
    { name: '乃木坂46', official: '乃木坂46 (5期生・6期生)', note: '買取強化グループとして5期生・6期生を掲載' },
    { name: '櫻坂46' },
    { name: 'さくら学院' },
    { name: 'FRUITS ZIPPER' },
    { name: 'CUTIE STREET' },
    { name: '=LOVE' },
    { name: '超ときめき♡宣伝部' },
    { name: 'iLiFE' },
    { name: '超特急', official: '超特急(EBiDAN)' },
    { name: 'M!LK', official: 'M!LK(EBiDAN)' },
    { name: 'JO1' },
    { name: 'INI' },
    { name: 'Number_i', official: 'number_i' },
    { name: 'IMP.', official: 'IMP.(旧IMPACTors)' },
    { name: 'なにわ男子' },
    { name: 'SixTONES' },
    { name: 'Snow Man' },
    { name: 'King & Prince', official: 'King & Prince(2人体制以降)', note: '買取強化は2人体制以降。5人体制のグッズは「価格が付きにくいグループ」として掲載' },
    { name: 'SEVENTEEN' },
    { name: 'BTS', official: '防弾少年団（BTS）' },
    { name: 'TWICE' },
    { name: 'イ・ジュンギ' },
    { name: '2PM ジュノ' },
    { name: 'Stray Kids' },
    { name: 'BIGBANG' },
    { name: '嵐' },
    { name: 'Aぇ! group' },
    { name: 'timelesz', official: 'timelesz(旧Sexy Zone)' },
    { name: 'Travis Japan' },
    // アーティスト系
    { name: 'THE YELLOW MONKEY' },
    { name: 'エレファントカシマシ' },
    { name: '斉藤和義' },
    { name: 'スピッツ' },
    { name: '椎名林檎' },
    { name: 'Mrs. GREEN APPLE' },
    { name: 'Official髭男dism' },
    { name: 'BABYMETAL', official: 'BABY METAL' },
    { name: 'Eve' },
    { name: 'あいみょん' },
    { name: 'BUCK-TICK' },
    { name: 'Ado', official: 'ado' },
    { name: 'MISIA' },
    { name: '米津玄師' },
    { name: 'ずっと真夜中でいいのに。' },
    { name: 'MAN WITH A MISSION' },
    // 「その他グッズの買取もお任せください！」
    { name: '日向坂46' },
    { name: 'ハロプロ', note: '10年以上昔のグッズは買取不可' },
    { name: 'アンジュルム' },
    { name: 'NiziU' },
    { name: 'ME:I' },
    { name: 'back number' },
    { name: 'WANIMA' },
    { name: 'Perfume' },
    { name: 'ONE OK ROCK' },
    { name: "L'Arc〜en〜Ciel" },
    { name: '原因は自分にある。' },
    { name: 'ハク。' },
    { name: 'VINII' },
    { name: 'MilMoon' },
    { name: 'Aooo' },
    { name: 'レトロリロン' },
    { name: 'ziproom' },
    { name: 'ブランデー戦記' },
    { name: 'Saucy Dog' },
    { name: 'Juice=Juice' },
    { name: 'ZOC' },
    { name: 'BEYOOOOONDS' },
    { name: 'つばきファクトリー' },
    { name: 'DOMOTO', official: 'DOMOTO（旧KinKi Kids）' },
    { name: 'B&ZAI', official: 'B＆ZAI' },
    { name: 'Ambitious' },
    { name: 'Boys be' },
    { name: 'CLASS SEVEN' },
    { name: 'ISSEI' },
    { name: 'wink first' },
    { name: 'n.SSign' },
    { name: 'カグラナナ' },
    { name: '輝夜月' },
    { name: 'ミライアカリ' },
    { name: 'てきと' },
    { name: 'こんじゅりチャ' },
    { name: 'ICEx', official: 'ICEx(EBiDAN)' },
    { name: "ONE N' ONLY", official: "ONE N' ONLY(EBiDAN)" },
    { name: 'BE:FIRST' },
    { name: 'MAZZEL' },
    { name: 'CORTIS' },
    { name: 'BABYMONSTER' },
    { name: 'Hearts2Hearts' },
    { name: 'ALPHA DRIVE ONE' },
    { name: 'NCT WISH' },
    { name: 'RIIZE' },
    { name: 'XG' },
    { name: 'ACEes' },
    { name: 'KEY TO LIT' },
    // 「価格が付きにくいグループ一覧」（買取対象。価格が付きにくいと公式に案内）
    { name: 'ももいろクローバーZ', note: `${JUSTY_LOW_PRICE}。元メンバー有安さんのグッズは買取不可` },
    { name: 'モーニング娘。', official: 'モーニング娘。(2017年以前)', note: `2017年以前のグッズは${JUSTY_LOW_PRICE}。10年以上昔のグッズは買取不可` },
    { name: 'AKB48', official: 'AKB48 (2020年以前)', note: `2020年以前のグッズは${JUSTY_LOW_PRICE}` },
    { name: 'たこやきレインボー', note: JUSTY_LOW_PRICE },
    { name: '私立恵比寿中学', note: JUSTY_LOW_PRICE },
    { name: '欅坂46', note: JUSTY_LOW_PRICE },
    { name: 'いぎなり東北産', note: JUSTY_LOW_PRICE },
    { name: 'EXILE', note: JUSTY_LOW_PRICE },
    { name: '三代目JSB', note: JUSTY_LOW_PRICE },
    { name: 'GENERATIONS', note: JUSTY_LOW_PRICE },
    { name: 'E-girls', note: JUSTY_LOW_PRICE },
    { name: 'AAA', note: JUSTY_LOW_PRICE },
    { name: 'UVERworld', note: JUSTY_LOW_PRICE },
    { name: 'Winds', note: JUSTY_LOW_PRICE },
    { name: 'ゴールデンボンバー', note: JUSTY_LOW_PRICE },
    { name: 'ゆず', note: JUSTY_LOW_PRICE },
    { name: '遊助', note: JUSTY_LOW_PRICE },
    { name: '東方神起', note: JUSTY_LOW_PRICE },
    { name: 'SUPERNOVA', official: 'SUPERNOVA(超新星)', note: JUSTY_LOW_PRICE },
    { name: 'GOT7', note: JUSTY_LOW_PRICE },
    { name: 'WINNER', note: JUSTY_LOW_PRICE },
    { name: 'iKON', note: JUSTY_LOW_PRICE },
    { name: 'WANA-ONE', note: JUSTY_LOW_PRICE },
    { name: 'JYJ', note: JUSTY_LOW_PRICE },
    { name: 'SUPER EIGHT', official: '関ジャニ∞ SUPER EIGHT', note: JUSTY_LOW_PRICE },
    { name: 'KAT-TUN', note: JUSTY_LOW_PRICE },
    { name: 'NEWS', official: 'NEWS(6人体制以前)', note: `6人体制以前のグッズは${JUSTY_LOW_PRICE}` },
    { name: 'Kis-My-Ft2', note: JUSTY_LOW_PRICE },
    { name: 'A.B.C-Z', note: JUSTY_LOW_PRICE },
    { name: 'WEST.', official: 'WEST.(旧ジャニーズWEST)', note: JUSTY_LOW_PRICE },
    { name: 'でんぱ組.inc', note: JUSTY_LOW_PRICE },
  ],
  genreNotes: ['STARTO ENTERTAINMENT（旧ジャニーズ）各種', 'Jr.(ジュニア)グループ各種', 'TRAINEE各種', '韓流グッズ', 'TOBEグッズ', '2.5次元グッズ', '声優グッズ', 'Vtuberグッズ', '上記以外のグループ・アーティストのグッズ（問い合わせ）'],
  goods: {
    uchiwa: YES,
    penlight: YES,
    acrylic: { status: 'yes', note: 'アクリルスタンド・アクリルフォトパネル' },
    keyholder: { status: 'yes', note: 'マスコットキーホルダー' },
    photo: { status: 'yes', note: '生写真・チェキ' },
    dvd: YES,
    cd: { status: 'conditional', note: '同一タイトルのCDは査定対象外' },
    photobook: YES,
    towel: YES,
    apparel: { status: 'yes', note: 'Tシャツ・ジャージ' },
    plush: YES,
    poster: { status: 'excluded' },
    calendar: { status: 'conditional', note: '今年度・来年度のもののみ' },
  },
  excluded: [
    '盗品・偽物・著しい汚れや破損が目立つもの',
    'ガス・スプレー缶',
    '雑誌・雑誌の切り抜き・ポスター・VHS',
    '非公式グッズ',
    '同一タイトルのCD',
    'ハロプロ・モーニング娘。の10年以上昔のグッズ',
    'PSEマークのないモバイルバッテリー',
  ],
  mailIn: '対応（全国。無料の梱包キットあり。佐川急便の集荷あり）',
  shipping: '無料（JUSTY指定の配送業者で着払い。ほかの配送業者を使う場合はお客様負担）',
  appraisalFee: '無料（梱包キット・査定料・当社宛送料・手数料は無料と案内）',
  cancel: '成約前ならキャンセル可（電話のみ。商品確認日から20日を過ぎると不可）。「連絡不要（そのまま振り込み）」を選んだ場合はキャンセル不可',
  returnShipping: 'お客様負担（着払い）',
  payment: '銀行振込（振込手数料無料。最短当日。当日振込の締め時刻は公式サイト内で記載が異なるため要確認）',
  notes: [
    '18歳未満は保護者の同意と保護者の身分証明書が必要です',
    '本人確認書類が必要です（身分証の住所は申込住所・発送元住所と同じであること）',
    '梱包キットの到着から2週間以内の返送が案内されています',
    '査定商品確認日から20日間が保管期間です',
  ],
  sources: [
    { label: 'アイドル・アーティストグッズ', url: 'https://justy-consul.com/idols/' },
    { label: '宅配買取', url: 'https://justy-consul.com/service1/' },
    { label: 'よくある質問', url: 'https://justy-consul.com/qa/' },
  ],
};

// ── 推しトク（https://kaitori-janiyard.jp/idol） ──────────────────────────────────
const OSHITOKU_STARTO_DVD = 'DVD・Blu-rayのみ査定対象（公式サイトの「DVD・Blu-rayのみ査定可能なグループ」）';
const OSHITOKU_STARTO_ALL = 'STARTO系でDVD・Blu-ray以外のグッズも査定対象になる4グループの1つ';
const OSHITOKU_VTUBER = '現在活動中のアーティストのみ査定・買取対象';
const OSHITOKU: BuybackService = {
  id: 'oshitoku',
  name: '推しトク',
  // 公式サイトに運営会社名の記載を確認できず（「推しトクを含むヤマトクグループ」の記載のみ）
  operator: null,
  officialUrl: 'https://kaitori-janiyard.jp/idol',
  mark: '推',
  summary: 'アイドルグッズの宅配買取（旧：ジャニヤード）。STARTO系は、グループによって査定対象がDVD・Blu-rayに限られます。宅配キット・送料・振込手数料は無料と案内されています。',
  groups: [
    // STARTO系：DVD・Blu-ray以外も査定対象の4グループ（/idol/starto）
    { name: 'Snow Man', note: OSHITOKU_STARTO_ALL },
    { name: 'SixTONES', note: OSHITOKU_STARTO_ALL },
    { name: 'なにわ男子', note: OSHITOKU_STARTO_ALL },
    { name: 'Aぇ! group', note: OSHITOKU_STARTO_ALL },
    // STARTO系：DVD・Blu-rayのみ査定可能なグループ（/idol/starto）
    { name: '嵐', note: OSHITOKU_STARTO_DVD, goodsOnly: ['dvd'] },
    { name: 'Travis Japan', note: OSHITOKU_STARTO_DVD, goodsOnly: ['dvd'] },
    { name: 'timelesz', note: OSHITOKU_STARTO_DVD, goodsOnly: ['dvd'] },
    { name: 'SUPER EIGHT', note: OSHITOKU_STARTO_DVD, goodsOnly: ['dvd'] },
    { name: 'Hey! Say! JUMP', note: OSHITOKU_STARTO_DVD, goodsOnly: ['dvd'] },
    { name: 'Kis-My-Ft2', note: OSHITOKU_STARTO_DVD, goodsOnly: ['dvd'] },
    { name: 'WEST.', note: OSHITOKU_STARTO_DVD, goodsOnly: ['dvd'] },
    { name: 'A.B.C-Z', note: OSHITOKU_STARTO_DVD, goodsOnly: ['dvd'] },
    { name: 'King & Prince', note: OSHITOKU_STARTO_DVD, goodsOnly: ['dvd'] },
    // K-POP（/idol）
    { name: 'BTS' },
    { name: 'TWICE' },
    { name: 'Stray Kids' },
    { name: 'ENHYPEN' },
    { name: 'TOMORROW X TOGETHER' },
    { name: 'RIIZE' },
    { name: 'aespa' },
    { name: 'IVE' },
    { name: 'NiziU' },
    { name: 'SEVENTEEN' },
    { name: 'NCT WISH', note: 'NCT WISH以外のNCTグッズは査定対象外' },
    // VTuber（/idol・/faq。公式サイトでは「など」と記載）
    { name: '宝鐘マリン', note: `ホロライブ。${OSHITOKU_VTUBER}` },
    { name: '星街すいせい', note: `ホロライブ。${OSHITOKU_VTUBER}` },
    { name: '兎田ぺこら', note: `ホロライブ。${OSHITOKU_VTUBER}` },
    { name: '白上フブキ', note: `ホロライブ。${OSHITOKU_VTUBER}` },
    { name: '常闇トワ', note: `ホロライブ。${OSHITOKU_VTUBER}` },
    { name: '葛葉', note: `にじさんじ。${OSHITOKU_VTUBER}` },
    { name: '叶', note: `にじさんじ。${OSHITOKU_VTUBER}` },
    { name: '不破湊', note: `にじさんじ。${OSHITOKU_VTUBER}` },
    { name: '加賀美ハヤト', note: `にじさんじ。${OSHITOKU_VTUBER}` },
    { name: '甲斐田晴', note: `にじさんじ。${OSHITOKU_VTUBER}` },
    // その他の対象グループ（/idol・/faq。個別の条件は記載なし）
    { name: 'JO1', note: 'LAPONEエンタテインメント' },
    { name: 'INI', note: 'LAPONEエンタテインメント' },
    { name: 'M!LK', note: 'スターダストプロモーション（EBiDAN）。その他の対象グループとして掲載（個別の条件の記載なし）' },
    { name: '超特急', note: 'スターダストプロモーション（EBiDAN）。その他の対象グループとして掲載（個別の条件の記載なし）' },
    { name: 'SUPER★DRAGON', note: 'スターダストプロモーション（EBiDAN）' },
    { name: 'DISH//', note: 'スターダストプロモーション（EBiDAN）' },
    { name: 'さくらしめじ', note: 'スターダストプロモーション（EBiDAN）' },
    { name: "ONE N' ONLY", note: 'スターダストプロモーション（EBiDAN）' },
    { name: '原因は自分にある。', note: 'スターダストプロモーション（EBiDAN）' },
    { name: 'BUDDiiS', note: 'スターダストプロモーション（EBiDAN）' },
    { name: 'ICEx', note: 'スターダストプロモーション（EBiDAN）' },
    { name: 'Lienel', note: 'スターダストプロモーション（EBiDAN）' },
    { name: 'BE:FIRST', note: 'BMSG' },
    { name: 'HANA', note: 'BMSG' },
    { name: 'MAZZEL', note: 'BMSG' },
    { name: 'STARGLOW', note: 'BMSG' },
    { name: 'ふみの', note: 'BMSG' },
    { name: 'SKY-HI', note: 'BMSG' },
    { name: 'Novel Core', note: 'BMSG' },
    { name: 'Aile The Shota', note: 'BMSG' },
    { name: 'edhiii boi', note: 'BMSG' },
    { name: 'REIKO', note: 'BMSG' },
    { name: 'Ayumu Imazu', note: 'BMSG' },
    { name: 'BMSG POSSE', note: 'BMSG' },
    { name: 'TRAINEE', note: 'BMSG（公式サイトの表記のまま掲載）' },
    { name: 'モナキ', note: 'G-STAR.PRO' },
  ],
  genreNotes: [
    'DVD・Blu-rayは、グループを問わず査定可能（TOBE所属グループ・退所メンバーも対象）',
    'K-POPの公式トレカは、グループを問わず査定可能',
    'ホロライブ・にじさんじなどのVTuber（現在活動中のアーティストのみ）',
  ],
  // STARTO系ページ（/idol/starto）の「査定対象グッズ」。上の4グループ以外のSTARTO系は DVD・Blu-ray のみ（goodsOnly）
  goods: {
    dvd: YES,
    cd: { status: 'conditional', note: '未開封のみ（開封されたCDは買取停止）' },
    photo: { status: 'yes', note: '公式写真・トレカ' },
    uchiwa: YES,
    penlight: { status: 'yes', note: '電池がついた状態で送る' },
    acrylic: { status: 'yes', note: 'アクリルスタンド' },
    plush: YES,
    apparel: { status: 'conditional', note: 'パーカー・Tシャツ。開封済みは値段を付けるのが難しいと案内' },
    towel: { status: 'conditional', note: 'ブランケット・タオル。開封済みは値段を付けるのが難しいと案内' },
    pamphlet: { status: 'yes', note: 'パンフレット' },
  },
  excluded: [
    '非公式グッズ、証明書なしのサイン入りグッズ、「SAMPLE」と記載のあるグッズ、マスク、USBメモリ（値段を付けられない）',
    '開封されたCD、雑誌（買取停止）',
    'ジャニーズを退所したメンバーや退所したジュニアのみのグッズ・写真',
    'NCT WISH以外のNCTグッズ',
    'カレンダー・ポスター・脱退したメンバーが含まれるグッズ・開封済みのタオルやTシャツは「値段を付けるのが難しいグッズ」と案内',
  ],
  mailIn: '対応（無料の宅配キットあり。手持ちの箱でも可。沖縄・離島はゆうパック着払いで発送）',
  shipping: '無料（送料は推しトクが負担と案内）',
  appraisalFee: '査定料の記載は要確認（宅配キット料・送料・振込手数料などの費用は一切なしと案内）',
  cancel: '申込後・発送前のキャンセル条件は要確認。買取に合意した後は振込前でも返却不可。「自動承諾」を選ぶと査定後すぐに振込',
  returnShipping: '査定結果に納得できず返却を希望する場合の送料は推しトクが負担（一部のみの返却は不可）',
  payment: '銀行振込（振込手数料無料）。査定から振込まで通常1週間程度',
  notes: [
    '18歳未満は、金額にかかわらず保護者買取同意書と本人確認書類が必要です',
    '本人確認書類はマイナンバーカード・運転免許証・在留カードのみと案内されています',
    '品物の到着から30日経っても連絡が取れない場合は処分されます',
  ],
  sources: [
    { label: 'アイドルグッズ買取', url: 'https://kaitori-janiyard.jp/idol' },
    { label: 'STARTO（旧ジャニーズ）グッズ買取', url: 'https://kaitori-janiyard.jp/idol/starto' },
    { label: 'ご利用ガイド', url: 'https://kaitori-janiyard.jp/guide' },
    { label: 'よくある質問', url: 'https://kaitori-janiyard.jp/faq' },
    { label: '送料について', url: 'https://kaitori-janiyard.jp/faq/send/19.html' },
    { label: '返却時の送料', url: 'https://kaitori-janiyard.jp/faq/return/02.html' },
  ],
};

// ── 駿河屋（https://www.suruga-ya.jp/） ──────────────────────────────────────────
const SURUGAYA: BuybackService = {
  id: 'surugaya',
  name: '駿河屋',
  operator: null,
  officialUrl: 'https://www.suruga-ya.jp/man/kaitori/kantan.html',
  mark: '駿',
  summary: '商品を箱に詰めて送る「かんたん買取」。30点以上は送料無料で、別途、通信買取手数料（銀行振込660円・現金書留880円）がかかると案内されています。',
  groups: [],
  genreNotes: ['アイドル', 'ジャニーズ', '2.5次元', '声優', 'アーテイスト（公式表記のまま）', 'タレント', '男性アイドルグッズ'],
  goods: {
    uchiwa: { status: 'yes', note: 'ライブ・コンサート・舞台などの会場限定グッズ' },
    keyholder: { status: 'yes', note: 'ストラップ・キーホルダー・ピンズ・小物類' },
    photo: { status: 'yes', note: '生写真・チェキ・アイドルトレカ' },
    dvd: { status: 'yes', note: '映像ソフト' },
    photobook: YES,
    towel: YES,
    apparel: { status: 'yes', note: '衣類・会場限定のTシャツ' },
    pamphlet: { status: 'yes', note: '会報誌・会場限定のパンフレット' },
    poster: YES,
    calendar: YES,
  },
  excluded: [
    '盗品・海賊版など違法性のあるもの',
    'カビ・水濡れのあるもの',
    '個人を特定できる個人情報を含むもの',
    'キャラクター性のない雑貨・日用品・一般衣類・紙袋',
    '個人情報の入っているカード、雑誌の付録の切り離して使うカード',
  ],
  mailIn: '対応（かんたん買取。ゆうパックで発送）',
  shipping: '30点以上はゆうパック着払いで無料。30点未満は元払い（お客様負担）。1箱あたりの買取金額が1,500円未満の場合は別途送料を請求される場合あり',
  appraisalFee: '査定料の記載は要確認。通信買取手数料が別途必要（銀行振込660円・現金書留880円）',
  cancel: '買取価格に承諾する前ならキャンセル可。承諾後・自動承諾は不可。一部商品だけのキャンセルは不可。査定価格の連絡から5日以内に承諾しないと承諾したものとみなされる',
  returnShipping: 'お客様負担',
  payment: '銀行振込（承諾確認後、金融機関の3営業日以内）または現金書留。買取額が5万円を超える場合は現金書留不可',
  notes: [
    '本人確認書類が必要です（初回は転送不要の簡易書留はがきが届きます）',
    '申込から20日以内に荷物が届かない場合、申込は無効になります',
    '荷物が10箱以上、またはトレカ・生写真・チェキが合計3,000枚以上の場合は発送前に相談が必要です',
  ],
  sources: [
    { label: 'かんたん買取', url: 'https://www.suruga-ya.jp/man/kaitori/kantan.html' },
    { label: '買取Q&A', url: 'https://www.suruga-ya.jp/man/kaitoriqa/kaitoriqa.html' },
    { label: '買取可能品・買取不可品', url: 'https://www.suruga-ya.jp/man/hyou/hukahin.html' },
    { label: '男性アイドルグッズ 買取強化タイトル', url: 'https://www.suruga-ya.jp/feature/kaitori_tokushu/idol_goods.html' },
  ],
};

export const BUYBACK_SERVICES: BuybackService[] = [KAITORI_OUJI, JUSTY, OSHITOKU, SURUGAYA];

// ── 絞り込み（純粋関数） ─────────────────────────────────────────────────────────

/** グループ名の比較用キー（全角半角・大文字小文字・空白の違いだけを吸収する。別名の推測はしない） */
export function groupKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function groupMatches(g: BuybackGroup, key: string): boolean {
  return groupKey(g.name) === key
    || (g.official !== undefined && groupKey(g.official) === key)
    || (g.searchAliases ?? []).some((a) => groupKey(a) === key);
}

/** 絞り込みの選択肢に出す名前（検索用の別名があればそれ。例: 買取王子「乃木坂」→ 選択肢「乃木坂46」） */
function optionName(g: BuybackGroup): string {
  return g.searchAliases?.[0] ?? g.name;
}

/** そのグループを公式サイトに明記しているサービスと、該当の記載 */
export function servicesForGroup(groupName: string, services: readonly BuybackService[] = BUYBACK_SERVICES): { service: BuybackService; group: BuybackGroup }[] {
  const key = groupKey(groupName);
  if (!key) return [];
  const out: { service: BuybackService; group: BuybackGroup }[] = [];
  for (const s of services) {
    const g = s.groups.find((x) => groupMatches(x, key));
    if (g) out.push({ service: s, group: g });
  }
  return out;
}

/** 絞り込みの選択肢：どこかのサービスが明記しているグループ名（表示名で重複なし・五十音/アルファベット順） */
export function buybackGroupOptions(services: readonly BuybackService[] = BUYBACK_SERVICES): string[] {
  const byKey = new Map<string, string>();
  for (const s of services) {
    for (const g of s.groups) {
      const n = optionName(g);
      if (!byKey.has(groupKey(n))) byKey.set(groupKey(n), n);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'ja'));
}

/**
 * 人物・グループページ用：所属グループのうち、どこかのサービスが明記している（または検索用の別名が一致する）最初のグループ。
 * 返すのは推しサーチ側のグループ名（例: 乃木坂46）。比較ページはこの名前で全サービスを照合する。なければ null
 */
export function findBuybackGroup(groupNames: readonly string[], services: readonly BuybackService[] = BUYBACK_SERVICES): string | null {
  for (const n of groupNames) {
    if (servicesForGroup(n, services).length > 0) return n;
  }
  return null;
}

/**
 * グループとグッズ種類の両方で絞り込む。グループの goodsOnly（例: DVD・Blu-rayのみ）がある場合はそれに従う。
 * group・goods のどちらかが空なら、その条件では絞り込まない。
 */
export function filterBuybackServices(group: string, goodsId: BuybackGoodsTypeId | '', services: readonly BuybackService[] = BUYBACK_SERVICES): BuybackService[] {
  const ok = (s: BuybackService, hit: BuybackGroup | undefined) => {
    if (!goodsId) return true;
    if (hit?.goodsOnly) return hit.goodsOnly.includes(goodsId);
    const st = s.goods[goodsId]?.status;
    return st === 'yes' || st === 'conditional';
  };
  if (group) return servicesForGroup(group, services).filter((x) => ok(x.service, x.group)).map((x) => x.service);
  return services.filter((s) => ok(s, undefined));
}

/** グッズ種類で絞り込む（明記ありまたは条件つきで明記のサービス） */
export function servicesForGoods(goodsId: BuybackGoodsTypeId, services: readonly BuybackService[] = BUYBACK_SERVICES): BuybackService[] {
  return services.filter((s) => {
    const st = s.goods[goodsId]?.status;
    return st === 'yes' || st === 'conditional';
  });
}

export function isBuybackGoodsTypeId(v: unknown): v is BuybackGoodsTypeId {
  return typeof v === 'string' && BUYBACK_GOODS_TYPES.some((g) => g.id === v);
}
