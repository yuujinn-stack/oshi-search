'use client';

import type { WorkRecord } from '@/types/work';
import type { VodFetchDebugItem } from './work-check-types';

interface DebugPanelProps {
  work: WorkRecord;
  vodDebugItem?: VodFetchDebugItem;
  expandedVodDebug: boolean;
  onToggleVodDebug: () => void;
}

export default function DebugPanel({
  work,
  vodDebugItem,
  expandedVodDebug,
  onToggleVodDebug,
}: DebugPanelProps) {
  return (
    <div className="mt-2 space-y-2">
      {/* 作品メタデバッグ */}
      <div className="p-2 bg-gray-900 rounded text-[10px] font-mono text-green-400 space-y-0.5">
        <p>id: {work.id}</p>
        <p>source: {work.source}</p>
        <p>tmdbId: {work.tmdbId ?? '—'}</p>
        <p>aiDecision: {work.aiDecision ?? '旧データ（なし）'}</p>
        <p>confidenceScore: {work.confidenceScore}（参考値）</p>
        <p>usedAi: {String(work.usedAi ?? '不明')}</p>
        {work.tmdbMatchedPersonId && (
          <p>tmdbPerson: {work.tmdbMatchedPersonName} (id={work.tmdbMatchedPersonId})</p>
        )}
        <p>vodUpdatedAt: {work.vodUpdatedAt ? new Date(work.vodUpdatedAt).toLocaleString('ja-JP') : '未取得'}</p>
        <p>vodAiCheckedAt: {work.vodAiCheckedAt ? new Date(work.vodAiCheckedAt).toLocaleString('ja-JP') : '未実行'}</p>
        <p>lastVodCheckAt: {work.lastVodCheckAt ? new Date(work.lastVodCheckAt).toLocaleString('ja-JP') : '未実行'}</p>
        <p>vodCheckStatus: {work.vodCheckStatus ?? '—'} / source: {work.vodCheckSource ?? '—'}</p>
        {work.vodCheckError && <p className="text-red-400">vodCheckError: {work.vodCheckError}</p>}
        <p>createdAt: {new Date(work.createdAt).toLocaleString('ja-JP')}</p>
      </div>

      {/* VOD取得デバッグ（vod-fetch実行後に更新） */}
      {vodDebugItem ? (
        <div className="border border-teal-200 rounded-lg overflow-hidden">
          <button
            onClick={onToggleVodDebug}
            className="w-full flex items-center justify-between px-3 py-1.5 bg-teal-50 text-[11px] text-teal-700 font-medium"
          >
            <span>📺 VOD取得デバッグ（最終実行結果）</span>
            <span>{expandedVodDebug ? '▲' : '▼'}</span>
          </button>
          {expandedVodDebug && (() => {
            const d = vodDebugItem;
            return (
              <div className="p-3 bg-white text-[10px] space-y-2">
                <div className="space-y-0.5">
                  <p className="font-semibold text-slate-600">TMDb Watch Providers</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-600 pl-2">
                    <span>tmdbId:</span><span>{d.tmdbId} ({d.workType})</span>
                    <span>jpExists:</span>
                    <span className={d.jpExists ? 'text-green-600' : 'text-red-500'}>
                      {String(d.jpExists)}
                    </span>
                    <span>providers合計:</span><span>{d.tmdbProviderCount}件</span>
                    <span>flatrate:</span><span>{d.tmdbFlatrateCount}件</span>
                    <span>rent:</span><span>{d.tmdbRentCount}件</span>
                    <span>buy:</span><span>{d.tmdbBuyCount}件</span>
                    <span>ads:</span><span>{d.tmdbAdsCount}件</span>
                    {d.tmdbReason && (
                      <><span>reason:</span><span className="text-orange-500">{d.tmdbReason}</span></>
                    )}
                  </div>
                </div>

                <div className="space-y-0.5">
                  <p className="font-semibold text-slate-600">OpenAI補完</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-gray-600 pl-2">
                    <span>実行:</span>
                    <span className={d.aiCalled ? 'text-purple-600 font-medium' : 'text-gray-400'}>
                      {d.aiCalled ? `実行（${d.aiProviderCount}件取得）` : '未実行'}
                    </span>
                    <span>理由:</span><span className="text-gray-500 col-span-1">{d.aiCallReason}</span>
                  </div>
                </div>

                {d.finalProviders.length > 0 ? (
                  <div className="space-y-0.5">
                    <p className="font-semibold text-slate-600">保存済みプロバイダー（{d.finalProviders.length}件）</p>
                    <table className="w-full text-[10px] border-collapse">
                      <thead>
                        <tr className="bg-gray-100 text-gray-500">
                          <th className="text-left p-1 border border-gray-200">名前</th>
                          <th className="text-left p-1 border border-gray-200">種別</th>
                          <th className="text-left p-1 border border-gray-200">ソース</th>
                          <th className="text-left p-1 border border-gray-200">確度</th>
                          <th className="text-left p-1 border border-gray-200">確認日</th>
                          <th className="text-left p-1 border border-gray-200">公開</th>
                          <th className="text-left p-1 border border-gray-200">根拠・URL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.finalProviders.map((p, pi) => (
                          <tr key={pi} className={p.publicVisible ? '' : 'opacity-50 bg-red-50'}>
                            <td className="p-1 border border-gray-200">{p.name}</td>
                            <td className="p-1 border border-gray-200">{p.type}</td>
                            <td className={`p-1 border border-gray-200 ${
                              p.source === 'openai_web_search' ? 'text-violet-600' :
                              p.source === 'openai_supplement' ? 'text-purple-600' :
                              p.source === 'tmdb_watch_provider' ? 'text-blue-600' :
                              p.source === 'manual_csv' ? 'text-orange-600' : 'text-green-600'
                            }`}>{p.sourceLabel ?? p.source}</td>
                            <td className={`p-1 border border-gray-200 ${
                              p.confidence === 'high' ? 'text-green-600' :
                              p.confidence === 'medium' ? 'text-yellow-600' :
                              p.confidence === 'low' ? 'text-red-500' : ''
                            }`}>{p.confidence ?? '—'}</td>
                            <td className="p-1 border border-gray-200">{p.checkedDate ?? '—'}</td>
                            <td className="p-1 border border-gray-200">
                              {p.publicVisible
                                ? <span className="text-green-600">✓</span>
                                : <span className="text-red-500" title={p.hiddenReason}>✗ {p.hiddenReason}</span>
                              }
                            </td>
                            <td className="p-1 border border-gray-200 max-w-[180px]">
                              {p.reason && (
                                <p className="text-gray-600 text-[9px] mb-0.5">{p.reason}</p>
                              )}
                              {p.officialUrl && (
                                <a
                                  href={p.officialUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[9px] text-blue-500 underline break-all"
                                >
                                  {p.officialUrl.slice(0, 50)}{p.officialUrl.length > 50 ? '…' : ''}
                                </a>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-gray-400 pl-2">プロバイダーなし（配信情報なし）</p>
                )}
              </div>
            );
          })()}
        </div>
      ) : (
        <p className="text-[10px] text-gray-400 px-2">
          VODデバッグ: 配信情報取得ボタンを実行すると詳細が表示されます
        </p>
      )}
    </div>
  );
}
