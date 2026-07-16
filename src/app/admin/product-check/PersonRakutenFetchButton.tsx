'use client';

import { useState } from 'react';

// 'config_missing': API設定不足で503が返った
// 'done': 正常完了（0件含む）
// 'error': その他エラー
type Status = 'idle' | 'running' | 'done' | 'error' | 'config_missing';

interface FetchResult {
  stored: number;
  aiJudged: number;
  aiQueued: number;
  skipped: number;
  excluded: number;
  usedSuppressed: number;
  fetchFailed: number;
  aiFailed: number;
  aiKeyMissing: boolean;
  upstreamHttpStatus?: number;
  message?: string;
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
        // API設定不足は専用表示
        if (data.status === 'config_missing') {
          setStatus('config_missing');
          return;
        }
        // upstream_error: 楽天APIが 4xx/5xx を返した
        if (data.status === 'upstream_error') {
          setErrorMsg(`楽天API ${data.httpStatus} エラー`);
          setStatus('error');
          return;
        }
        // network_error: タイムアウト・ネットワーク障害
        if (data.status === 'network_error') {
          setErrorMsg('接続失敗（タイムアウト等）');
          setStatus('error');
          return;
        }
        setErrorMsg(data.error ?? `HTTP ${res.status}`);
        setStatus('error');
        return;
      }

      setResult({
        stored:             data.person.stored             ?? 0,
        aiJudged:           data.person.aiJudged           ?? 0,
        aiQueued:           data.person.aiQueued           ?? 0,
        skipped:            data.person.skipped            ?? 0,
        excluded:           data.person.excluded           ?? 0,
        usedSuppressed:     data.person.usedSuppressed     ?? 0,
        fetchFailed:        data.person.fetchFailed        ?? 0,
        aiFailed:           data.person.aiFailed           ?? 0,
        aiKeyMissing:       data.person.aiKeyMissing       ?? false,
        upstreamHttpStatus: data.person.upstreamHttpStatus,
        message:            data.person.message,
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

      {/* API設定不足 — 専用表示 */}
      {status === 'config_missing' && (
        <span className="text-xs text-orange-600 whitespace-nowrap font-medium" title="RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY が未設定です">
          ⚠ API設定不足
        </span>
      )}

      {/* 正常完了 */}
      {status === 'done' && result && (() => {
        // 楽天APIが正常に0件を返した（設定不足とは別）
        if (result.stored === 0 && result.skipped === 0 && result.fetchFailed === 0) {
          return (
            <span className="text-xs text-gray-400 whitespace-nowrap" title={result.message}>
              API正常・0件
            </span>
          );
        }
        // 楽天APIエラー（部分的にせよ0件取得）
        if (result.fetchFailed > 0 && result.stored === 0) {
          return (
            <span className="text-xs text-red-500 whitespace-nowrap" title={result.message}>
              ⚠ 楽天APIエラー({result.fetchFailed}件)
              {result.upstreamHttpStatus && ` HTTP${result.upstreamHttpStatus}`}
            </span>
          );
        }
        // 正常取得（0件超）
        return (
          <span className="text-xs whitespace-nowrap flex items-center gap-1.5">
            <span className="text-teal-600 font-medium">取得{result.stored}</span>
            {result.skipped > 0 && <span className="text-gray-400">判定済skip{result.skipped}</span>}
            {result.excluded > 0 && <span className="text-orange-500">除外KW{result.excluded}</span>}
            {result.usedSuppressed > 0 && <span className="text-blue-500">中古抑制{result.usedSuppressed}</span>}
            {result.fetchFailed > 0 && <span className="text-orange-500">取得エラー{result.fetchFailed}</span>}
            {result.aiKeyMissing ? (
              <span className="text-red-500">⚠AIキー未設定</span>
            ) : result.aiQueued > 0 ? (
              <span className={result.aiFailed > 0 ? 'text-red-500' : 'text-green-600'}>
                AI判定{result.aiJudged}/{result.aiQueued}
                {result.aiFailed > 0 && ` (失敗${result.aiFailed})`}
              </span>
            ) : result.stored > 0 ? (
              <span className="text-gray-400">AI対象なし(全判定済)</span>
            ) : null}
          </span>
        );
      })()}

      {/* エラー */}
      {status === 'error' && (
        <span className="text-xs text-red-500 max-w-[180px] truncate" title={errorMsg}>
          ⚠ {errorMsg.slice(0, 50)}
        </span>
      )}
    </div>
  );
}
