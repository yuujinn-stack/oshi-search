// トップページ「グループで探す」の絞り込みの表示分類（明示的なマッピング）。DB・group_meta・人物データとは独立した一覧。
// トップページ（src/components/site/HomeGroupSection.tsx）では、ここに無いグループ（新規追加など）は「その他」になる。
// 動画「登録グループ紹介」（src/lib/video-registered-groups.ts）は、ここに無いグループを男性・女性・その他のどれにも入れない
// （名前やメンバーから推測して振り分けない。分類なしとして扱う）。
// 照合は NFKC 正規化後に行う（例: データ上の「＝LOVE」は全角＝）。
// 'use client' のコンポーネントからもサーバーからも使う（依存なし）。

export type HomeGroupCategory = 'femaleIdol' | 'maleIdol' | 'other';

export const HOME_GROUP_CATEGORY: Readonly<Record<string, HomeGroupCategory>> = {
  // 女性アイドル
  '乃木坂46': 'femaleIdol',
  '櫻坂46': 'femaleIdol',
  '欅坂46': 'femaleIdol',
  '日向坂46': 'femaleIdol',
  '=LOVE': 'femaleIdol',
  'FRUITS ZIPPER': 'femaleIdol',
  // 男性アイドル・男性アイドル系
  'Snow Man': 'maleIdol',
  'SixTONES': 'maleIdol',
  'なにわ男子': 'maleIdol',
  'Travis Japan': 'maleIdol',
  'timelesz': 'maleIdol',
  '嵐': 'maleIdol',
  'M!LK': 'maleIdol',
  'Aぇ! group': 'maleIdol',
  'King & Prince': 'maleIdol',
  'Number_i': 'maleIdol',
  // その他（お笑い・バンド・俳優集団など）
  'バナナマン': 'other',
  'オードリー': 'other',
  'モナキ': 'other',
  'D-BOYS': 'other',
  'DISH//': 'other',
  'THE ORAL CIGARETTES': 'other',
  'BLUE ENCOUNT': 'other',
  'SPYAIR': 'other',
  'UVERworld': 'other',
};

const normalizeGroupKey = (name: string) => name.normalize('NFKC').trim();
const CATEGORY_BY_KEY = new Map(Object.entries(HOME_GROUP_CATEGORY).map(([name, cat]) => [normalizeGroupKey(name), cat]));

/** 一覧に載っているグループの分類。載っていなければ null（推測しない） */
export function findHomeGroupCategory(name: string): HomeGroupCategory | null {
  return CATEGORY_BY_KEY.get(normalizeGroupKey(name)) ?? null;
}

/** トップページの絞り込み用（一覧に無いグループは「その他」） */
export function getHomeGroupCategory(name: string): HomeGroupCategory {
  return findHomeGroupCategory(name) ?? 'other';
}
