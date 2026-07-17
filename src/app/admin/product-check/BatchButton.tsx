'use client';

import { useState, useRef, useEffect } from 'react';
import { LogoutButton } from '@/components/admin/LogoutButton';

interface Props {
  personNames: string[];
}

interface Summary {
  ok: boolean;
  elapsed: string;
  personCount: number;
  totalStored: number;
  totalAiJudged: number;
  errors: Array<{ name: string; error: string }>;
  error?: string;
  needsRelogin?: boolean;
}

interface LockStatus {
  isLocked: boolean;
  ownerId: string | null;
  acquiredAt: string | null;
}

// 一括実行ロックAPIを呼ぶ共通関数
async function callBatchLock(body: {
  action: 'acquire' | 'heartbeat' | 'release';
  ownerId: string;
  status?: 'completed' | 'failed';
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/admin/batch-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'ロックAPIへの接続失敗' };
  }
}

export default function BatchButton({ personNames }: Props) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentName: '' });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lockStatus, setLockStatus] = useState<LockStatus | null>(null);

  const ownerIdRef = useRef('');
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // マウント時にロック状態を確認（別タブで実行中かどうかを表示するため）
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/batch-lock')
      .then((r) => r.json())
      .then((data: { isLocked: boolean; ownerId: string | null; acquiredAt: string | null }) => {
        if (!cancelled) setLockStatus(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function stopHeartbeat() {
    if (heartbeatTimerRef.current !== null) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }

  async function releaseLock(status: 'completed' | 'failed') {
    stopHeartbeat();
    if (ownerIdRef.current) {
      await callBatchLock({ action: 'release', ownerId: ownerIdRef.current, status });
      ownerIdRef.current = '';
      setLockStatus({ isLocked: false, ownerId: null, acquiredAt: null });
    }
  }

  async function handleRun() {
    if (
      !confirm(
        `全${personNames.length}人分の商品取得とAI判定を実行します。\n完了まで数分かかります。よろしいですか？`,
      )
    )
      return;

    // ロック取得
    const ownerId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ownerIdRef.current = ownerId;

    const acquireResult = await callBatchLock({ action: 'acquire', ownerId });
    if (!acquireResult.ok) {
      setSummary({
        ok: false,
        elapsed: '',
        personCount: 0,
        totalStored: 0,
        totalAiJudged: 0,
        errors: [],
        error: acquireResult.error ?? '別の一括実行が進行中です。完了後に再実行してください。',
      });
      ownerIdRef.current = '';
      return;
    }

    setLockStatus({ isLocked: true, ownerId, acquiredAt: new Date().toISOString() });

    // 30秒ごとにハートビートを送り続ける（expires_at を延長）
    heartbeatTimerRef.current = setInterval(() => {
      callBatchLock({ action: 'heartbeat', ownerId }).catch(() => {});
    }, 30_000);

    setRunning(true);
    setSummary(null);
    setProgress({ current: 0, total: personNames.length, currentName: '' });

    let stored = 0;
    let aiJudged = 0;
    const errors: Array<{ name: string; error: string }> = [];
    const startedAt = Date.now();
    let aborted = false;

    try {
      for (let i = 0; i < personNames.length; i++) {
        const name = personNames[i];
        setProgress({ current: i + 1, total: personNames.length, currentName: name });

        try {
          const res = await fetch('/api/admin/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personName: name }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));

            // 認証エラー → ログアウトして再ログインが必要
            if (res.status === 401) {
              setSummary({
                ok: false,
                elapsed: '',
                personCount: 0,
                totalStored: 0,
                totalAiJudged: 0,
                errors: [],
                error: 'セッションが切れました。一度ログアウトして再ログインしてください。',
                needsRelogin: true,
              });
              aborted = true;
              return;
            }

            // Redis 未設定など全件に影響するエラー → 即中断
            if (res.status === 503) {
              setSummary({
                ok: false,
                elapsed: '',
                personCount: 0,
                totalStored: 0,
                totalAiJudged: 0,
                errors: [],
                error: errData.error,
              });
              aborted = true;
              return;
            }

            errors.push({ name, error: errData.error ?? `HTTP ${res.status}` });
            continue;
          }

          const data = await res.json();
          if (data.person) {
            stored += data.person.stored ?? 0;
            aiJudged += data.person.aiJudged ?? 0;
            if (data.person.error) errors.push({ name, error: data.person.error });
          }
        } catch (err) {
          errors.push({ name, error: String(err) });
        }

        // processAllPersons() の300ms待機と同じ間隔を維持（楽天API 429連鎖防止）
        if (i < personNames.length - 1) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      setSummary({
        ok: true,
        elapsed: `${elapsed}秒`,
        personCount: personNames.length,
        totalStored: stored,
        totalAiJudged: aiJudged,
        errors,
      });

      // 何か保存できた場合のみリロード（エラーのみの場合はリロードしない）
      if (stored > 0) {
        setTimeout(() => window.location.reload(), 2000);
      }
    } finally {
      setRunning(false);
      await releaseLock(aborted || errors.length > 0 ? 'failed' : 'completed');
    }
  }

  const isLockedByOther = lockStatus?.isLocked && lockStatus.ownerId !== ownerIdRef.current;

  return (
    <div className="flex flex-col items-end gap-2 flex-shrink-0">
      {/* 別タブ/別ブラウザで実行中の場合は警告を表示 */}
      {isLockedByOther && !running && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 text-right">
          ⚠ 別セッションで一括実行が進行中です
        </p>
      )}

      <button
        onClick={handleRun}
        disabled={running}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
      >
        {running ? '⏳ 処理中...' : '▶ 今すぐ実行'}
      </button>

      {running && (
        <div className="text-xs text-indigo-600 text-right">
          <p className="animate-pulse font-medium">
            {progress.current}/{progress.total}人目: {progress.currentName}
          </p>
          <p className="text-indigo-400">楽天API取得 + AI判定中...</p>
        </div>
      )}

      {summary && (
        <div
          className={`text-xs rounded-lg px-3 py-2 max-w-xs text-right ${
            summary.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {summary.ok ? (
            <>
              完了 ({summary.elapsed})
              <br />
              {summary.personCount}人 / 商品{summary.totalStored}件取得
              <br />
              AI判定 {summary.totalAiJudged}件
              {summary.errors.length > 0 && (
                <>
                  <br />
                  エラー: {summary.errors.map((e) => e.name).join(', ')}
                </>
              )}
            </>
          ) : (
            <>
              {summary.error ?? 'エラーが発生しました'}
              {summary.needsRelogin && (
                <>
                  <br />
                  <LogoutButton className="underline font-bold">
                    ログアウトする
                  </LogoutButton>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
