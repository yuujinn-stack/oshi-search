import type { RakutenItem } from '@/types/rakuten';

export default function ProductCard({ product }: { product: RakutenItem }) {
  const href = product.affiliateUrl || product.itemUrl;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      {/* 商品画像（クリックでアフィリエイトリンクへ） */}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className="block aspect-[3/4] bg-gray-100 overflow-hidden"
      >
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.title}
            className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs text-center px-2">
            No Image
          </div>
        )}
      </a>

      <div className="p-3 flex flex-col flex-1 gap-1.5">
        {/* 商品名 */}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="text-xs font-medium text-slate-800 line-clamp-2 hover:text-primary transition-colors flex-1 min-h-[2.5rem]"
        >
          {product.title}
        </a>

        {/* レビュー */}
        {Number(product.reviewCount) > 0 && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span className="text-amber-400">★</span>
            <span className="font-medium">{Number(product.reviewAverage).toFixed(1)}</span>
            <span>({Number(product.reviewCount).toLocaleString()}件)</span>
          </div>
        )}

        {/* 価格 */}
        <p className="text-primary font-bold text-sm">
          ¥{Number(product.price).toLocaleString()}
          <span className="text-xs font-normal text-gray-400 ml-1">（税込）</span>
        </p>

        {/* CTAボタン */}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="mt-1 block bg-accent hover:bg-yellow-500 active:bg-yellow-600 text-white text-center text-xs font-bold rounded-lg transition-colors"
          style={{ minHeight: '44px', lineHeight: '44px' }}
        >
          楽天で見る →
        </a>
      </div>
    </div>
  );
}
