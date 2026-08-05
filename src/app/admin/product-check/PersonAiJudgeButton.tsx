'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MAX_AUTO_JUDGE_ITEMS, MAX_EXCLUDE_PRODUCT_IDS } from '@/lib/ai-judge-constants';

// このボタンは楽天APIを一切呼ばない。DB(products.items)に保存済みの商品だけを対象に
// AI判定を行う（/api/admin/ai-judge）。楽天商品の再取得は別ボタン(PersonRakutenFetchButton)
// の担当であり、ここからは呼ばれない。
//
// 「AI判定 10件」: 1回のクリックで最大10件だけ処理する（従来のボタンと同じ挙動）。
// 「全件AI判定」: 上と同じAPIをクライアント側から直列に繰り返し呼び、未判定が無くなる
//   （または残高不足・失敗商品のみが残る等の理由で停止する）まで自動的に処理を続ける。
//   1回のOpenAIリクエストに複数商品をまとめることはせず、1商品ずつ独立して判定する方式・
//   プロンプト・モデル・パラメータは一切変更していない（サーバー側の判定ロジックは共通）。
type Status = 'idle' | 'running' | 'done' | 'error' | 'locked';
type AutoStatus = 'idle' | 'running' | 'stopping' | 'done' | 'error' | 'locked';

interface AiFailureDetail {
  productId: string;
  productTitle?: string;
  code: string;
  message: string;
}

interface BatchResult {
  noStoredProducts: boolean;
  totalUnclassifiedBefore: number;
  attemptedCount: number;
  successCount: number;
  failedCount: number;
  remainingCount: number;
  runnableRemainingCount: number;
  failedInThisRunCount: number;
  autoApproved: number;
  excluded: number;
  membershipFiltered: number;
  relatedCount: number;
  unrelatedCount: number;
  uncertainCount: number;
  aiKeyMissing: boolean;
  aiFailures: AiFailureDetail[];
  stopProcessing: boolean;
  stopReason?: 'COMPLETED' | 'FAILED_ITEMS_REMAIN' | 'INSUFFICIENT_QUOTA' | 'AI_KEY_MISSING';
  message?: string;
}

