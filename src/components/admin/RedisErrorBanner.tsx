'use client';

interface Props {
  title?: string;
  detail?: string;
}

export default function RedisErrorBanner({
  title = 'データを一時的に表示できません',
  detail,
}: Props) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-lg font-bold text-amber-800 mb-3">{title}</h2>
        <p className="text-sm text-amber-700 leading-relaxed">
          Redisのリクエスト制限または接続エラーにより、一時的にデータを表示できません。
          <strong className="font-semibold">データが削除されたわけではありません。</strong>
          時間をおいてからページを再読み込みしてください。
        </p>
        {detail && (
          <pre className="mt-4 text-left text-xs text-amber-600 bg-amber-100 rounded-lg p-3 overflow-auto whitespace-pre-wrap">
            {detail}
          </pre>
        )}
        <div className="mt-6 flex items-center justify-center gap-4">
          <a
            href="/admin/redis-backup"
            className="text-xs text-amber-600 hover:underline"
          >
            Redisの状態を確認する →
          </a>
          <button
            onClick={() => window.location.reload()}
            className="text-xs text-amber-600 hover:underline"
          >
            ページを再読み込み
          </button>
        </div>
      </div>
    </div>
  );
}
