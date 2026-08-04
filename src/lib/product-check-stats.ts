// /admin/product-check の人物ごとの商品集計（純粋関数）。
// products.items（カテゴリ横断でDB保存された全商品）と verdicts（判定結果）を突き合わせて
// 総数・related/uncertain/unrelated・未判定を計算する。
//
// verdict='deleted'（管理者による論理削除）は products.items からは物理削除されない
// （mergeProductItems が既存商品を常に保持するため）ため、total にはそのまま残り続ける。
// deleted を related/uncertain/unrelated のどれにも数えず、かつ total からも除かなければ
// total !== related + uncertain + unrelated + unclassified という不整合が生じる。
// activeTotal（= total - deleted）を導入し、unclassified をその残差として定義することで
// activeTotal === related + uncertain + unrelated + unclassified を常に成立させる。

import type { StoredCategoryData } from './product-store';
import type { JudgmentRecord } from './judgment-store';
import type { ProductCategory } from '@/types/person';

export interface PersonProductStats {
  total: number;        // 取得済み全商品数（deleted含む、カテゴリ横断の合計）
  activeTotal: number;   // total - deleted（削除済みを除いた実効総数）
  deleted: number;       // verdict='deleted'（論理削除）の件数
  related: number;
  uncertain: number;
  unrelated: number;
  unclassified: number;  // 未判定。activeTotal - (related+uncertain+unrelated) の残差として定義
}

export function computePersonProductStats(
  storedData: Partial<Record<ProductCategory, StoredCategoryData>>,
  verdicts: Record<string, JudgmentRecord>,
): PersonProductStats {
  const total = Object.values(storedData)
    .reduce((sum, d) => sum + (d?.products.length ?? 0), 0);

  const counts = { related: 0, uncertain: 0, unrelated: 0, deleted: 0 };
  for (const v of Object.values(verdicts)) {
    if (v.verdict in counts) counts[v.verdict as keyof typeof counts]++;
  }

  const activeTotal = Math.max(0, total - counts.deleted);
  const unclassified = Math.max(0, activeTotal - (counts.related + counts.uncertain + counts.unrelated));

  return {
    total,
    activeTotal,
    deleted: counts.deleted,
    related: counts.related,
    uncertain: counts.uncertain,
    unrelated: counts.unrelated,
    unclassified,
  };
}
