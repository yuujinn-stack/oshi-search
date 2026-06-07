import { getProductsByCategory } from '@/lib/rakuten';
import type { ProductCategory } from '@/types/rakuten';
import ProductCard from './ProductCard';

interface Props {
  personName: string;
  group: string;
  category: ProductCategory;
}

export default async function ProductSection({ personName, group, category }: Props) {
  const result = await getProductsByCategory(personName, group, category);

  if (result.status === 'error') {
    return (
      <div className="py-6 text-center text-sm text-gray-400 bg-gray-50 rounded-xl">
        現在商品情報を取得できません
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
