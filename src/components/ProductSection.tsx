import type { ProductCategory, ApiResult } from '@/types/rakuten';
import ProductCard from './ProductCard';

interface Props {
  result: ApiResult;
  category: ProductCategory;
}

// 既存コードとの互換性のために残しているが、person/[slug]/page.tsx からは直接使われていない
export default function ProductSection({ result }: Props) {
  if (result.status === 'error') {
    return (
      <div className="py-6 text-center text-sm text-gray-400 bg-gray-50 rounded-xl">
        現在商品情報を取得できません
      </div>
    );
  }
  if (result.status === 'no_data') {
    return (
      <div className="py-6 text-center text-sm text-gray-400 bg-gray-50 rounded-xl">
        商品情報を準備中です
      </div>
    );
  }
  if (result.status === 'empty') {
    return (
      <div className="py-6 text-center text-sm text-gray-400 bg-gray-50 rounded-xl">
        該当商品が見つかりませんでした
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {result.products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
