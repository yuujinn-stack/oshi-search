'use client';

import { useEffect } from 'react';

export default function PersonError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[PersonPage] rendering error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-4xl mb-4">⚠️</p>
        <p className="text-lg font-bold text-slate-700 mb-2">ページの読み込みに失敗しました</p>
        <p className="text-sm text-gray-500 mb-6">しばらくしてから再度お試しください</p>
        <div className="flex justify-center gap-3">
          <button
            onClick={reset}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-colors"
          >
            再試行
          </button>
          <a
            href="/"
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-slate-700 text-sm font-bold rounded-xl transition-colors"
          >
            ホームへ戻る
          </a>
        </div>
      </div>
    </div>
  );
}
