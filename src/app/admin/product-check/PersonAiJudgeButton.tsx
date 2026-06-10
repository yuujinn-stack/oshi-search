'use client';

import { useState } from 'react';

type Status = 'idle' | 'running' | 'done' | 'error';

interface Result {
  aiJudged: number;
  stored: number;
  skipped: number;
  excluded: number;
}

export default function PersonAiJudgeButton({ personName }: { personName: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleClick() {
    if (!confirm(`「${personName}」の商品を楽天から取得してAI判定を実行しますか？\n（既に判定済みの商品はスキップされます）`)) return;

    setStatus('running');
    setResult(null);
    setErrorMsg('');

    try {
      const res = await fetch('/api/admin/ai-judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setErrorMsg(data.error ?? `HTTP ${res.status}`);
        setStatus('error');
        return;
      }

      setResult({
        aiJudged: data.person.aiJudged ?? 0,
        stored: data.person.stored ?? 0,
        skipped: data.person.skipped ?? 0,
        excluded: data.person.excluded ?? 0,
      });
      setStatus('done');
    } catch (err) {
      setErrorMsg(String(err));
      setStatus('error');
    }
  }

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <button
        onClick={handleClick}
        disabled={status === 'running'}
        className="text-xs px-2 py-1 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
      >
        {status === 'running' ? '⏳ 判定中...' : '🤖 AI判定'}
      </button>

      {status === 'done' && result && (
        <span className="text-xs text-green-600 whitespace-nowrap">
          取得{result.stored} AI{result.aiJudged}件
        </span>
      )}
      {status === 'error' && (
        <span className="text-xs text-red-500 max-w-[100px] truncate" title={errorMsg}>
          失敗
        </span>
      )}
    </div>
  );
}