// 「全件AI判定」の安全弁: successCountが0のバッチがこの回数連続したら、
// サーバー側のstopProcessingとは別にクライアント側でも停止する（defense in depth）。
//
// 商品固有の失敗（特定商品のJSON解析失敗・タイムアウト等）は、失敗のたびにexcludeProductIds
// へ追加され次バッチでは選ばれなくなるため、各バッチは常に「まだ試していない商品」だけで
// 構成される。したがって successCount===0 のバッチが連続するというのは、たまたま複数の
// 商品が個別に失敗した偶然ではなく、OpenAI側の全体障害（ネットワーク・サービス停止等、
// INSUFFICIENT_QUOTAとして分類されない一時的な広範囲エラー）を強く示唆する。
// この前提のもとで閾値を3から2へ引き下げ、無駄なOpenAI呼び出しをより早く打ち切る。
const MAX_CONSECUTIVE_EMPTY_BATCHES = 2;
// バッチ間の短い間隔（HTTPリクエスト単位。1商品ごとのOpenAI呼び出し間隔とは別の、
// バッチ＝ロック取得/解放サイクルの間隔）
const BATCH_INTERVAL_MS = 400;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function PersonAiJudgeButton({
  personName,
  onComplete,
}: {
  personName: string;
  // AI判定バッチが成功系レスポンスで完了するたびに呼ばれる（親側で他パネルの再取得等に使う）
  onComplete?: () => void;
}) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  // ── 単発バッチ（AI判定 10件 / 再判定）用state ──────────────────────────────
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<BatchResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // ── 全件AI判定（自動継続）用state ────────────────────────────────────────
  const [autoStatus, setAutoStatus] = useState<AutoStatus>('idle');
  const [autoErrorMsg, setAutoErrorMsg] = useState('');
  const [autoProgress, setAutoProgress] = useState<{
    totalAtStart: number;
    successSum: number;
    failedSum: number;
    remainingCount: number;
    runnableRemainingCount: number;
    batchesRun: number;
    stopReason?: BatchResult['stopReason'];
    lastMessage?: string;
    lastFailures: AiFailureDetail[];
    overLimitWarning: boolean;
  } | null>(null);

  // 単発バッチ・全件ループのどちらかが実行中かを表す同期的なref。
  // disabled属性（React state経由、非同期）だけに頼らず、イベントハンドラの先頭で同期的に
  // チェック・セットすることで、どちらのボタンからの二重クリックも確実に防止する。
  const busyRef = useRef(false);
  const autoStopRequestedRef = useRef(false);

  // fetch中にアンマウントされた場合、その後のsetState呼び出しを止める（React警告防止）
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 1バッチ分をサーバーへ送信する共通ヘルパー（単発ボタン・全件ループ両方から使う）
  async function runOneBatch(forceRejudge: boolean, excludeProductIds: string[]): Promise<
    | { ok: true; status: string; person: BatchResult }
    | { ok: false; locked: true }
    | { ok: false; locked: false; error: string }
  > {
    const res = await fetch('/api/admin/ai-judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personName,
        forceRejudge,
        excludeProductIds: excludeProductIds.slice(0, MAX_EXCLUDE_PRODUCT_IDS),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) return { ok: false, locked: true };
    if (!res.ok || !data.ok) return { ok: false, locked: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, status: data.status, person: data.person as BatchResult };
  }

  // ── 単発バッチ（AI判定 10件 / 再判定） ──────────────────────────────────────
  async function handleClick(forceRejudge = false) {
    if (busyRef.current) return; // 二重クリック防止（disabled属性だけに依存しない）
    const msg = forceRejudge
      ? `「${personName}」のAI判定済み商品を含めて再判定します（保存済み商品のみ、最大10件）。\nプロンプト変更後に使用してください。`
      : `「${personName}」の保存済み商品からAI判定を実行しますか？（最大10件、楽天APIは呼び出しません）`;
    if (!confirm(msg)) return;
    if (busyRef.current) return; // confirm()表示中に全件AI判定が先に開始された場合の保険

    busyRef.current = true;
    setStatus('running');
    setResult(null);
    setErrorMsg('');

    try {
      const outcome = await runOneBatch(forceRejudge, []);

      if (mountedRef.current) {
        if (!outcome.ok) {
          if (outcome.locked) setStatus('locked');
          else { setErrorMsg(outcome.error); setStatus('error'); }
        } else {
          setResult(outcome.person);
          setStatus('done');
        }
      }

      if (outcome.ok) {
        // verdictsはDBへ保存済み。画面側の統計(stats props)・商品パネルはこの通知で更新する
        // （window.location.reload()は使わず、Next.jsのソフトリフレッシュに統一する）
        onComplete?.();
        startRefresh(() => { router.refresh(); });
      }
    } catch (err) {
      if (mountedRef.current) {
        setErrorMsg(String(err));
        setStatus('error');
      }
    } finally {
      busyRef.current = false;
    }
  }

  // ── 全件AI判定（自動継続ループ） ─────────────────────────────────────────────
  async function handleAutoJudge() {
    if (busyRef.current) return; // 二重クリック防止（disabled属性だけに依存しない）
    if (!confirm(`「${personName}」の未判定商品を、無くなるまで自動的に判定します（1回につき最大10件ずつ、1商品ずつ個別に判定）。\n件数が多い場合は時間がかかります。途中で「停止」を押すこともできます。\n開始しますか？`)) {
      return;
    }
    if (busyRef.current) return; // confirm()表示中に単発バッチが先に開始された場合の保険

    busyRef.current = true;
    autoStopRequestedRef.current = false;
    setAutoStatus('running');
    setAutoErrorMsg('');
    setAutoProgress({
      totalAtStart: 0, successSum: 0, failedSum: 0, remainingCount: 0, runnableRemainingCount: 0,
      batchesRun: 0, lastFailures: [], overLimitWarning: false,
    });

    const excludeProductIds: string[] = [];
    let consecutiveEmptyBatches = 0;
    let totalAtStart: number | null = null;
    let successSum = 0;
    let failedSum = 0;
    let batchesRun = 0;
    let finalStopReason: BatchResult['stopReason'] | undefined;
    let finalMessage: string | undefined;
    let hadError = false;
    let wasLocked = false;

    while (true) {
      if (autoStopRequestedRef.current) break;

      let outcome;
      try {
        outcome = await runOneBatch(false, excludeProductIds);
      } catch (err) {
        hadError = true;
        if (mountedRef.current) setAutoErrorMsg(String(err));
        break;
      }

      if (!outcome.ok) {
        if (outcome.locked) { wasLocked = true; } else { hadError = true; if (mountedRef.current) setAutoErrorMsg(outcome.error); }
        break;
      }

      const person = outcome.person;
      batchesRun++;
      successSum += person.successCount;
      failedSum += person.failedCount;
      if (totalAtStart === null) totalAtStart = person.totalUnclassifiedBefore;
      finalStopReason = person.stopReason;
      finalMessage = person.message;

      // 今回失敗した商品IDを次回以降のバッチ対象から除外する（無限再試行防止。永続化はしない）
      for (const f of person.aiFailures) {
        if (excludeProductIds.length >= MAX_EXCLUDE_PRODUCT_IDS) break;
        if (!excludeProductIds.includes(f.productId)) excludeProductIds.push(f.productId);
      }

      if (mountedRef.current) {
        setAutoProgress({
          totalAtStart: totalAtStart ?? 0,
          successSum,
          failedSum,
          remainingCount: person.remainingCount,
          runnableRemainingCount: person.runnableRemainingCount,
          batchesRun,
          stopReason: person.stopReason,
          lastMessage: person.message,
          lastFailures: person.aiFailures,
          overLimitWarning: (totalAtStart ?? 0) > MAX_AUTO_JUDGE_ITEMS,
        });
      }

      // 各バッチ終了後、展開済み商品パネルだけを再取得させる（ページ全体のreloadはしない）
      onComplete?.();

      if (person.stopProcessing) break;

      if (person.successCount === 0) {
        consecutiveEmptyBatches++;
        if (consecutiveEmptyBatches >= MAX_CONSECUTIVE_EMPTY_BATCHES) break;
      } else {
        consecutiveEmptyBatches = 0;
      }

      if (autoStopRequestedRef.current) break;
      await sleep(BATCH_INTERVAL_MS);
    }

    busyRef.current = false;

    if (mountedRef.current) {
      if (wasLocked) setAutoStatus('locked');
      else if (hadError) setAutoStatus('error');
      else setAutoStatus('done');
      if (finalStopReason || finalMessage) {
        setAutoProgress((prev) => prev ? { ...prev, stopReason: finalStopReason, lastMessage: finalMessage } : prev);
      }
    }

    // 全件完了・停止いずれの場合も、最後に1回だけページ全体をrefreshする
    // （バッチごとの完全リロードは行わない）
    startRefresh(() => { router.refresh(); });
  }

  function handleStopAutoJudge() {
    // 現在送信中のバッチはサーバー側で処理が継続する可能性があるため中断しない
    // （成功済みの保存はそのまま残る）。次のバッチを送らないようにするだけ。
    autoStopRequestedRef.current = true;
    setAutoStatus('stopping');
  }

  const autoRunning = autoStatus === 'running' || autoStatus === 'stopping';
  const anyRunning = status === 'running' || autoRunning;

  return (
    <div className="flex flex-col gap-1">
      {/* flex-wrap: 結果テキストが長くなっても横はみ出しせず折り返す（スマートフォン幅対策） */}
      <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
        <button
          onClick={() => handleClick(false)}
          disabled={anyRunning}
          className="text-xs px-2 py-1 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {status === 'running' ? '⏳ 判定中...' : '🤖 AI判定 10件'}
        </button>
        <button
          onClick={() => handleClick(true)}
          disabled={anyRunning}
          className="text-xs px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
          title="AI判定済み商品を含めて再判定（プロンプト変更後に使用、保存済み商品のみ・最大10件）"
        >
          🔄 再判定
        </button>

        {!autoRunning ? (
          <button
            onClick={handleAutoJudge}
            disabled={anyRunning}
            className="text-xs px-2 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
            title="未判定が無くなるまで、10件ずつ自動的に判定を繰り返します"
          >
            ▶ 全件AI判定
          </button>
        ) : (
          <button
            onClick={handleStopAutoJudge}
            disabled={autoStatus === 'stopping'}
            className="text-xs px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {autoStatus === 'stopping' ? '停止処理中…' : '⏹ 停止'}
          </button>
        )}

        {/* 二重実行拒否（サーバー側ロック、409） */}
        {status === 'locked' && (
          <span className="text-xs text-amber-600 whitespace-nowrap">この人物のAI判定はすでに実行中です</span>
        )}

        {/* 正常完了（単発バッチ） */}
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
          const messageColor = result.failedCount > 0 ? 'text-amber-600' : 'text-green-600';
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
            </span>
          );
        })()}

        {/* エラー（単発バッチ） */}
        {status === 'error' && (
          <span className="text-xs text-red-500 max-w-[160px] truncate" title={errorMsg}>⚠ {errorMsg.slice(0, 40)}</span>
        )}

        {isRefreshing && <span className="text-xs text-gray-400">（画面更新中…）</span>}
      </div>

      {/* ── 全件AI判定の進捗表示 ─────────────────────────────────────────────── */}
      {autoStatus === 'locked' && (
        <span className="text-xs text-amber-600">この人物のAI判定はすでに実行中です</span>
      )}
      {autoStatus === 'error' && (
        <span className="text-xs text-red-500" title={autoErrorMsg}>⚠ 通信エラー: {autoErrorMsg.slice(0, 60)}</span>
      )}
      {autoProgress && (autoRunning || autoStatus === 'done') && (() => {
        const p = autoProgress;
        const processed = p.successSum + p.failedSum;
        const pct = p.totalAtStart > 0 ? Math.min(100, Math.round((processed / p.totalAtStart) * 100)) : 0;
        return (
          <div className="text-xs bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 space-y-1 max-w-md">
            {p.overLimitWarning && (
              <p className="text-orange-600 font-medium">
                ⚠ 対象が{MAX_AUTO_JUDGE_ITEMS}件を超えています（{p.totalAtStart}件）。処理に時間がかかります
              </p>
            )}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-indigo-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-indigo-700 font-medium whitespace-nowrap">{pct}%</span>
            </div>
            <p className="text-gray-600">
              {autoStatus === 'running' && '判定中… '}
              {autoStatus === 'stopping' && '停止処理中（現在のバッチ完了を待っています）… '}
              成功{p.successSum}・失敗{p.failedSum} / 全体{p.totalAtStart}件・残り{p.remainingCount}件
              （バッチ{p.batchesRun}回実行）
            </p>
            {autoStatus === 'done' && (
              <p className={p.stopReason === 'INSUFFICIENT_QUOTA' ? 'text-red-600 font-medium' : 'text-green-700 font-medium'}>
                {p.lastMessage ?? '処理が完了しました'}
              </p>
            )}
            {p.lastFailures.length > 0 && autoStatus === 'done' && <FailureDetails failures={p.lastFailures} />}
          </div>
        );
      })()}
    </div>
  );
}
