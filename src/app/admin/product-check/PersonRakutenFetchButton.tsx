'use client';

import { useState } from 'react';

type Status = 'idle' | 'running' | 'done' | 'error';

interface FetchResult {
  stored: number;
  aiJudged: number;
  aiQueued: number;
  skipped: number;
  excluded: number;
  usedSuppressed: number;
}

export default function PersonRakutenFetchButton({ personName }: { personName: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<FetchResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleClick() {
    if (!confirm(`「${personName}」の楽天商品を再取得します。\n既存の判定（AI・手動）は保持されます。`)) return;

    setStatus('running');
    setResult(null);
    setErrorMsg('');

    try {
      const res = await fetch('/api/admin/ai-judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName, forceRejudge: false }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setErrorMsg(data.error ?? `HTTP ${res.status}`);
        setStatus('error');
        return;
      }

      // person.error は processPerson 内で人物が見つからなかった場合にセットされる
      if (data.person?.error) {
        setErrorMsg(data.person.error);
        setStatus('error');
        return;
      }

      setResult({
        stored: data.person.stored ?? 0,
        aiJudged: data.person.aiJudged ?? 0,
        aiQueued: data.person.aiQueued ?? 0,
        skipped: data.person.skipped ?? 0,
        excluded: data.person.excluded ?? 0,
        usedSuppressed: data.person.usedSuppressed ?? 0,
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
        className="text-xs px-2 py-1 bg-teal-100 hover:bg-teal-200 text-teal-700 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        title="楽天APIから商品を再取得して保存（既存の判定は保持）"
      >
        {status === 'running' ? '⏳ 取得中...' : '🔃 楽天再取得'}
      </button>

      {status === 'done' && result && (
        <span className="text-xs whitespace-nowrap flex items-center gap-1.5">
          <span className="text-teal-600 font-medium">取得{result.stored}</span>
          {result.skipped > 0 && <span className="text-gray-400">判定済skip{result.skipped}</span>}
          {result.excluded > 0 && <span className="text-orange-500">除外KW{result.excluded}</span>}
          {result.usedSuppressed > 0 && <span className="text-blue-500">中古抑制{result.usedSuppressed}</span>}
          {result.aiQueued > 0 ? (
            <span className={result.aiJudged < result.aiQueued ? 'text-red-500' : 'text-green-600'}>
              AI判定{result.aiJudged}/{result.aiQueued}
            </span>
          ) : result.stored > 0 ? (
            <span className="text-gray-400">AI対象なし</span>
          ) : null}
        </span>
      )}
      {status === 'error' && (
        <span className="text-xs text-red-500 max-w-[160px] truncate" title={errorMsg}>
          失敗: {errorMsg.slice(0, 40)}
        </span>
      )}
    </div>
  );
}
