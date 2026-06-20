'use client';

import { useState } from 'react';

interface RecheckTarget {
  personName: string;
  workId: string;
  workTitle: string;
  workType: string;
  releaseYear?: number;
  reason: string;
  lastVodCheckAt?: number;
  vodProviderCount: number;
  vodCheckStatus?: string;
  priorityRecheck?: boolean;
}

export default function VodRecheckSection() {
  const [targets, setTargets] = useState<RecheckTarget[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function loadTargets() {
    setLoading(true);
    const res = await fetch('/api/admin/vod-recheck');
    if (res.ok) {
      const data = (await res.json()) as { targets: RecheckTarget[]; total: number };
      setTargets(data.targets);
    }
    setLoading(false);
  }

  async function handleToggle() {
    if (!open && !targets) await loadTargets();
    setOpen((v) => !v);
  }

  return (
    <div className="border border-violet-200 rounded-xl overflow-hidden mb-6">
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-violet-50 hover:bg-violet-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-violet-800">🔍 配信情報 再確認対象一覧</span>
          {targets !== null && (
            <span className="text-xs bg-violet-200 text-violet-700 px-2 py-0.5 rounded-full font-medium">
              {targets.length}件
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-violet-500">Cronが毎日自動確認 / 優先フラグで先行処理</span>
          <span className="text-gray-400 text-xs ml-1">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="p-4 bg-white">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-4">読み込み中...</p>
          ) : targets === null ? (
            <p className="text-sm text-gray-400 text-center py-4">一覧を取得できませんでした</p>
          ) : targets.length === 0 ? (
            <p className="text-sm text-green-600 text-center py-4">
              再確認が必要な作品はありません ✓
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-3">
                以下は作品単位の条件（配信情報未取得・180日以上未確認・優先フラグ）に該当する作品です。
                次回 Cron 実行時（毎日 05:00 UTC）に上限 <code>VOD_RECHECK_LIMIT</code>（デフォルト20件）まで処理されます。
                <span className="ml-1 text-violet-600 font-medium">※ 重点確認フラグが設定された人物の全作品は別途すべて処理されます。</span>
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500">
                      <th className="text-left p-2 border border-gray-100">人物</th>
                      <th className="text-left p-2 border border-gray-100">作品</th>
                      <th className="text-left p-2 border border-gray-100">再確認理由</th>
                      <th className="text-left p-2 border border-gray-100">配信件数</th>
                      <th className="text-left p-2 border border-gray-100">最終確認</th>
                      <th className="text-left p-2 border border-gray-100">ステータス</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map((t) => (
                      <tr key={`${t.personName}-${t.workId}`} className="hover:bg-gray-50">
                        <td className="p-2 border border-gray-100 font-medium text-slate-700">
                          {t.personName}
                          {t.priorityRecheck && (
                            <span className="ml-1 text-[9px] bg-red-100 text-red-600 px-1 py-0.5 rounded">優先</span>
                          )}
                        </td>
                        <td className="p-2 border border-gray-100">
                          <span className="text-slate-700">{t.workTitle}</span>
                          <span className="text-gray-400 ml-1 text-[10px]">
                            {t.workType === 'movie' ? '映画' : 'ドラマ'}
                            {t.releaseYear ? ` ${t.releaseYear}` : ''}
                          </span>
                        </td>
                        <td className="p-2 border border-gray-100 text-violet-600">{t.reason}</td>
                        <td className="p-2 border border-gray-100 text-center">
                          {t.vodProviderCount > 0 ? (
                            <span className="text-teal-600">{t.vodProviderCount}件</span>
                          ) : (
                            <span className="text-gray-400">なし</span>
                          )}
                        </td>
                        <td className="p-2 border border-gray-100 text-gray-400 text-[10px]">
                          {t.lastVodCheckAt
                            ? new Date(t.lastVodCheckAt).toLocaleDateString('ja-JP')
                            : '未確認'}
                        </td>
                        <td className="p-2 border border-gray-100">
                          {t.vodCheckStatus === 'needs_recheck' && (
                            <span className="text-[10px] bg-yellow-100 text-yellow-600 px-1.5 py-0.5 rounded">要確認</span>
                          )}
                          {t.vodCheckStatus === 'failed' && (
                            <span className="text-[10px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded">失敗</span>
                          )}
                          {t.vodCheckStatus === 'checking' && (
                            <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">確認中</span>
                          )}
                          {(!t.vodCheckStatus || t.vodCheckStatus === 'fresh') && (
                            <span className="text-[10px] text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
