'use client';

export default function PersonError() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-4xl mb-4">⚠️</p>
        <p className="text-lg font-bold text-slate-700 mb-2">ページの読み込みに失敗しました</p>
        <p className="text-sm text-gray-500">しばらくしてから再度お試しください</p>
      </div>
    </div>
  );
}
