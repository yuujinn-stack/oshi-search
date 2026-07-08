'use client';

import { useEffect, useState } from 'react';

interface DbInfo {
  dbName?: string;
  urlHint?: string;
  vercelEnv?: string;
  error?: string;
}

interface PatchResult {
  ok?: boolean;
  error?: string;
  upserted?: number;
  published?: number;
  personMeta?: { inserted: number; errors: string[] };
  groupMeta?: { inserted: number; errors: string[] };
  errors?: string[];
  [key: string]: unknown;
}

interface StepState {
  status: 'idle' | 'running' | 'done' | 'error';
  result?: PatchResult;
}

const STEPS = [
  { key: 'persons',   label: 'persons（インポート人物）',         api: '/api/admin/db-patch-persons' },
  { key: 'providers', label: 'vod_providers（配信サービス）',     api: '/api/admin/db-patch-providers' },
  { key: 'meta',      label: 'person_meta + group_meta',         api: '/api/admin/db-patch-meta' },
  { key: 'works',     label: 'works（出演作品）',                 api: '/api/admin/db-patch-works' },
  { key: 'products',  label: 'products（楽天商品）',              api: '/api/admin/db-patch-products' },
  { key: 'verdicts',  label: 'verdicts（判定結果）',              api: '/api/admin/db-patch-verdicts' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

// Production / Preview 環境ではシードをブロック（本番DBへの誤投入防止）
const SEED_BLOCKED_ENVS = ['production', 'preview'];

export default function DbSeedPage() {
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [steps, setSteps] = useState<Partial<Record<StepKey, StepState>>>({});
  const [allRunning, setAllRunning] = useState(false);

  useEffect(() => {
    fetch('/api/admin/db-info')
      .then((r) => r.json())
      .then(setDbInfo)
      .catch(() => {});
  }, []);

  const isBlocked = dbInfo !== null && SEED_BLOCKED_ENVS.includes(dbInfo.vercelEnv ?? '');

  function setStep(key: StepKey, state: StepState) {
    setSteps((prev) => ({ ...prev, [key]: state }));
  }

  async function runStep(key: StepKey, api: string) {
    setStep(key, { status: 'running' });
    try {
      const res = await fetch(api, { method: 'POST' });
      const data: PatchResult = await res.json();
      setStep(key, { status: res.ok && data.ok !== false ? 'done' : 'error', result: data });
    } catch (e) {
      setStep(key, { status: 'error', result: { error: String(e) } });
    }
  }

  async function runAll() {
    setAllRunning(true);
    for (const step of STEPS) {
      await runStep(step.key, step.api);
    }
    setAllRunning(false);
  }

  function stepIcon(state?: StepState) {
    if (!state || state.status === 'idle') return '○';
    if (state.status === 'running') return '⟳';
    if (state.status === 'done') return '✓';
    return '✗';
  }

  function stepColor(state?: StepState) {
    if (!state || state.status === 'idle') return 'text-gray-400';
    if (state.status === 'running') return 'text-blue-500';
    if (state.status === 'done') return 'text-green-600';
    return 'text-red-500';
  }

  function resultSummary(key: StepKey, r?: PatchResult): string {
    if (!r) return '';
    if (r.error) return `エラー: ${r.error.slice(0, 100)}`;
    if (key === 'persons') return `upserted=${r.upserted} published=${r.published} errors=${r.errors?.length ?? 0}`;
    if (key === 'providers') return `upserted=${r.upserted} errors=${r.errors?.length ?? 0}`;
    if (key === 'meta') {
      const pm = r.personMeta as { inserted: number } | undefined;
      const gm = r.groupMeta as { inserted: number } | undefined;
      return `person_meta +${pm?.inserted ?? 0} / group_meta +${gm?.inserted ?? 0}`;
    }
    const ins = (r as Record<string, unknown>).totalInserted as number | undefined;
    const proc = (r as Record<string, unknown>).processed as number | undefined;
    if (ins !== undefined) return `inserted=${ins} processed=${proc ?? '?'}`;
    return JSON.stringify(r).slice(0, 80);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-1">DB シード（Redis → Neon DB）</h1>
      <p className="text-sm text-gray-500 mb-4">
        Neon DB が<strong>空の専用 DB</strong>（Production と別 DB）の場合のみ使用します。<br />
        Redis データを全量 upsert します。DROP / TRUNCATE は使いません。
      </p>

      {/* 接続先環境バナー */}
      {dbInfo && (
        <div className={`rounded p-3 mb-6 text-sm border ${
          isBlocked
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {isBlocked ? (
            <>
              <strong>🚫 シード無効 — {dbInfo.vercelEnv} 環境</strong><br />
              <span className="text-xs">
                接続先: <code className="font-mono">{dbInfo.urlHint}</code><br />
                Production と Preview が同じ DATABASE_URL を共有している可能性があります。<br />
                本番 DB への誤投入を防ぐため、production / preview 環境ではシードをブロックしています。<br />
                シードが必要な場合は、専用の Preview DB を作成して DATABASE_URL を差し替えてください。
              </span>
            </>
          ) : (
            <>
              <strong>✓ シード可能 — {dbInfo.vercelEnv ?? 'development'} 環境</strong><br />
              <span className="text-xs">接続先: <code className="font-mono">{dbInfo.urlHint}</code></span>
            </>
          )}
        </div>
      )}

      {/* 全ステップ実行 */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={runAll}
          disabled={allRunning || isBlocked}
          title={isBlocked ? 'production/preview 環境ではブロックされています' : undefined}
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {allRunning ? '実行中...' : '全テーブルをシード（順番実行）'}
        </button>
      </div>

      {/* ステップリスト */}
      <div className="space-y-3">
        {STEPS.map((step) => {
          const state = steps[step.key];
          return (
            <div key={step.key} className="border rounded p-3 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-sm ${stepColor(state)}`}>{stepIcon(state)}</span>
                  <span className="text-sm font-medium">{step.label}</span>
                </div>
                <button
                  onClick={() => runStep(step.key, step.api)}
                  disabled={state?.status === 'running' || allRunning || isBlocked}
                  className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  実行
                </button>
              </div>
              {state?.result && (
                <p className={`mt-1 text-xs ${state.status === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
                  {resultSummary(step.key, state.result)}
                </p>
              )}
              {state?.result?.errors && (state.result.errors as string[]).length > 0 && (
                <details className="mt-1">
                  <summary className="text-xs text-red-400 cursor-pointer">エラー詳細</summary>
                  <pre className="text-xs text-red-500 mt-1 whitespace-pre-wrap break-all">
                    {(state.result.errors as string[]).slice(0, 5).join('\n')}
                  </pre>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
