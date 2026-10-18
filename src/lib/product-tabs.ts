// 人物ページの関連商品一覧（ProductTabList）のカテゴリタブと、カテゴリを直接開くページ内リンク（#products-<slug>）の対応。
// サーバー（FeaturedProductsSection・人物ページ）とクライアント（ProductTabList）の両方から使うため、
// 'use client' のファイルではなくこの純粋モジュールに置く。カテゴリ名・分類ロジックは既存のまま（タブ名をそのまま使う）。
//
// URLはハッシュ（#）だけで表すため、新しいページURLは増えない（canonical・構造化データ・サイトマップに影響しない）。
// 例: /person/<名前>#products-cd → CD タブが選ばれた関連商品一覧

export const TAB_ALL = 'すべて';
// 'その他' = 取得元・商品名から種類を判断できなかった商品（削除せず、ここにまとめて表示する）
export const CATEGORY_TABS = ['写真集・書籍', 'CD', 'Blu-ray・DVD', 'グッズ', 'その他', '中古'] as const;

const TAB_SLUGS: Record<(typeof CATEGORY_TABS)[number], string> = {
  '写真集・書籍': 'photobook',
  CD: 'cd',
  'Blu-ray・DVD': 'bluray',
  グッズ: 'goods',
  その他: 'other',
  中古: 'used',
};

const HASH_PREFIX = 'products-';

/** カテゴリタブを直接開くページ内リンクのID（例 "products-cd"）。該当するタブが無ければ null */
export function productTabAnchorId(tab: string): string | null {
  const slug = TAB_SLUGS[tab as keyof typeof TAB_SLUGS];
  return slug ? `${HASH_PREFIX}${slug}` : null;
}

/** location.hash（"#products-cd" 等）からカテゴリタブ名を得る。該当しなければ null */
export function productTabFromHash(hash: string | null | undefined): string | null {
  const id = decodeURIComponent((hash ?? '').replace(/^#/, ''));
  if (!id.startsWith(HASH_PREFIX)) return null;
  const slug = id.slice(HASH_PREFIX.length).toLowerCase();
  const found = CATEGORY_TABS.find((t) => TAB_SLUGS[t] === slug);
  return found ?? null;
}

/** タブ別件数（ProductTabList の表示件数と同じ数え方：中古は '中古'、それ以外は表示カテゴリ） */
export function countProductsByTab(items: readonly { sectionLabel: string; isUsed: boolean }[]): Record<string, number> {
  const counts: Record<string, number> = { [TAB_ALL]: items.length };
  for (const { sectionLabel, isUsed } of items) {
    const key = isUsed ? '中古' : sectionLabel;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
