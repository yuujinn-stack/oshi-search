'use client';

import { useState } from 'react';

interface Props {
  personNames: string[];
}

interface Summary {
  ok: boolean;
  elapsed: string;
  personCount: number;
  totalStored: number;
  totalAutoClassified: number;
  totalAiJudged: number;
  errors: Array<{ name: string; error: string }>;
  error?: string;
  needsRelogin?: boolean;
}

export default function BatchButton({ personNames }: Props) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, currentName: '' });
  const [summary, setSummary] = useState<Summary | null>(null);

  async function handleRun() {
    if (
      !confirm(
        `全${personNames.length}人分の商品取得とAI判定を実行します。\n完了まで数分かかります。よろしいですか？`,
      )
    )
      return;

    setRunning(true);
    setSummary(null);
    setProgress({ current: 0, total: personNames.length, currentName: '' });

    let stored = 0;
    let autoClassified = 0;
    let aiJudged = 0;
    const errors: Array<{ name: string; error: string }> = [];
    const startedAt = Date.now();

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
              totalAutoClassified: 0,
              totalAiJudged: 0,
              errors: [],
              error: 'セッションが切れました。一度ログアウトして再ログインしてください。',
              needsRelogin: true,
            });
            setRunning(false);
            return;
          }

          // Redis 未設定など全件に影響するエラー → 即中断
          if (res.status === 503) {
            setSummary({
              ok: false,
              elapsed: '',
              personCount: 0,
              totalStored: 0,
              totalAutoClassified: 0,
              totalAiJudged: 0,
              errors: [],
              error: errData.error,
            });
            setRunning(false);
            return;
          }

          errors.push({ name, error: errData.error ?? `HTTP ${res.status}` });
          continue;
        }

        const data = await res.json();
        if (data.person) {
          stored += data.person.stored ?? 0;
          autoClassified += data.person.autoClassified ?? 0;
          aiJudged += data.person.aiJudged ?? 0;
          if (data.person.error) errors.push({ name, error: data.person.error });
        }
      } catch (err) {
        errors.push({ name, error: String(err) });
      }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    setSummary({
      ok: true,
      elapsed: `${elapsed}秒`,
      personCount: personNames.length,
      totalStored: stored,
      totalAutoClassified: autoClassified,
      totalAiJudged: aiJudged,
      errors,
    });
    setRunning(false);

    // 何か保存できた場合のみリロード（エラーのみの場合はリロードしない）
    if (stored > 0) {
      setTimeout(() => window.location.reload(), 2000);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2 flex-shrink-0">
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
              自動判定 {summary.totalAutoClassified}件 / AI判定 {summary.totalAiJudged}件
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
                  <a href="/api/admin/logout" className="underline font-bold">
                    ログアウトする
                  </a>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
