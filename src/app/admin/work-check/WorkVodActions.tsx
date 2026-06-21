'use client';

import type { WorkRecord } from '@/types/work';
import type { VodProvider } from '@/types/vod';
import { deduplicateProviders } from '@/lib/vod-dedup';

const PROVIDER_LOGO_BASE = 'https://image.tmdb.org/t/p/w45';

interface WorkVodActionsProps {
  work: WorkRecord;
  debugMode: boolean;
  vodFetching: boolean;
  manualVodWorkId: string | null;
  manualVodName: string;
  manualVodLink: string;
  onVodFetch: (workId: string, opts?: { forceAi?: boolean; skipAi?: boolean }) => void;
  onOpenVodResearch: (work: WorkRecord) => void;
  onManualVodOpen: (workId: string) => void;
  onManualVodClose: () => void;
  onManualVodNameChange: (v: string) => void;
  onManualVodLinkChange: (v: string) => void;
  onManualVodAdd: (workId: string) => void;
  onManualVodRemove: (workId: string, provider: VodProvider) => void;
}

export default function WorkVodActions({
  work,
  debugMode,
  vodFetching,
  manualVodWorkId,
  manualVodName,
  manualVodLink,
  onVodFetch,
  onOpenVodResearch,
  onManualVodOpen,
  onManualVodClose,
  onManualVodNameChange,
  onManualVodLinkChange,
  onManualVodAdd,
  onManualVodRemove,
}: WorkVodActionsProps) {
  const hasProviders = (work.vodProviders?.length ?? 0) > 0;

  return (
    <>
      {/* 配信情報 */}
      {hasProviders ? (
        <div className="mt-2 flex flex-wrap gap-1 items-center">
          <span className="text-[10px] text-teal-600 font-medium">📺</span>
          {deduplicateProviders(work.vodProviders!).map((p, pi) => (
            <span
              key={`${p.providerId}-${p.type}-${pi}`}
              className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border ${
                p.source === 'manual'
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : p.source === 'manual_csv'
                    ? 'bg-orange-50 border-orange-200 text-orange-700'
                    : p.source === 'openai_web_search'
                      ? 'bg-violet-50 border-violet-200 text-violet-700'
                      : p.source === 'ai_recheck'
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                        : p.source === 'openai_supplement'
                          ? 'bg-purple-50 border-purple-200 text-purple-700'
                          : 'bg-blue-50 border-blue-200 text-blue-700'
              }`}
              title={`${p.providerName} [${p.source}]${p.confidence ? ` 確度:${p.confidence}` : ''}${p.reason ? ` | ${p.reason}` : ''}`}
            >
              {p.logoPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${PROVIDER_LOGO_BASE}${p.logoPath}`} alt="" className="w-3 h-3 rounded-sm" />
              ) : null}
              {p.providerName}
              {(p.source === 'openai_supplement' || p.source === 'openai_web_search' || p.source === 'ai_recheck') && (
                <span className="text-[8px] ml-0.5 text-purple-400">
                  {p.source === 'ai_recheck' ? '再確認' : p.source === 'openai_web_search' ? 'Web' : 'AI'}
                </span>
              )}
              {p.source === 'manual_csv' && (
                <span className="text-[8px] ml-0.5 text-orange-400">CSV</span>
              )}
              {p.source === 'manual' && debugMode && (
                <button
                  onClick={() => onManualVodRemove(work.id, p)}
                  className="ml-0.5 text-red-400 hover:text-red-600"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          {work.tmdbId && (
            <button
              onClick={() => onVodFetch(work.id)}
              disabled={vodFetching}
              className="text-[10px] text-teal-500 hover:text-teal-700 ml-1"
              title="この作品の配信情報を再取得"
            >
              🔄
            </button>
          )}
          <button
            onClick={() => onOpenVodResearch(work)}
            className="text-[10px] text-amber-500 hover:text-amber-700 ml-1"
            title="ChatGPT配信再調査プロンプトを生成"
          >
            📋
          </button>
          {work.vodUpdatedAt && (
            <span className="text-[9px] text-gray-300 ml-1">
              {new Date(work.vodUpdatedAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}確認
            </span>
          )}
        </div>
      ) : work.tmdbId ? (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-gray-400">
            📺 配信情報なし
            {work.vodUpdatedAt && (
              <span className="ml-1 text-gray-300">
                （{new Date(work.vodUpdatedAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}確認済み）
              </span>
            )}
          </span>
          <button
            onClick={() => onVodFetch(work.id)}
            disabled={vodFetching}
            className="text-[10px] text-teal-500 hover:text-teal-700"
          >
            再取得
          </button>
          <button
            onClick={() => onVodFetch(work.id, { forceAi: true })}
            disabled={vodFetching}
            className="text-[10px] text-purple-500 hover:text-purple-700"
          >
            AI補完
          </button>
          <button
            onClick={() => onOpenVodResearch(work)}
            className="text-[10px] text-amber-500 hover:text-amber-700"
            title="ChatGPT配信再調査プロンプトを生成"
          >
            📋 ChatGPT調査
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-gray-300">📺 tmdbIdなし</span>
          <button
            onClick={() => onOpenVodResearch(work)}
            className="text-[10px] text-amber-500 hover:text-amber-700"
            title="ChatGPT配信再調査プロンプトを生成"
          >
            📋 ChatGPT調査
          </button>
        </div>
      )}

      {/* 手動VOD追加フォーム（デバッグモード） */}
      {debugMode && manualVodWorkId === work.id ? (
        <div className="mt-2 flex gap-1">
          <input
            value={manualVodName}
            onChange={(e) => onManualVodNameChange(e.target.value)}
            placeholder="サービス名"
            className="text-[10px] border border-gray-200 rounded px-2 py-1 flex-1 min-w-0"
          />
          <input
            value={manualVodLink}
            onChange={(e) => onManualVodLinkChange(e.target.value)}
            placeholder="URL（任意）"
            className="text-[10px] border border-gray-200 rounded px-2 py-1 w-24"
          />
          <button
            onClick={() => onManualVodAdd(work.id)}
            className="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded"
          >
            追加
          </button>
          <button
            onClick={onManualVodClose}
            className="text-[10px] text-gray-400"
          >
            ✕
          </button>
        </div>
      ) : debugMode ? (
        <button
          onClick={() => onManualVodOpen(work.id)}
          className="mt-1 text-[10px] text-green-500 hover:text-green-700"
        >
          + 手動でVOD追加
        </button>
      ) : null}
    </>
  );
}
