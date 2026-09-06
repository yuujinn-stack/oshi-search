'use client';

import { useRef, useState } from 'react';
import { MAX_EXCLUDE_PRODUCT_IDS } from '@/lib/ai-judge-constants';
import type { ProductCategory } from '@/types/person';

// 'config_missing': API設定不足で503が返った
// 'rate_limited': 楽天API 429 Too Many Requests
// 'locked': 同じ人物の楽天再取得が既に実行中（409）
// 'done': 正常完了（0件含む）
// 'error': その他エラー
type Status = 'idle' | 'running' | 'done' | 'error' | 'config_missing' | 'rate_limited' | 'locked';

// 楽天取得は6カテゴリを1カテゴリずつ別HTTPリクエストで順番に実行する
// （src/lib/product-store.ts の CATEGORIES と同じ並び順・同じ6件。
//  CATEGORIESはdb importを含むためクライアントコンポーネントからは直接importできず、
//  ここでは同じ値をリテラルとして保持している）。
const FETCH_CATEGORIES: ProductCategory[] = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'];

interface CategoryApiResult {
  stored: number;
  autoApproved: number;
  skipped: number;
  excluded: number;
  usedSuppressed: number;
  membershipFiltered: number;
  pendingAiJudge: number;
}

interface AiFailureDetail {
  productId: string;
  code: string;
}

interface AiBatchResult {
  noStoredProducts: boolean;
  totalUnclassifiedBefore: number;
  successCount: number;
  failedCount: number;
  remainingCount: number;
  aiKeyMissing: boolean;
  aiFailures: AiFailureDetail[];
  stopProcessing: boolean;
  stopReason?: 'COMPLETED' | 'FAILED_ITEMS_REMAIN' | 'INSUFFICIENT_QUOTA' | 'AI_KEY_MISSING';
  message?: string;
}

interface Aggregate {
  stored: number;
  autoApproved: number;
  skipped: number;
  excluded: number;
  usedSuppressed: number;
  membershipFiltered: number;
  aiJudged: number;
  aiFailed: number;
}

