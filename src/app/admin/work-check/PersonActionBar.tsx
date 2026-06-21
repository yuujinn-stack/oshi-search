'use client';

import { useState } from 'react';

interface PersonActionBarProps {
  personName: string;
  isProcessing: boolean;
  processing: string | null;
  loading: boolean;
  vodFetching: boolean;
  debugMode: boolean;
  intensiveCronEnabled: boolean | null;
  intensiveCronLoading: boolean;
  onProcess: (
    action: 'tmdb' | 'supplement' | 'all',
    opts?: { forceRejudge?: boolean; deleteSupplementFirst?: boolean; includeVod?: boolean },
  ) => void;
  onVodFetch: (workId?: string, opts?: { forceAi?: boolean; skipAi?: boolean }) => void;
  onReload: () => void;
  onToggleDebug: () => void;
  onOpenIntensiveModal: () => void;
  onIntensiveCronToggle: () => void;
  ogBulkRunning: boolean;
  onBulkOgFetch: () => void;
}

export default function PersonActionBar({
  personName,
  isProcessing,
  processing,
  loading,
  vodFetching,
  debugMode,
  intensiveCronEnabled,
  intensiveCronLoading,
  onProcess,
  onVodFetch,
  onReload,
  onToggleDebug,
  onOpenIntensiveModal,
  onIntensiveCronToggle,
  ogBulkRunning,
  onBulkOgFetch,
}: PersonActionBarProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <div className="space-y-2">
      {/* 主要ボタン（常時表示） */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onProcess('tmdb')}
          disabled={isProcessing}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors disabled:opacity-50"
        >
          {processing === 'tmdb' ? '処理中...' : '🎬 TMDb取得・AI判定'}
        </button>
        <button
          onClick={onReload}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-600 transition-colors disabled:opacity-50"
        >
          {loading ? '読込中...' : '更新'}
        </button>
        <button
          onClick={() => onVodFetch()}
          disabled={isProcessing || vodFetching}
          title="公開中の全作品の配信情報をTMDb+AI補完で取得"
          className="text-xs px-3 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 transition-colors disabled:opacity-50"
        >
          {vodFetching ? '取得中...' : '📺 配信情報取得'}
        </button>
        <button
          onClick={() => setDetailOpen((v) => !v)}
          className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
            detailOpen
              ? 'bg-gray-200 text-gray-700'
              : 'bg-gray-100 hover:bg-gray-200 text-gray-500'
          }`}
        >
          詳細操作 {detailOpen ? '▲' : '▼'}
        </button>
      </div>

      {/* 詳細操作パネル */}
      {detailOpen && (
        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-100">
          <button
            onClick={() => onProcess('all', { includeVod: true })}
            disabled={isProcessing || vodFetching}
            title="TMDb取得・AI判定・AI補完・配信情報取得をまとめて実行（新規セットアップ向け）"
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors disabled:opacity-50"
          >
            {isProcessing ? '処理中...' : '🚀 フルセットアップ'}
          </button>
          <button
            onClick={() => onProcess('tmdb', { forceRejudge: true })}
            disabled={isProcessing}
            title="手動確認済み以外を全て再判定"
            className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 transition-colors disabled:opacity-50"
          >
            {processing === 'tmdb' ? '処理中...' : '🔄 再判定'}
          </button>
          <button
            onClick={() => onProcess('supplement')}
            disabled={isProcessing}
            title="TMDbにない作品をOpenAIで補完"
            className="text-xs px-3 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-600 transition-colors disabled:opacity-50"
          >
            {processing === 'supplement' ? '補完中...' : '🤖 AI補完'}
          </button>
          <button
            onClick={() => onProcess('supplement', { deleteSupplementFirst: true })}
            disabled={isProcessing}
            title="AI補完作品を削除して再補完"
            className="text-xs px-3 py-1.5 rounded-lg bg-pink-50 hover:bg-pink-100 text-pink-600 transition-colors disabled:opacity-50"
          >
            {processing === 'supplement' ? '補完中...' : '🔁 AI補完リセット'}
          </button>
          <button
            onClick={() => onVodFetch(undefined, { forceAi: true })}
            disabled={isProcessing || vodFetching}
            title="AI Web検索補完を強制再実行（前回から7日未満でも再実行）"
            className="text-xs px-3 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-600 transition-colors disabled:opacity-50"
          >
            {vodFetching ? '取得中...' : '🔍 AI Web検索補完'}
          </button>
          <a
            href={`/api/admin/csv-export?person=${encodeURIComponent(personName)}`}
            download
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
            title="この人物の全作品をCSVで出力"
          >
            📄 CSV出力
          </a>
          <button
            onClick={onOpenIntensiveModal}
            disabled={isProcessing || vodFetching}
            title="この人物の全出演作品（条件除外なし）をAIで配信確認"
            className="text-xs px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-semibold transition-colors disabled:opacity-50"
          >
            🎯 重点配信確認
          </button>
          <button
            onClick={onIntensiveCronToggle}
            disabled={intensiveCronLoading}
            title={
              intensiveCronEnabled
                ? 'Cronでの重点確認を解除（通常の条件フィルタに戻す）'
                : 'Cronでもこの人物の全作品を継続的に確認対象にする'
            }
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              intensiveCronEnabled
                ? 'bg-red-100 hover:bg-red-200 text-red-700 font-medium'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-500'
            }`}
          >
            {intensiveCronLoading ? '...' : intensiveCronEnabled ? '🔄 Cron重点 ON' : 'Cron重点設定'}
          </button>
          <button
            onClick={onBulkOgFetch}
            disabled={ogBulkRunning || isProcessing || vodFetching}
            title="posterUrlがない作品のOG画像をofficialUrl/sourceUrlから一括取得"
            className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 transition-colors disabled:opacity-50"
          >
            {ogBulkRunning ? '取得中...' : '🖼 OG画像一括取得'}
          </button>
          <button
            onClick={onToggleDebug}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              debugMode
                ? 'bg-gray-700 text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-slate-600'
            }`}
          >
            🔍 デバッグ{debugMode ? ' ON' : ''}
          </button>
        </div>
      )}
    </div>
  );
}
