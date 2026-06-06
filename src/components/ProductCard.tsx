import { MockProduct } from '@/types/person';

function StarRating({ value }: { value: number }) {
  return (
    <span className="text-amber-400 text-sm">
      {'★'.repeat(Math.round(value))}{'☆'.repeat(5 - Math.round(value))}
    </span>
  );
}

export default function ProductCard({ product }: { product: MockProduct }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      {/* Image area */}
      <div
        className="aspect-[3/4] flex items-center justify-center"
        style={{ backgroundColor: `#${product.imageColor}20` }}
      >
        <div
          className="w-16 h-20 rounded-lg flex items-center justify-center text-white text-xs font-bold text-center px-1"
          style={{ backgroundColor: `#${product.imageColor}` }}
        >
          {product.category}
        </div>
      </div>

      <div className="p-3 flex flex-col flex-1">
        <p className="text-xs font-medium text-slate-800 line-clamp-2 flex-1 min-h-[2.5rem]">
          {product.title}
        </p>

        <div className="mt-2 flex items-center gap-1">
          <StarRating value={product.reviewAverage} />
          <span className="text-xs text-gray-500">({product.reviewCount})</span>
        </div>

        <p className="text-primary font-bold text-sm mt-1">
          ¥{product.price.toLocaleString()}
        </p>

        <a
          href={product.itemUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block bg-accent hover:bg-yellow-500 active:bg-yellow-600 text-white text-center text-xs font-bold rounded-lg transition-colors"
          style={{ minHeight: '44px', lineHeight: '44px' }}
        >
          楽天で見る
        </a>
      </div>
    </div>
  );
}
