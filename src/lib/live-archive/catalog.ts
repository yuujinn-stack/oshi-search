// 過去のライブ映像（ライブDVD・Blu-ray）発掘特集の掲載リスト。純粋なデータ（DB・API 非依存）。
//
// 掲載の方針（誤分類を防ぐため、商品名からの自動判定はしない）:
// - ここに登録した商品だけを掲載する。登録は「公式サイトでライブ本編の収録作品だと確認できた公演」の、
//   既存の商品データ（products・楽天ブックスの DVD 検索で取得済み）にある楽天ブックスの商品番号だけ。
// - 公演名・発売日・収録公演は公式サイト（sourceUrl）で確認した内容だけを書く。確認できない項目は書かない（表示もしない）。
// - 形式（DVD／Blu-ray）・盤（初回盤／通常盤）・枚数は、楽天ブックスの商品名に明記されている内容。
// - 映画・ドラマ・CD の特典映像・舞台（滝沢歌舞伎 等）・ドキュメンタリー中心の作品は登録しない。
// - 先着特典・会場抽選・限定配送パック・初回盤＋通常盤セット等の、楽天ブックスの販売形態違いは登録しない
//   （特典の内容・有無はこの特集では表示しない。同じ公演の重複も防ぐ）。
// - 価格・在庫・画像・アフィリエイトURLは登録しない（既存の商品データの値を表示時に使う）。
//
// 対象グループを増やすときは LIVE_ARCHIVE_GROUPS に追加し、公演を同じ方針で登録する（src/lib/__tests__/live-archive.test.ts が形式を確認する）。

export type LiveFormat = 'DVD' | 'Blu-ray';
export type LiveEdition = '初回盤' | '初回限定盤' | '通常盤';

export interface LiveVariant {
  /** 楽天ブックスの商品番号（books.rakuten.co.jp/rb/<番号>）。商品ID は "dv-<番号>" */
  productNumber: string;
  format: LiveFormat;
  edition: LiveEdition;
  /** 商品名に明記された枚数・同梱物（例: "3枚組" "Photobook付き"）。無ければ省略 */
  spec?: string;
}

export interface LivePerformance {
  /** 特集内の識別子（GA4 のパラメータにも使う。英数字・ハイフン） */
  id: string;
  groupName: string;
  /** 公演名（公式サイトの表記） */
  title: string;
  /** 発売日 YYYY-MM-DD（公式サイトで確認） */
  releaseDate: string;
  /** 収録公演（公式サイトで確認できた場合だけ） */
  recorded?: string;
  /** 確認した公式ページ */
  sourceUrl: string;
  /** 公式ページを確認した日 YYYY-MM-DD */
  checkedAt: string;
  variants: LiveVariant[];
}

export interface LiveArchiveGroup {
  groupName: string;
  /** 公式の映像作品一覧（「すべての作品は公式サイトで」の案内に使う） */
  officialListUrl: string;
}

/** 特集の対象グループ（表示順） */
export const LIVE_ARCHIVE_GROUPS: LiveArchiveGroup[] = [
  { groupName: 'M!LK', officialListUrl: 'https://www.sd-milk.com/discography/dvd' },
  { groupName: 'Snow Man', officialListUrl: 'https://mentrecording.jp/snowman/discography/' },
  { groupName: 'SixTONES', officialListUrl: 'https://www.sixtones.jp/discography/' },
];

const CHECKED = '2026-11-05';

