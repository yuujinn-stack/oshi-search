'use client';

import { useState, useEffect } from 'react';

interface WorkStat {
  id: string;
  title: string;
  type: string;
  releaseYear?: number;
  vodProviderCount: number;
  lastVodCheckAt?: number;
  vodCheckStatus?: string;
  sources: string[];
}

interface IntensiveStats {
  personName: string;
  totalEligible: number;
  totalAll: number;
  withVod: number;
  withoutVod: number;
  csvOnly: number;
  aiChecked: number;
  works: WorkStat[];
}

interface Props {
  personName: string;
  onClose: () => void;
  onDone?: () => void;
}

type Phase = 'loading' | 'confirm' | 'executing' | 'done' | 'error';

export default function VodIntensiveModal({ personName, onClose, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [stats, setStats] = useState<IntensiveStats | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [doneResult, setDoneResult] = useState<{
    total: number;
    checked: number;
    errors: number;
  } | null>(null);

  useEffect(() => {
    fetch(`/api/admin/vod-person-recheck?person=${encodeURIComponent(personName)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setStats(data as IntensiveStats);
        setPhase('confirm');
      })
      .catch((err: Error) => {
        setErrorMsg(String(err));
        setPhase('error');
      });
  }, [personName]);

  async function handleExecute() {
    setPhase('executing');
    try {
      const res = await fetch('/api/admin/vod-person-recheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        totalTargets: number;
        checkedCount: number;
        errorCount: number;
      };
      setDoneResult({
        total: data.totalTargets,
        checked: data.checkedCount,
        errors: data.errorCount,
      });
      setPhase('done');
      onDone?.();
    } catch (err) {
      setErrorMsg(String(err));
      setPhase('error');
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-slate-800">🎯 重点配信確認</h2>
            <p className="text-sm text-violet-600 font-medium mt-0.5">{personName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">
            ✕
          </button>
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {phase === 'loading' && (
            <p className="text-center text-gray-400 py-12">作品情報を読み込み中...</p>
          )}

          {phase === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              <p className="font-semibold mb-1">読み込みに失敗しました</p>
              <p className="text-xs font-mono">{errorMsg}</p>
            </div>
          )}

          {phase === 'confirm' && stats && (
            <div className="space-y-5">
              {/* サマリーカード */}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {[
                  { label: '対象（全件）', value: stats.totalEligible, accent: true },
                  { label: '全作品数', value: stats.totalAll },
                  { label: '配信あり', value: stats.withVod },
                  { label: '配信なし', value: stats.withoutVod },
                  { label: 'CSV登録のみ', value: stats.csvOnly },
                  { label: 'AI確認済み', value: stats.aiChecked },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`p-3 rounded-xl text-center ${
                      item.accent
                        ? 'bg-violet-50 border border-violet-200'
                        : 'bg-gray-50'
                    }`}
                  >
                    <div
                      className={`text-xl font-black ${
                        item.accent ? 'text-violet-700' : 'text-slate-700'
                      }`}
                    >
                      {item.value}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>

              {/* 実行内容説明 */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 space-y-1">
                <p className="font-semibold text-amber-900 mb-1.5">実行内容（条件で除外しません）</p>
                <p>• 配信情報あり {stats.withVod}件 → AI再確認（180日以内でも実行）</p>
                <p>• 配信情報なし {stats.withoutVod}件 → AI初回調査</p>
                <p className="text-amber-600 mt-2">
                  ⚠️ OpenAI APIを {stats.totalEligible}件分使用します。完了まで数分かかります。
                </p>
              </div>

              {/* 対象作品一覧 */}
              {stats.works.length > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 border-b border-gray-200">
                    対象作品一覧（{stats.works.length}件）
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr className="text-gray-500">
                          <th className="text-left p-2 border-b border-gray-100 font-medium">作品名</th>
                          <th className="text-left p-2 border-b border-gray-100 font-medium">種別</th>
                          <th className="text-right p-2 border-b border-gray-100 font-medium">配信</th>
                          <th className="text-left p-2 border-b border-gray-100 font-medium">最終確認</th>
                          <th className="text-left p-2 border-b border-gray-100 font-medium">ステータス</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.works.map((w) => (
                          <tr key={w.id} className="hover:bg-gray-50">
                            <td className="p-2 border-b border-gray-100 text-slate-700">
                              {w.title}
                              {w.releaseYear && (
                                <span className="text-gray-400 ml-1 text-[10px]">
                                  {w.releaseYear}
                                </span>
                              )}
                            </td>
                            <td className="p-2 border-b border-gray-100 text-gray-500">
                              {w.type === 'movie' ? '映画' : 'ドラマ'}
                            </td>
                            <td className="p-2 border-b border-gray-100 text-right">
                              {w.vodProviderCount > 0 ? (
                                <span className="text-teal-600 font-medium">{w.vodProviderCount}件</span>
                              ) : (
                                <span className="text-gray-400">なし</span>
                              )}
                            </td>
                            <td className="p-2 border-b border-gray-100 text-gray-400 text-[10px]">
                              {w.lastVodCheckAt
                                ? new Date(w.lastVodCheckAt).toLocaleDateString('ja-JP', {
                                    month: 'short',
                                    day: 'numeric',
                                  })
                                : '未確認'}
                            </td>
                            <td className="p-2 border-b border-gray-100">
                              {w.vodCheckStatus === 'checked' && (
                                <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded">確認済</span>
                              )}
                              {w.vodCheckStatus === 'needs_recheck' && (
                                <span className="text-[10px] bg-yellow-100 text-yellow-600 px-1.5 py-0.5 rounded">要確認</span>
                              )}
                              {w.vodCheckStatus === 'failed' && (
                                <span className="text-[10px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded">失敗</span>
                              )}
                              {(!w.vodCheckStatus || w.vodCheckStatus === 'fresh' || w.vodCheckStatus === 'checking') && (
                                <span className="text-[10px] text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {stats.totalEligible === 0 && (
                <p className="text-center text-sm text-gray-400 py-4">
                  対象作品がありません（公開中かつ tmdbId ありの作品がありません）
                </p>
              )}
            </div>
          )}

          {phase === 'executing' && (
            <div className="text-center py-12 space-y-4">
              <div className="text-5xl animate-pulse">🔍</div>
              <p className="text-slate-700 font-semibold">AI再確認を実行中...</p>
              <p className="text-xs text-gray-500">
                {stats?.totalEligible}件の作品をOpenAI Web検索で順番に確認しています。
                <br />
                完了まで数分かかります。このタブを閉じないでください。
              </p>
            </div>
          )}

          {phase === 'done' && doneResult && (
            <div className="text-center py-10 space-y-5">
              <div className="text-5xl">✅</div>
              <p className="text-xl font-bold text-slate-800">完了しました</p>
              <div className="grid grid-cols-3 gap-3 max-w-xs mx-auto">
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                  <div className="text-2xl font-black text-green-700">{doneResult.checked}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">確認完了</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                  <div className="text-2xl font-black text-slate-700">{doneResult.total}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">対象合計</div>
                </div>
                <div
                  className={`rounded-xl p-3 text-center border ${
                    doneResult.errors > 0
                      ? 'bg-red-50 border-red-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div
                    className={`text-2xl font-black ${
                      doneResult.errors > 0 ? 'text-red-600' : 'text-gray-400'
                    }`}
                  >
                    {doneResult.errors}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">エラー</div>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                作品一覧を更新すると最新の配信情報が表示されます。
              </p>
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
          >
            {phase === 'done' ? '閉じる' : 'キャンセル'}
          </button>
          {phase === 'confirm' && stats && stats.totalEligible > 0 && (
            <button
              onClick={handleExecute}
              className="text-sm px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-semibold transition-colors"
            >
              🎯 {stats.totalEligible}件すべて確認実行
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
