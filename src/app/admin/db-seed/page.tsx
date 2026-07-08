'use client';

import { useState } from 'react';

interface DbInfo {
  dbName?: string;
  urlHint?: string;
  error?: string;
}

interface PatchResult {
  ok?: boolean;
  error?: string;
  // persons
  upserted?: number;
  published?: number;
  // providers
  // meta
  personMeta?: { inserted: number; errors: string[] };
  groupMeta?: { inserted: number; errors: string[] };
  // generic
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
  { key: 'works',     label: 'works（出演作品 / 人物ごとに実行）', api: '/api/admin/db-patch-works' },
  { key: 'products',  label: 'products（楽天商品）',              api: '/api/admin/db-patch-products' },
  { key: 'verdicts',  label: 'verdicts（判定結果）',              api: '/api/admin/db-patch-verdicts' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

export default function DbSeedPage() {
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [steps, setSteps] = useState<Partial<Record<StepKey, StepState>>>({});
  const [allRunning, setAllRunning] = useState(false);

  async function fetchDbInfo() {
    const res = await fetch('/api/admin/db-info');
    setDbInfo(await res.json());
  }

  function setStep(key: StepKey, state: StepState) {
    setSteps((prev) => ({ ...prev, [key]: state }));
  }

  async function runStep(key: StepKey, api: string) {
    setStep(key, { status: 'running' });
    try {
      const res = await fetch(api, { method: 'POST' });
      const data: PatchResult = await res.json();
      setStep(key, { status: data.ok === false ? 'error' : 'done', result: data });
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
    if (!state) return '○';
    if (state.status === 'running') return '⟳';
    if (state.status === 'done') return '✓';
    if (state.status === 'error') return '✗';
    return '○';
  }

  function stepColor(state?: StepState) {
    if (!state) return 'text-gray-400';
    if (state.status === 'running') return 'text-blue-500';
    if (state.status === 'done') return 'text-green-600';
    if (state.status === 'error') return 'text-red-500';
    return 'text-gray-400';
  }

  function resultSummary(key: StepKey, r?: PatchResult): string {
    if (!r) return '';
    if (r.error) return `エラー: ${r.error}`;
    if (key === 'persons') return `upserted=${r.upserted} published=${r.published} errors=${r.errors?.length ?? 0}`;
    if (key === 'providers') return `upserted=${r.upserted} errors=${r.errors?.length ?? 0}`;
    if (key === 'meta') {
      const pm = r.personMeta as { inserted: number; errors: string[] } | undefined;
      const gm = r.groupMeta as { inserted: number; errors: string[] } | undefined;
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
      <p className="text-sm text-gray-500 mb-6">
        Preview / Production の Neon DB が空の場合に Redis のデータを全量投入します。<br />
        Redis が正本のまま維持され、既存 DB 行は上書きされます（DROP/TRUNCATE なし）。
      </p>

      {/* DB 接続先確認 */}
      <div className="bg-gray-50 border rounded p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">接続先 DB</h2>
          <button
            onClick={fetchDbInfo}
            className="text-xs px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
          >
            確認
          </button>
        </div>
        {dbInfo ? (
          dbInfo.error ? (
            <p className="text-xs text-red-500">{dbInfo.error}</p>
          ) : (
            <div className="text-xs space-y-1">
              <div><span className="text-gray-500">DB名:</span> <code className="font-mono">{dbInfo.dbName}</code></div>
              <div><span className="text-gray-500">接続先:</span> <code className="font-mono break-all">{dbInfo.urlHint}</code></div>
              <p className="text-gray-400 mt-1">
                Production と同じ DB 名・ホストであれば同一 DB です。異なる場合は別 DB（Preview 専用）です。
              </p>
            </div>
          )
        ) : (
          <p className="text-xs text-gray-400">「確認」を押してください</p>
        )}
      </div>

      {/* 全ステップ実行ボタン */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={runAll}
          disabled={allRunning}
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
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
                  disabled={state?.status === 'running' || allRunning}
                  className="text-xs px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
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
                  <pre className="text-xs text-red-500 mt-1 whitespace-pre-wrap">
                    {(state.result.errors as string[]).slice(0, 5).join('\n')}
                  </pre>
                </details>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400 mt-6">
        works は人物数×件数が多いため時間がかかる場合があります。タイムアウトした場合は個別実行を繰り返してください。
      </p>
    </div>
  );
}
