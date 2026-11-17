// トップページ「グループで探す」の絞り込みの表示分類。
// 優先順位: ① 管理画面（/admin/groups）で保存した group_meta.home_category（DB。手動設定のみ）
//          ② 下の明示的なマッピング（初期値。コード）
//          ③ どちらにも無い → トップページでは「その他」、動画では「分類なし」
// ① は buildHomeCategoryOverrides() で作った Map を各関数の overrides に渡す（渡さなければ ② だけで判定）。
// トップページ（src/app/page.tsx → src/components/site/HomeGroupSection.tsx）では、①②に無いグループ（新規追加など）は「その他」になる。
// 動画「登録グループ紹介」（src/lib/video-registered-groups.ts）は、ここに無いグループを男性・女性・その他のどれにも入れない
// （名前やメンバーから推測して振り分けない。分類なしとして扱う）。
// 照合は NFKC 正規化後に行う（例: データ上の「＝LOVE」は全角＝）。
// 'use client' のコンポーネントからもサーバーからも使う（依存なし）。

export type HomeGroupCategory = 'femaleIdol' | 'maleIdol' | 'other';

export const HOME_GROUP_CATEGORIES: readonly HomeGroupCategory[] = ['femaleIdol', 'maleIdol', 'other'];

export const HOME_GROUP_CATEGORY_LABEL: Record<HomeGroupCategory, string> = {
  femaleIdol: '女性アイドル',
  maleIdol: '男性アイドル',
  other: 'その他',
};

export const isHomeGroupCategory = (v: unknown): v is HomeGroupCategory =>
  typeof v === 'string' && (HOME_GROUP_CATEGORIES as readonly string[]).includes(v);

/** 管理画面で保存した分類（group_meta.home_category）。キーは NFKC 正規化済みのグループ名 */
export type HomeCategoryOverrides = ReadonlyMap<string, HomeGroupCategory>;

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
  '超特急': 'maleIdol',
  'FANTASTICS': 'maleIdol',
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

/** group_meta の行から管理画面で保存した分類の Map を作る（未設定・不正な値は入れない） */
export function buildHomeCategoryOverrides(
  metas: readonly { groupName: string; homeCategory?: string | null }[],
): HomeCategoryOverrides {
  const map = new Map<string, HomeGroupCategory>();
  for (const m of metas) {
    if (isHomeGroupCategory(m.homeCategory)) map.set(normalizeGroupKey(m.groupName), m.homeCategory);
  }
  return map;
}

/** 管理画面の設定 → 明示的なマッピングの順で分類を返す。どちらにも無ければ null（推測しない） */
export function findHomeGroupCategory(name: string, overrides?: HomeCategoryOverrides): HomeGroupCategory | null {
  const key = normalizeGroupKey(name);
  return overrides?.get(key) ?? CATEGORY_BY_KEY.get(key) ?? null;
}

/** トップページの絞り込み用（どちらにも無いグループは「その他」） */
export function getHomeGroupCategory(name: string, overrides?: HomeCategoryOverrides): HomeGroupCategory {
  return findHomeGroupCategory(name, overrides) ?? 'other';
}
