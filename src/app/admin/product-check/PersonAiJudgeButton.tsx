'use client';

import { useState } from 'react';

type Status = 'idle' | 'running' | 'done' | 'error' | 'config_missing' | 'rate_limited';

interface Result {
  aiJudged: number;
  aiQueued: number;
  autoApproved: number;
  aiFailed: number;
  aiKeyMissing: boolean;
  stored: number;
  skipped: number;
  excluded: number;
  relatedCount: number;
  unrelatedCount: number;
  uncertainCount: number;
  fetchFailed: number;
  failedCategories: string[];
  upstreamHttpStatus?: number;
  message?: string;
}

export default function PersonAiJudgeButton({ personName }: { personName: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function handleClick(forceRejudge = false) {
    const msg = forceRejudge
      ? `「${personName}」のAI判定済み商品を含めて再判定します。\nプロンプト変更後に使用してください。`
      : `「${personName}」の商品を楽天から取得してAI判定を実行しますか？\n（既に判定済みの商品はスキップされます）`;
    if (!confirm(msg)) return;

    setStatus('running');
    setResult(null);
    setErrorMsg('');

    try {
      const res = await fetch('/api/admin/ai-judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName, forceRejudge }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        if (data.status === 'config_missing') {
          setStatus('config_missing');
          return;
        }
        if (data.status === 'rate_limited') {
          setStatus('rate_limited');
          return;
        }
        if (data.status === 'upstream_error') {
          setErrorMsg(`楽天API ${data.httpStatus} エラー`);
          setStatus('error');
          return;
        }
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
        aiJudged:           data.person.aiJudged           ?? 0,
        aiQueued:           data.person.aiQueued           ?? 0,
        autoApproved:       data.person.autoApproved       ?? 0,
        aiFailed:           data.person.aiFailed           ?? 0,
        aiKeyMissing:       data.person.aiKeyMissing       ?? false,
        stored:             data.person.stored             ?? 0,
        skipped:            data.person.skipped            ?? 0,
        excluded:           data.person.excluded           ?? 0,
        relatedCount:       data.person.relatedCount       ?? 0,
        unrelatedCount:     data.person.unrelatedCount     ?? 0,
        uncertainCount:     data.person.uncertainCount     ?? 0,
        fetchFailed:        data.person.fetchFailed        ?? 0,
        failedCategories:   data.person.failedCategories   ?? [],
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
        onClick={() => handleClick(false)}
        disabled={status === 'running'}
        className="text-xs px-2 py-1 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
      >
        {status === 'running' ? '⏳ 判定中...' : '🤖 AI判定'}
      </button>
      <button
        onClick={() => handleClick(true)}
        disabled={status === 'running'}
        className="text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        title="AI判定済み商品を含めて再判定（プロンプト変更後に使用）"
      >
        🔄 再判定
      </button>

      {/* API設定不足 — 専用表示 */}
      {status === 'config_missing' && (
        <span className="text-xs text-orange-600 whitespace-nowrap font-medium" title="RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY が未設定です">
          ⚠ API設定不足
        </span>
      )}

      {/* 429 レート制限 */}
      {status === 'rate_limited' && (
        <span className="text-xs text-amber-600 whitespace-nowrap" title="HTTP 429 Too Many Requests — しばらく時間を置いてから再実行してください">
          ⏳ 利用制限中 — しばらく待ってから再実行してください
        </span>
      )}

      {/* 正常完了 */}
      {status === 'done' && result && (() => {
        if (result.aiKeyMissing) {
          return (
            <span className="text-xs text-red-500 whitespace-nowrap" title="OPENAI_API_KEYが設定されていないためAI判定をスキップしました">
              ⚠ AIキー未設定 (取得{result.stored})
            </span>
          );
        }
        if (result.fetchFailed > 0 && result.stored === 0) {
          return (
            <span
              className="text-xs text-red-500 whitespace-nowrap"
              title={result.failedCategories.length > 0 ? `失敗カテゴリ: ${result.failedCategories.join(', ')}` : result.message}
            >
              ⚠ 検索失敗{result.fetchFailed}カテゴリ
              {result.upstreamHttpStatus && ` HTTP${result.upstreamHttpStatus}`}
            </span>
          );
        }
        if (result.stored === 0 && result.skipped === 0 && result.fetchFailed === 0) {
          return (
            <span className="text-xs text-gray-400 whitespace-nowrap" title={result.message}>
              API正常・0件
            </span>
          );
        }
        return (
          <span className="text-xs whitespace-nowrap space-x-1.5">
            <span className="text-gray-500">取得{result.stored}</span>
            <span className="text-gray-400">skip{result.skipped}</span>
            {result.excluded > 0 && <span className="text-orange-500">除外{result.excluded}</span>}
            {result.fetchFailed > 0 && (
              <span
                className="text-orange-500"
                title={result.failedCategories.length > 0 ? `失敗カテゴリ: ${result.failedCategories.join(', ')}` : undefined}
              >
                検索失敗{result.fetchFailed}カテゴリ
              </span>
            )}
            {result.autoApproved > 0 && <span className="text-blue-600">自動承認{result.autoApproved}</span>}
            <span className="text-blue-500">AI対象{result.aiQueued}</span>
            {result.aiQueued === 0 && result.stored > 0 && result.autoApproved === 0 ? (
              <span className="text-amber-600">（全件判定済み）</span>
            ) : result.aiQueued > 0 ? (
              <span className={result.aiFailed > 0 ? 'text-red-500' : 'text-green-600'}>
                完了{result.aiJudged}
                {result.aiFailed > 0 && ` (失敗${result.aiFailed})`}
              </span>
            ) : null}
            {result.aiQueued > 0 && (
              <span className="text-gray-400">
                related:{result.relatedCount} unrelated:{result.unrelatedCount} uncertain:{result.uncertainCount}
              </span>
            )}
          </span>
        );
      })()}

      {/* エラー */}
      {status === 'error' && (
        <span className="text-xs text-red-500 max-w-[160px] truncate" title={errorMsg}>
          ⚠ {errorMsg.slice(0, 40)}
        </span>
      )}
    </div>
  );
}
