// 人物ページ「関連商品ピックアップ」プレビュー。
//
// 目的: 商品セクションが人物ページの最上部を占有していた問題を解消するため、
// カテゴリごとに数件だけ見せるプレビューとし、全件は既存の #products
// （ProductTabList、変更なし）にそのまま任せる。ここでは新しい商品ランキング・
// スコアリングは作らず、既存の商品ソートロジック（product-display-score.ts）の
// 結果（sectionResults）の先頭数件をそのまま使う。
//
// 見出し文言について: 当初「人気・おすすめ商品」としていたが、実際の並び順は
// 人気度・売上・レビュー数ではなく人物との関連度スコア（calcDisplayScore /
// relevanceScore）に基づくため、実データと見出しの意味が一致しない指摘を受け
// 「関連商品ピックアップ」へ変更した（表示ロジック・件数・商品カードは無変更）。
import ProductCard from '@/components/ProductCard';
import type { RakutenItem } from '@/types/rakuten';
import type { ApiResult } from '@/types/rakuten';

const ITEMS_PER_CATEGORY = 4;

interface SectionResult {
  label: string;
  icon: string;
  newResult: ApiResult;
  usedProducts: RakutenItem[];
}

interface Props {
  sectionResults: SectionResult[];
  personSlug: string;
  totalProductCount: number;
}

export default function FeaturedProductsSection({ sectionResults, personSlug, totalProductCount }: Props) {
  const previewSections = sectionResults
    .map(({ label, icon, newResult }) => ({
      label,
      icon,
      products: newResult.status === 'ok' ? newResult.products.slice(0, ITEMS_PER_CATEGORY) : [],
    }))
    .filter((s) => s.products.length > 0);

  if (previewSections.length === 0) return null;

  return (
    <section id="featured-products" aria-labelledby="featured-products-heading">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 id="featured-products-heading" className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>
            🛍 関連商品ピックアップ
          </h2>
        </div>
        <a href="#products" className="text-xs font-medium hover:underline flex items-center gap-1" style={{ color: 'var(--ds-primary)' }}>
          関連商品をもっと見る（{totalProductCount}件）→
        </a>
      </div>

      <div className="space-y-5">
        {previewSections.map(({ label, icon, products }) => (
          <div key={label}>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--ds-muted)' }}>
              {icon} {label}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} personSlug={personSlug} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
