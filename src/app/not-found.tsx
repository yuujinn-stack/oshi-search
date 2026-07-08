import Link from 'next/link';

// /_not-found はルートレイアウト(Header)経由でDBを読むため force-dynamic を設定する
export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <p className="text-6xl font-black text-gray-200 mb-4">404</p>
      <h1 className="text-xl font-bold text-gray-700 mb-2">ページが見つかりません</h1>
      <p className="text-gray-500 text-sm mb-8">
        お探しのページは存在しないか、移動した可能性があります。
      </p>
      <Link
        href="/"
        className="px-6 py-2 rounded-lg text-sm font-medium text-white"
        style={{ background: 'var(--ds-primary, #e11d48)' }}
      >
        トップへ戻る
      </Link>
    </div>
  );
}