function emptyAggregate(): Aggregate {
  return { stored: 0, autoApproved: 0, skipped: 0, excluded: 0, usedSuppressed: 0, membershipFiltered: 0, aiJudged: 0, aiFailed: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 全件AI判定（PersonAiJudgeButton.tsx）と同じ安全弁: successCountが0のバッチが
// この回数連続したら、サーバー側のstopProcessingとは別にクライアント側でも停止する
const MAX_CONSECUTIVE_EMPTY_BATCHES = 2;
const AI_BATCH_INTERVAL_MS = 400;

export default function PersonRakutenFetchButton({ personName }: { personName: string }) {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [errorCategory, setErrorCategory] = useState<ProductCategory | null>(null);
  // 進捗表示用: '楽天取得中 2/6：本・雑誌' / 'AI判定中：30件完了' 等
  const [progressLabel, setProgressLabel] = useState('');
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);

  const busyRef = useRef(false);
  // 成功済みカテゴリを記録し、エラー後の再実行で最初からやり直さず続きから再開できるようにする。
  // 前回が正常完了(done)していた場合のみ、次回クリックで新しい実行として空にリセットする。
  const completedCategoriesRef = useRef<Set<ProductCategory>>(new Set());
  const aggregateRef = useRef<Aggregate>(emptyAggregate());

  async function fetchOneCategory(category: ProductCategory): Promise<
    | { ok: true; person: CategoryApiResult }
    | { ok: false; locked: true }
    | { ok: false; locked: false; status: string; error: string }
  > {
    const res = await fetch('/api/admin/rakuten-refetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, category, forceRejudge: false }),
    });

    // Vercel Functionのタイムアウト等でサーバーがJSON以外を返すことがあるため、
    // res.json()の前にcontent-typeを確認する（非JSON応答でもSyntaxErrorにしない）。
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const text = await res.text().catch(() => '');
      return { ok: false, locked: false, status: 'non_json_response', error: `サーバーエラー (HTTP ${res.status}): ${text.slice(0, 100) || '応答が空です'}` };
    }

    const data = await res.json().catch(() => ({}));
    if (res.status === 409) return { ok: false, locked: true };
    if (!res.ok || !data.ok) return { ok: false, locked: false, status: data.status ?? 'error', error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, person: data.person as CategoryApiResult };
  }

  async function runOneAiBatch(excludeProductIds: string[]): Promise<
    | { ok: true; person: AiBatchResult }
    | { ok: false; locked: true }
    | { ok: false; locked: false; error: string }
  > {
    const res = await fetch('/api/admin/ai-judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personName,
        forceRejudge: false,
        excludeProductIds: excludeProductIds.slice(0, MAX_EXCLUDE_PRODUCT_IDS),
      }),
    });

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const text = await res.text().catch(() => '');
      return { ok: false, locked: false, error: `サーバーエラー (HTTP ${res.status}): ${text.slice(0, 100) || '応答が空です'}` };
    }

    const data = await res.json().catch(() => ({}));
    if (res.status === 409) return { ok: false, locked: true };
    if (!res.ok || !data.ok) return { ok: false, locked: false, error: data.error ?? `HTTP ${res.status}` };
    return { ok: true, person: data.person as AiBatchResult };
  }

  async function handleClick() {
    if (busyRef.current) return; // 二重クリック防止
    if (!confirm(`「${personName}」の楽天商品を再取得します。\n既存の判定（AI・手動）は保持されます。`)) return;
    if (busyRef.current) return;

    busyRef.current = true;

    // 前回が正常完了(done)・未実行(idle)の場合のみ、新しい実行として最初からやり直す。
    // 前回がエラーで終わっていた場合は、成功済みカテゴリをスキップして続きから再開する。
    if (status !== 'error' && status !== 'locked' && status !== 'rate_limited') {
      completedCategoriesRef.current = new Set();
      aggregateRef.current = emptyAggregate();
    }

    setStatus('running');
    setErrorMsg('');
    setErrorCategory(null);
    setAggregate(null);

    // ── フェーズ1: 楽天取得（6カテゴリを1つずつ順番に） ──────────────────────
    for (let i = 0; i < FETCH_CATEGORIES.length; i++) {
      const category = FETCH_CATEGORIES[i];
      if (completedCategoriesRef.current.has(category)) continue; // 再実行時は成功済みをスキップ

      setProgressLabel(`楽天取得中 ${i + 1}/${FETCH_CATEGORIES.length}：${category}`);

      let outcome;
      try {
        outcome = await fetchOneCategory(category);
      } catch (err) {
        busyRef.current = false;
        setErrorCategory(category);
        setErrorMsg(String(err));
        setStatus('error');
        return;
      }

      if (!outcome.ok) {
        busyRef.current = false;
        setErrorCategory(category);
        if (outcome.locked) {
          setStatus('locked');
        } else if (outcome.status === 'config_missing') {
          setStatus('config_missing');
        } else if (outcome.status === 'rate_limited') {
          setErrorMsg(`楽天APIが一時的な利用制限中です（${category}）`);
          setStatus('rate_limited');
        } else {
          setErrorMsg(`${category}: ${outcome.error}`);
          setStatus('error');
        }
        return;
      }

      completedCategoriesRef.current.add(category);
      const p = outcome.person;
      aggregateRef.current = {
        ...aggregateRef.current,
        stored: aggregateRef.current.stored + p.stored,
        autoApproved: aggregateRef.current.autoApproved + p.autoApproved,
        skipped: aggregateRef.current.skipped + p.skipped,
        excluded: aggregateRef.current.excluded + p.excluded,
        usedSuppressed: aggregateRef.current.usedSuppressed + p.usedSuppressed,
        membershipFiltered: aggregateRef.current.membershipFiltered + p.membershipFiltered,
      };
    }

    // ── フェーズ2: AI判定（既存 /api/admin/ai-judge を10件ずつ繰り返し呼ぶ） ──────
    // AI判定ロジック・プロンプト・バッチサイズ自体は一切変更せず、既存の
    // 「全件AI判定」（PersonAiJudgeButton.tsx）と同じ継続呼び出しパターンを再利用する。
    const excludeProductIds: string[] = [];
    let consecutiveEmptyBatches = 0;
    let aiJudged = 0;
    let aiFailed = 0;

    while (true) {
      setProgressLabel(`AI判定中：${aiJudged}件完了`);

      let outcome;
      try {
        outcome = await runOneAiBatch(excludeProductIds);
      } catch (err) {
        busyRef.current = false;
        setErrorMsg(`AI判定: ${String(err)}`);
        setStatus('error');
        return;
      }

      if (!outcome.ok) {
        busyRef.current = false;
        if (outcome.locked) {
          setStatus('locked');
        } else {
          setErrorMsg(`AI判定: ${outcome.error}`);
          setStatus('error');
        }
        return;
      }

      const p = outcome.person;
      if (p.noStoredProducts || p.totalUnclassifiedBefore === 0) break; // 未判定なし = 完了

      aiJudged += p.successCount;
      aiFailed += p.failedCount;
      setProgressLabel(`AI判定中：${aiJudged}件完了`);

      for (const f of p.aiFailures) {
        if (excludeProductIds.length >= MAX_EXCLUDE_PRODUCT_IDS) break;
        if (!excludeProductIds.includes(f.productId)) excludeProductIds.push(f.productId);
      }

      if (p.stopProcessing) break;

      if (p.successCount === 0) {
        consecutiveEmptyBatches++;
        if (consecutiveEmptyBatches >= MAX_CONSECUTIVE_EMPTY_BATCHES) break;
      } else {
        consecutiveEmptyBatches = 0;
      }

      await sleep(AI_BATCH_INTERVAL_MS);
    }

    aggregateRef.current = { ...aggregateRef.current, aiJudged, aiFailed };
    setAggregate(aggregateRef.current);
    setProgressLabel('楽天再取得完了');
    setStatus('done');
    busyRef.current = false;
  }

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
      <button
        onClick={handleClick}
        disabled={status === 'running'}
        className="text-xs px-2 py-1 bg-teal-100 hover:bg-teal-200 text-teal-700 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        title="楽天APIから商品を再取得して保存（既存の判定は保持）。カテゴリごと・AI判定バッチごとに分割して実行します"
      >
        {status === 'running' ? '⏳ 取得中...' : '🔃 楽天再取得'}
      </button>

      {/* 進捗表示（実行中のみ） */}
      {status === 'running' && progressLabel && (
        <span className="text-xs text-teal-600 whitespace-nowrap">{progressLabel}</span>
      )}

      {/* API設定不足 — 専用表示 */}
      {status === 'config_missing' && (
        <span className="text-xs text-orange-600 whitespace-nowrap font-medium" title="RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY が未設定です">
          ⚠ API設定不足
        </span>
      )}

      {/* 429 レート制限 */}
      {status === 'rate_limited' && (
        <span className="text-xs text-amber-600 whitespace-nowrap" title="HTTP 429 Too Many Requests — しばらく時間を置いてから再実行してください（成功済みカテゴリはスキップされます）">
          ⏳ 利用制限中{errorCategory ? `（${errorCategory}）` : ''} — しばらく待ってから再実行してください
        </span>
      )}

      {/* サーバー側ロック（同一人物の同時実行） */}
      {status === 'locked' && (
        <span className="text-xs text-amber-600 whitespace-nowrap">この人物の楽天再取得はすでに実行中です</span>
      )}

      {/* 正常完了 */}
      {status === 'done' && aggregate && (() => {
        if (aggregate.stored === 0 && aggregate.skipped === 0) {
          return <span className="text-xs text-gray-400 whitespace-nowrap">API正常・0件</span>;
        }
        return (
          <span className="text-xs whitespace-nowrap flex items-center gap-1.5">
            <span className="text-teal-600 font-medium">取得{aggregate.stored}</span>
            {aggregate.skipped > 0 && <span className="text-gray-400">判定済skip{aggregate.skipped}</span>}
            {aggregate.excluded > 0 && <span className="text-orange-500">除外KW{aggregate.excluded}</span>}
            {aggregate.usedSuppressed > 0 && <span className="text-blue-500">中古抑制{aggregate.usedSuppressed}</span>}
            {aggregate.autoApproved > 0 && <span className="text-blue-600">自動承認{aggregate.autoApproved}</span>}
            <span className={aggregate.aiFailed > 0 ? 'text-red-500' : 'text-green-600'}>
              AI判定{aggregate.aiJudged}
              {aggregate.aiFailed > 0 && ` (失敗${aggregate.aiFailed})`}
            </span>
          </span>
        );
      })()}

      {/* エラー（どのカテゴリで失敗したかを明示） */}
      {status === 'error' && (
        <span className="text-xs text-red-500 max-w-[220px] truncate" title={errorMsg}>
          ⚠ {errorCategory ? `[${errorCategory}] ` : ''}{errorMsg.slice(0, 60)}
        </span>
      )}
    </div>
  );
}
