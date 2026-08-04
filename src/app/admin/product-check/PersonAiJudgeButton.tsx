'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// このボタンは楽天APIを一切呼ばない。DB(products.items)に保存済みの商品だけを対象に
// AI判定を行う（/api/admin/ai-judge）。楽天商品の再取得は別ボタン(PersonRakutenFetchButton)
// の担当であり、ここからは呼ばれない。
type Status = 'idle' | 'running' | 'done' | 'error' | 'locked';

interface AiFailureDetail {
  productId: string;
  productTitle?: string;
  code: string;
  message: string;
}

interface Result {
  noStoredProducts: boolean;
  totalUnclassifiedBefore: number;
  attemptedCount: number;
  successCount: number;
  failedCount: number;
  remainingCount: number;
  autoApproved: number;
  excluded: number;
  membershipFiltered: number;
  relatedCount: number;
  unrelatedCount: number;
  uncertainCount: number;
  aiKeyMissing: boolean;
  aiFailures: AiFailureDetail[];
  message?: string;
}

// 失敗詳細の折りたたみ表示: 件数と代表理由のみ画面に出し、全件はブラウザのconsoleへ出す
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
      ? `「${personName}」のAI判定済み商品を含めて再判定します（保存済み商品のみ、最大10件）。\nプロンプト変更後に使用してください。`
      : `「${personName}」の保存済み商品からAI判定を実行しますか？（最大10件、楽天APIは呼び出しません）`;
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
          if (res.status === 409) {
            setStatus('locked');
          } else {
            setErrorMsg(data.error ?? `HTTP ${res.status}`);
            setStatus('error');
          }
        } else {
          setResult({
            noStoredProducts:       data.person.noStoredProducts       ?? false,
            totalUnclassifiedBefore: data.person.totalUnclassifiedBefore ?? 0,
            attemptedCount:         data.person.attemptedCount         ?? 0,
            successCount:           data.person.successCount           ?? 0,
            failedCount:            data.person.failedCount            ?? 0,
            remainingCount:         data.person.remainingCount         ?? 0,
            autoApproved:           data.person.autoApproved           ?? 0,
            excluded:               data.person.excluded               ?? 0,
            membershipFiltered:     data.person.membershipFiltered     ?? 0,
            relatedCount:           data.person.relatedCount           ?? 0,
            unrelatedCount:         data.person.unrelatedCount         ?? 0,
            uncertainCount:         data.person.uncertainCount         ?? 0,
            aiKeyMissing:           data.person.aiKeyMissing           ?? false,
            aiFailures:             data.person.aiFailures             ?? [],
            message:                data.person.message,
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
        title="AI判定済み商品を含めて再判定（プロンプト変更後に使用、保存済み商品のみ）"
      >
        🔄 再判定
      </button>

      {/* 二重実行拒否（サーバー側ロック、409） */}
      {status === 'locked' && (
        <span className="text-xs text-amber-600 whitespace-nowrap">
          この人物のAI判定はすでに実行中です
        </span>
      )}

      {/* 正常完了 */}
      {status === 'done' && result && (() => {
        if (result.noStoredProducts) {
          return (
            <span className="text-xs text-orange-600" title="先に「楽天再取得」ボタンを押してください">
              保存済みの商品がありません。先に楽天再取得を実行してください
            </span>
          );
        }
        if (result.aiKeyMissing) {
          return (
            <span className="text-xs text-red-500 whitespace-nowrap" title="OPENAI_API_KEYが設定されていないためAI判定をスキップしました">
              ⚠ AIキー未設定
            </span>
          );
        }
        if (result.totalUnclassifiedBefore === 0) {
          return <span className="text-xs text-gray-400 whitespace-nowrap">未判定の商品はありません</span>;
        }

        // 主メッセージはサーバー(route.ts)が状況に応じて組み立てたものをそのまま信頼して表示する
        // （全件成功/一部失敗/完了/レート制限/残高上限等の文言はサーバー側の唯一の生成元に統一）
        const complete = result.remainingCount === 0;
        const messageColor = result.failedCount > 0 ? 'text-amber-600' : complete ? 'text-green-600' : 'text-green-600';

        if (complete && result.attemptedCount === 0 && result.successCount === 0) {
          return <span className="text-xs text-green-600">{result.message ?? 'すべての商品を判定しました'}</span>;
        }

        return (
          <span className="text-xs space-x-1.5">
            {result.autoApproved > 0 && <span className="text-blue-600">自動承認{result.autoApproved}</span>}
            {result.excluded > 0 && <span className="text-orange-500">除外{result.excluded}</span>}
            <span className={messageColor}>{result.message}</span>
            {result.aiFailures.length > 0 && <FailureDetails failures={result.aiFailures} />}
            {result.successCount > 0 && (
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