export const LIVE_PERFORMANCES: LivePerformance[] = [
  // ── Snow Man（STARTO ENTERTAINMENT・MENT RECORDING の公式ページ） ──
  {
    id: 'snowman-2021-mania', groupName: 'Snow Man', title: 'Snow Man LIVE TOUR 2021 Mania', releaseDate: '2022-05-04',
    sourceUrl: 'https://starto.jp/s/p/discography/JWBD-63803_6?ima=0548&artist=43', checkedAt: CHECKED,
    variants: [
      { productNumber: '17091151', format: 'Blu-ray', edition: '通常盤' },
      { productNumber: '17091149', format: 'DVD', edition: '通常盤' },
    ],
  },
  {
    id: 'snowman-2022-labo', groupName: 'Snow Man', title: 'Snow Man LIVE TOUR 2022 Labo.', releaseDate: '2023-07-05',
    sourceUrl: 'https://starto.jp/s/p/discography/JWBD-63879_82?ima=0548&artist=43', checkedAt: CHECKED,
    variants: [
      { productNumber: '17519990', format: 'Blu-ray', edition: '初回盤' },
      { productNumber: '17519989', format: 'DVD', edition: '初回盤' },
      { productNumber: '17520097', format: 'Blu-ray', edition: '通常盤' },
      { productNumber: '17520096', format: 'DVD', edition: '通常盤' },
    ],
  },
  {
    id: 'snowman-2023-idome', groupName: 'Snow Man', title: 'Snow Man 1st DOME tour 2023 i DO ME', releaseDate: '2023-12-31',
    sourceUrl: 'https://starto.jp/s/p/discography/JWBD-98601_4?ima=0548&artist=43', checkedAt: CHECKED,
    variants: [
      { productNumber: '17687609', format: 'Blu-ray', edition: '初回盤' },
      { productNumber: '17687608', format: 'DVD', edition: '初回盤' },
      { productNumber: '17687611', format: 'Blu-ray', edition: '通常盤' },
      { productNumber: '17687610', format: 'DVD', edition: '通常盤' },
    ],
  },
  {
    id: 'snowman-2024-rays', groupName: 'Snow Man', title: 'Snow Man Dome Tour 2024 RAYS', releaseDate: '2025-06-25',
    recorded: '東京ドーム公演',
    sourceUrl: 'https://mentrecording.jp/snowman/discography/detail.php?c=&id=1020949', checkedAt: CHECKED,
    variants: [
      { productNumber: '18221363', format: 'Blu-ray', edition: '初回盤', spec: '3枚組' },
      { productNumber: '18221364', format: 'DVD', edition: '初回盤', spec: '3枚組' },
      { productNumber: '18221365', format: 'Blu-ray', edition: '通常盤', spec: '2枚組' },
      { productNumber: '18221366', format: 'DVD', edition: '通常盤', spec: '2枚組' },
    ],
  },
  {
    id: 'snowman-2025-on', groupName: 'Snow Man', title: 'Snow Man Dome Tour 2025-2026 ON', releaseDate: '2026-07-01',
    recorded: '2025年12月26日 東京ドーム公演',
    sourceUrl: 'https://mentrecording.jp/snowman/discography/detail.php?id=1021494', checkedAt: CHECKED,
    variants: [
      { productNumber: '18631649', format: 'Blu-ray', edition: '初回盤', spec: '3枚組' },
      { productNumber: '18631650', format: 'DVD', edition: '初回盤', spec: '3枚組' },
      { productNumber: '18631651', format: 'Blu-ray', edition: '通常盤', spec: '2枚組' },
      { productNumber: '18631652', format: 'DVD', edition: '通常盤', spec: '2枚組' },
    ],
  },

  // ── SixTONES（SixTONES 公式サイト） ──
  {
    id: 'sixtones-2020-trackone-impact', groupName: 'SixTONES', title: 'TrackONE -IMPACT-', releaseDate: '2020-10-14',
    recorded: '2020年1月7日 横浜アリーナ公演',
    sourceUrl: 'https://www.sixtones.jp/discography/d003', checkedAt: CHECKED,
    variants: [
      { productNumber: '16445040', format: 'Blu-ray', edition: '初回盤' },
      { productNumber: '16445042', format: 'DVD', edition: '初回盤' },
      { productNumber: '16445041', format: 'Blu-ray', edition: '通常盤' },
      { productNumber: '16445043', format: 'DVD', edition: '通常盤' },
    ],
  },
  {
    id: 'sixtones-2021-on-est', groupName: 'SixTONES', title: 'on eST', releaseDate: '2021-10-20',
    recorded: '2021年6月7日 横浜アリーナ公演',
    sourceUrl: 'https://www.sixtones.jp/discography/d008', checkedAt: CHECKED,
    variants: [
      { productNumber: '16871136', format: 'Blu-ray', edition: '初回盤' },
      { productNumber: '16871134', format: 'DVD', edition: '初回盤' },
      { productNumber: '16871137', format: 'Blu-ray', edition: '通常盤' },
      { productNumber: '16871135', format: 'DVD', edition: '通常盤' },
    ],
  },
  {
    id: 'sixtones-2022-feel-da-city', groupName: 'SixTONES', title: 'Feel da CITY', releaseDate: '2022-09-28',
    recorded: '2022年1月6日 横浜アリーナ公演',
    sourceUrl: 'https://www.sixtones.jp/discography/d012', checkedAt: CHECKED,
    variants: [
      { productNumber: '17228376', format: 'Blu-ray', edition: '初回盤' },
      { productNumber: '17228374', format: 'DVD', edition: '初回盤' },
      { productNumber: '17228377', format: 'Blu-ray', edition: '通常盤' },
      { productNumber: '17228375', format: 'DVD', edition: '通常盤' },
    ],
  },
  {
    id: 'sixtones-2023-kansei-in-dome', groupName: 'SixTONES', title: '慣声の法則 in DOME', releaseDate: '2023-11-01',
    recorded: '2023年4月23日 東京ドーム公演',
    sourceUrl: 'https://www.sixtones.jp/discography/d018', checkedAt: CHECKED,
    variants: [
      { productNumber: '17639896', format: 'Blu-ray', edition: '初回盤' },
      { productNumber: '17639894', format: 'DVD', edition: '初回盤' },
      { productNumber: '17639897', format: 'Blu-ray', edition: '通常盤' },
      { productNumber: '17639895', format: 'DVD', edition: '通常盤' },
    ],
  },
  {
    id: 'sixtones-2024-vvs', groupName: 'SixTONES', title: 'VVS', releaseDate: '2024-10-16',
    recorded: '2024年4月22日 東京ドーム公演',
    sourceUrl: 'https://www.sixtones.jp/discography/d022', checkedAt: CHECKED,
    variants: [
      { productNumber: '17969299', format: 'Blu-ray', edition: '初回盤' },
      { productNumber: '17969297', format: 'DVD', edition: '初回盤' },
      { productNumber: '17969300', format: 'Blu-ray', edition: '通常盤' },
      { productNumber: '17969298', format: 'DVD', edition: '通常盤' },
    ],
  },
  {
    id: 'sixtones-2025-young-old', groupName: 'SixTONES', title: 'YOUNG OLD', releaseDate: '2025-10-29',
    recorded: '2025年1月27日 東京ドーム公演',
    sourceUrl: 'https://www.sixtones.jp/discography/d027', checkedAt: CHECKED,
    variants: [
      { productNumber: '18377813', format: 'Blu-ray', edition: '初回盤' },
      { productNumber: '18377814', format: 'DVD', edition: '初回盤' },
      { productNumber: '18377649', format: 'Blu-ray', edition: '通常盤' },
      { productNumber: '18377815', format: 'DVD', edition: '通常盤' },
    ],
  },

  // ── M!LK（M!LK 公式サイト） ──
  {
    id: 'milk-2022-next-winner', groupName: 'M!LK', title: 'M!LK LIVE 2022 NEXT WINNER', releaseDate: '2022-07-27',
    recorded: '2022年2月13日公演',
    sourceUrl: 'https://www.sd-milk.com/musics/19790', checkedAt: CHECKED,
    variants: [
      { productNumber: '17114928', format: 'Blu-ray', edition: '初回限定盤', spec: 'PHOTOBOOK付き' },
      { productNumber: '17114929', format: 'Blu-ray', edition: '通常盤' },
      { productNumber: '17114931', format: 'DVD', edition: '通常盤' },
    ],
  },
  {
    id: 'milk-2024-hero', groupName: 'M!LK', title: 'M!LK CONCERT TOUR 2024「HERO」', releaseDate: '2024-10-30',
    recorded: '2024年6月9日公演',
    sourceUrl: 'https://www.sd-milk.com/musics/19794', checkedAt: CHECKED,
    variants: [
      { productNumber: '17986968', format: 'Blu-ray', edition: '初回限定盤', spec: '2枚組・Photobook付き' },
      { productNumber: '17986873', format: 'Blu-ray', edition: '通常盤' },
      { productNumber: '17986874', format: 'DVD', edition: '通常盤', spec: '2枚組' },
    ],
  },
  {
    id: 'milk-2024-i-can-drink', groupName: 'M!LK', title: '10th Anniversary M!LK ARENA TOUR 2024「I CAN DRINK!」', releaseDate: '2025-06-11',
    sourceUrl: 'https://www.sd-milk.com/discography/dvd', checkedAt: CHECKED,
    variants: [
      { productNumber: '18217748', format: 'Blu-ray', edition: '初回限定盤', spec: '2枚組・Photobook付き' },
      { productNumber: '18217750', format: 'DVD', edition: '初回限定盤', spec: '3枚組・Photobook付き' },
      { productNumber: '18217749', format: 'Blu-ray', edition: '通常盤' },
      { productNumber: '18217747', format: 'DVD', edition: '通常盤', spec: '2枚組' },
    ],
  },
];
