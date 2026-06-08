'use client';

import { useState } from 'react';

interface BatchResult {
  ok?: boolean;
  elapsed?: string;
  personCount?: number;
  totalStored?: number;
  totalAutoClassified?: number;
  totalAiJudged?: number;
  errors?: Array<{ name: string; error: string }>;
  error?: string;
}

export default function BatchButton() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);

  async function handleRun() {
    if (!confirm('全員分の商品取得とAI判定を実行します。約1〜2分かかります。よろしいですか？')) return;
    setRunning(true);
    setResult(null);

    const res = await fetch('/api/admin/batch', {
      method: 'POST',
    });
    const data: BatchResult = await res.json().catch(() => ({ error: '応答の解析に失敗しました' }));
    setResult(data);
    setRunning(false);

    if (data.ok) {
      // ページをリロードして最新の batchMeta を表示
      setTimeout(() => window.location.reload(), 1500);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2 flex-shrink-0">
      <button
        onClick={handleRun}
        disabled={running}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
      >
        {running ? '⏳ 処理中...' : '▶ 今すぐ実行'}
      </button>
      {running && (
        <p className="text-xs text-indigo-600 animate-pulse">楽天API取得 + AI判定中...</p>
      )}
      {result && (
        <div className={`text-xs rounded-lg px-3 py-2 max-w-xs text-right ${result.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {result.ok ? (
            <>
              完了 ({result.elapsed})<br />
              {result.personCount}人 / 商品{result.totalStored}件取得<br />
              自動判定 {result.totalAutoClassified}件 / AI判定 {result.totalAiJudged}件
              {result.errors && result.errors.length > 0 && (
                <><br />エラー: {result.errors.map(e => e.name).join(', ')}</>
              )}
            </>
          ) : (
            result.error ?? 'エラーが発生しました'
          )}
        </div>
      )}
    </div>
  );
}
