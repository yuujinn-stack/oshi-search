'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Status = 'idle' | 'running' | 'done' | 'error' | 'config_missing' | 'rate_limited';

interface AiFailureDetail {
  productId: string;
  productTitle?: string;
  code: string;
  message: string;
}

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
  aiFailures: AiFailureDetail[];
}

// 失敗詳細の折りたたみ表示: 件数と代表理由のみ画面に出し、全件はブラウザのconsoleへ出す
// （console.tableもタイトルは既に60文字で切られたものを使い、件数も上限を設けて過剰出力を避ける）
const CONSOLE_TABLE_MAX = 100;

function FailureDetails({ failures }: { failures: AiFailureDetail[] }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.table(
      failures.slice(0, CONSOLE_TABLE_MAX).map((f) => ({ productId: f.productId, title: f.productTitle, code: f.code, message: f.message })),
    );
  }, [failures]);

  const grouped = new Map<string, number>();
  for (const f of failures) grouped.set(f.code, (grouped.get(f.code) ?? 0) + 1);

  return (
    <details className="inline-block align-middle">
      <summary className="cursor-pointer text-red-500 text-xs select-none">詳細({failures.length}件)</summary>
      <div className="mt-1 max-w-xs max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg p-2 text-[11px] space-y-1 whitespace-normal">
        <p className="text-gray-500 font-medium">
          {[...grouped.entries()].map(([code, n]) => `${code}:${n}件`).join(' / ')}
        </p>
        {failures.slice(0, 20).map((f, i) => (
          <p key={`${f.productId}-${i}`} className="text-gray-600 truncate" title={f.productTitle ?? f.productId}>
            {f.productTitle ?? f.productId} — {f.message}
          </p>
        ))}
        {failures.length > 20 && (
          <p className="text-gray-400">…他{failures.length - 20}件（全件はブラウザのコンソール参照）</p>
        )}
      </div>
    </details>
  );
}

export default function PersonAiJudgeButton({
  personName,
  onComplete,
}: {
  personName: string;
  // AI判定が成功系レスポンスで完了するたびに呼ばれる（親側で他パネルの再取得等に使う）
  onComplete?: () => void;
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // fetch中にアンマウントされた場合、その後のsetState呼び出しを止める（React警告防止）
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
      const succeeded = res.ok && data.ok;

      // このボタン自身のローカル表示は、アンマウント後は更新しない（React警告防止）。
      // 一方、verdictsのDB保存自体はfetchの完了時点で確定済みなので、他コンポーネントへの
      // 通知（onComplete）とページ全体のrefreshは、このボタンの表示有無に関わらず必ず行う。
      if (mountedRef.current) {
        if (!succeeded) {
          if (data.status === 'config_missing') {
            setStatus('config_missing');
          } else if (data.status === 'rate_limited') {
            setStatus('rate_limited');
          } else if (data.status === 'upstream_error') {
            setErrorMsg(`楽天API ${data.httpStatus} エラー`);
            setStatus('error');
          } else if (data.status === 'network_error') {
            setErrorMsg('接続失敗（タイムアウト等）');
            setStatus('error');
          } else {
            setErrorMsg(data.error ?? `HTTP ${res.status}`);
            setStatus('error');
          }
        } else {
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
            aiFailures:         data.person.aiFailures         ?? [],
          });
          setStatus('done');
        }
      }

      if (succeeded) {
        // verdictsはDBへ保存済み。画面側の統計(stats props)・商品パネルはこの通知で更新する
        // （window.location.reload()は使わず、Next.jsのソフトリフレッシュに統一する）
        onComplete?.();
        startRefresh(() => {
          router.refresh();
        });
      }
    } catch (err) {
      if (mountedRef.current) {
        setErrorMsg(String(err));
        setStatus('error');
      }
    }
  }

  return (
    // flex-wrap: 結果テキストが長くなっても横はみ出しせず折り返す（スマートフォン幅対策）
    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
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

        // AI判定が必要な商品が0件（既に全件判定済み・自動承認・除外等）
        if (result.aiQueued === 0) {
          return (
            <span className="text-xs space-x-1.5">
              <span className="text-gray-500">取得{result.stored}</span>
              {result.autoApproved > 0 && <span className="text-blue-600">自動承認{result.autoApproved}</span>}
              <span className="text-gray-400">判定対象の商品はありません</span>
              {isRefreshing && <span className="text-gray-400">（画面更新中…）</span>}
            </span>
          );
        }

        const allFailed = result.aiJudged === 0 && result.aiFailed === result.aiQueued;
        const partialFailed = result.aiFailed > 0 && result.aiJudged > 0;
        const representativeFailure = result.aiFailures[0]?.message ?? 'AI判定に失敗しました';

        return (
          <span className="text-xs whitespace-nowrap space-x-1.5">
            <span className="text-gray-500">取得{result.stored}</span>
            {result.excluded > 0 && <span className="text-orange-500">除外{result.excluded}</span>}
            {result.autoApproved > 0 && <span className="text-blue-600">自動承認{result.autoApproved}</span>}
            {allFailed ? (
              <span className="text-red-600">⚠ 全件失敗（{result.aiQueued}件）: {representativeFailure}</span>
            ) : partialFailed ? (
              <span className="text-amber-600">{result.aiJudged}件成功、{result.aiFailed}件失敗</span>
            ) : (
              <span className="text-green-600">{result.aiJudged}件を判定しました</span>
            )}
            {result.aiFailures.length > 0 && <FailureDetails failures={result.aiFailures} />}
            {result.aiQueued > 0 && (
              <span className="text-gray-400">
                related:{result.relatedCount} unrelated:{result.unrelatedCount} uncertain:{result.uncertainCount}
              </span>
            )}
            {isRefreshing && <span className="text-gray-400">（画面更新中…）</span>}
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
