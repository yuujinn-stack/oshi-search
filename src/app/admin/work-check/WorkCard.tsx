'use client';

import { useState, useCallback } from 'react';
import type { WorkRecord, WorkStatus } from '@/types/work';
import type { VodProvider } from '@/types/vod';
import type { VodFetchDebugItem } from './work-check-types';
import WorkVodActions from './WorkVodActions';
import WorkStatusButtons from './WorkStatusButtons';
import DebugPanel from './DebugPanel';

const STATUS_LABEL: Record<WorkStatus, string> = {
  auto_published: '公開中',
  needs_review: '確認待ち',
  hidden: '非表示',
};

const STATUS_BADGE: Record<WorkStatus, string> = {
  auto_published: 'bg-green-100 text-green-700',
  needs_review: 'bg-yellow-100 text-yellow-700',
  hidden: 'bg-gray-100 text-gray-500',
};

const SOURCE_BADGE: Record<string, string> = {
  tmdb: 'bg-blue-100 text-blue-700',
  openai_suggestion: 'bg-purple-100 text-purple-700',
  ai_supplement: 'bg-indigo-100 text-indigo-700',
  manual: 'bg-green-100 text-green-700',
  manual_csv: 'bg-orange-100 text-orange-700',
};

const SOURCE_LABEL: Record<string, string> = {
  tmdb: 'TMDb',
  openai_suggestion: 'AI補完',
  ai_supplement: 'AI補完(確定)',
  manual: '手動',
  manual_csv: 'CSV手動',
};

interface WorkCardProps {
  work: WorkRecord;
  debugMode: boolean;
  vodFetching: boolean;
  recheckingWorkId: string | null;
  testingWorkId: string | null;
  vodDebugItem?: VodFetchDebugItem;
  isSelected?: boolean;
  onEdit?: () => void;
  onVodFetch: (workId?: string, opts?: { forceAi?: boolean; skipAi?: boolean }) => void;
  onVodRecheck: (workId: string) => void;
  onPriorityToggle: (workId: string, current: boolean) => void;
  onVerdict: (workId: string, status: WorkStatus) => void;
  onDelete: (workId: string) => void;
  onManualVodAdd: (workId: string, name: string, link: string) => Promise<void>;
  onManualVodRemove: (workId: string, provider: VodProvider) => void;
  onVodProviderDelete: (workId: string, providerName: string, source: string, type: string) => void;
  onOpenVodResearch: (work: WorkRecord) => void;
  onTestJudge: (work: WorkRecord) => void;
  onOgImageFetch: (workId: string) => Promise<{ ok: boolean; reason?: string } | null>;
  onOgImageForceFetch: (workId: string) => Promise<{ ok: boolean; reason?: string } | null>;
  onSetSourceUrl: (workId: string, sourceUrl: string) => Promise<{ ok: boolean; reason?: string } | null>;
}

export default function WorkCard({
  work,
  debugMode,
  vodFetching,
  recheckingWorkId,
  testingWorkId,
  vodDebugItem,
  isSelected,
  onEdit,
  onVodFetch,
  onVodRecheck,
  onPriorityToggle,
  onVerdict,
  onDelete,
  onManualVodAdd,
  onManualVodRemove,
  onVodProviderDelete,
  onOpenVodResearch,
  onTestJudge,
  onOgImageFetch,
  onOgImageForceFetch,
  onSetSourceUrl,
}: WorkCardProps) {
  const [manualVodWorkId, setManualVodWorkId] = useState<string | null>(null);
  const [manualVodName, setManualVodName] = useState('');
  const [manualVodLink, setManualVodLink] = useState('');
  const [expandedVodDebug, setExpandedVodDebug] = useState(false);
  const [ogFetching, setOgFetching] = useState(false);
  const [ogTried, setOgTried] = useState(false);
  const [ogFailReason, setOgFailReason] = useState<string | null>(null);
  const [ogForceFetching, setOgForceFetching] = useState(false);
  const [ogForceResult, setOgForceResult] = useState<string | null>(null);
  const [sourceUrlInput, setSourceUrlInput] = useState('');
  const [sourceUrlSaving, setSourceUrlSaving] = useState(false);
  const [sourceUrlResult, setSourceUrlResult] = useState<string | null>(null);
  const [showUrlEdit, setShowUrlEdit] = useState(false);

  // img.youtube.com/vi/videoseries/... のような壊れたURLを検出（ogImageUrl優先でチェック）
  const displayImageUrl = work.ogImageUrl ?? work.posterUrl;
  const isPosterBroken = !!displayImageUrl && /\/vi\/videoseries\//.test(displayImageUrl);

  // OG画像ステータス表示用
  const ogFetchedDate = work.ogImageFetchedAt
    ? new Date(work.ogImageFetchedAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  const handleOgFetch = useCallback(async () => {
    setOgFetching(true);
    setOgFailReason(null);
    const result = await onOgImageFetch(work.id);
    setOgFetching(false);
    setOgTried(true);
    if (result && result.ok === false) {
      setOgFailReason(result.reason ?? '取得失敗');
    }
  }, [onOgImageFetch, work.id]);

  const handleOgForceFetch = useCallback(async () => {
    setOgForceFetching(true);
    setOgForceResult(null);
    const result = await onOgImageForceFetch(work.id);
    setOgForceFetching(false);
    if (result) {
      setOgForceResult(result.ok ? '取得済' : (result.reason ?? '失敗'));
    }
  }, [onOgImageForceFetch, work.id]);

  const handleSourceUrlSave = useCallback(async () => {
    if (!sourceUrlInput.trim()) return;
    setSourceUrlSaving(true);
    setSourceUrlResult(null);
    const result = await onSetSourceUrl(work.id, sourceUrlInput.trim());
    setSourceUrlSaving(false);
    if (result) {
      setSourceUrlResult(result.ok ? '取得済' : (result.reason ?? '失敗'));
      if (result.ok) {
        setSourceUrlInput('');
        setShowUrlEdit(false);
      }
    }
  }, [onSetSourceUrl, work.id, sourceUrlInput]);

  async function handleManualVodAddLocal(workId: string) {
    await onManualVodAdd(workId, manualVodName, manualVodLink);
    setManualVodName('');
    setManualVodLink('');
    setManualVodWorkId(null);
  }

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg text-xs border ${
        isSelected
          ? 'border-slate-400 bg-slate-50 ring-1 ring-slate-300'
          : work.status === 'auto_published'
            ? 'border-green-100 bg-green-50/50'
            : work.status === 'hidden'
              ? 'border-red-100 bg-red-50/30 opacity-70'
              : 'border-yellow-100 bg-yellow-50/50'
      }`}
    >
      {/* 選択チェックボックス（isSelected が渡された場合のみ） */}
      {isSelected !== undefined && (
        <input
          type="checkbox"
          readOnly
          checked={isSelected}
          className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 accent-slate-600"
          style={{ pointerEvents: 'none' }}
        />
      )}
      {/* ポスター（ogImageUrl > posterUrl の順で表示） */}
      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        {displayImageUrl && !isPosterBroken ? (
          <img
            src={displayImageUrl}
            alt=""
            className="w-10 h-14 object-cover rounded"
          />
        ) : (
          <div className="w-10 h-14 bg-gray-100 rounded flex items-center justify-center text-gray-300 text-lg">
            🎬
          </div>
        )}

        {/* ogImageUrl 未取得: OG取得ボタン（TMDb posterUrl の有無に関係なく表示） */}
        {!work.ogImageUrl && (
          <button
            onClick={handleOgFetch}
            disabled={ogFetching}
            title="vodProviders の officialUrl/sourceUrl からOG画像を取得"
            className="text-[9px] text-teal-500 hover:text-teal-700 disabled:opacity-40 whitespace-nowrap"
          >
            {ogFetching ? '取得中' : 'OG取得'}
          </button>
        )}
        {!work.ogImageUrl && ogTried && !ogFetching && (
          <span
            className="text-[9px] text-gray-400 whitespace-nowrap text-center leading-tight"
            title={ogFailReason ?? undefined}
          >
            {ogFailReason ?? 'なし'}
          </span>
        )}

        {/* OG再取得ボタン（ogImageUrlあり or posterUrl壊れ時） */}
        {(work.ogImageUrl || isPosterBroken) && (
          <>
            {isPosterBroken && !ogForceFetching && !ogForceResult && (
              <span className="text-[9px] text-red-400 whitespace-nowrap">URL壊れています</span>
            )}
            <button
              onClick={handleOgForceFetch}
              disabled={ogForceFetching}
              title="OG画像を再取得（ogImageUrlを上書き）"
              className={`text-[9px] disabled:opacity-40 whitespace-nowrap ${
                isPosterBroken
                  ? 'text-red-400 hover:text-teal-600 font-medium'
                  : 'text-gray-400 hover:text-teal-600'
              }`}
            >
              {ogForceFetching ? '取得中' : '🔄'}
            </button>
            {ogForceResult && !ogForceFetching && (
              <span className={`text-[9px] whitespace-nowrap ${ogForceResult === '取得済' ? 'text-teal-500' : 'text-red-400'}`}>
                {ogForceResult}
              </span>
            )}
          </>
        )}

        {/* URL編集ボタン（全作品共通）*/}
        <button
          onClick={() => { setShowUrlEdit((v) => !v); setSourceUrlResult(null); }}
          className="text-[8px] text-gray-300 hover:text-gray-500 whitespace-nowrap leading-none"
          title="YouTube/記事URLを手動で入力して画像を取得"
        >
          {showUrlEdit ? '▲' : 'URL編集'}
        </button>

        {/* sourceUrl 入力フォーム */}
        {showUrlEdit && (
          <div className="flex flex-col items-center gap-0.5">
            <input
              type="text"
              value={sourceUrlInput}
              onChange={(e) => setSourceUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSourceUrlSave(); }}
              placeholder="YouTube/記事URL"
              className="text-[8px] border border-gray-200 rounded px-1 py-0.5 w-20 text-center focus:outline-none focus:ring-1 focus:ring-teal-300"
            />
            <button
              onClick={handleSourceUrlSave}
              disabled={sourceUrlSaving || !sourceUrlInput.trim()}
              className="text-[8px] text-teal-500 hover:text-teal-700 disabled:opacity-40 whitespace-nowrap"
            >
              {sourceUrlSaving ? '保存中' : '保存して取得'}
            </button>
            {sourceUrlResult && (
              <span className={`text-[8px] whitespace-nowrap ${sourceUrlResult === '取得済' ? 'text-teal-500' : 'text-red-400'}`}>
                {sourceUrlResult}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 情報 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-slate-800">{work.title}</span>
          {work.originalTitle && work.originalTitle !== work.title && (
            <span className="text-gray-400 text-[10px]">{work.originalTitle}</span>
          )}
          <span className="text-gray-400">
            {work.type === 'movie' ? '映画' : 'ドラマ'}
          </span>
          {work.releaseYear && (
            <span className="text-gray-400">{work.releaseYear}年</span>
          )}
        </div>

        {work.roleName && (
          <p className="text-indigo-600 mt-0.5">役: {work.roleName}</p>
        )}
        {work.overview && (
          <p className="text-gray-500 mt-0.5 line-clamp-2">{work.overview}</p>
        )}

        {/* ステータス・ソース・判定バッジ */}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className={`px-1.5 py-0.5 rounded ${STATUS_BADGE[work.status]}`}>
            {STATUS_LABEL[work.status]}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded font-medium ${SOURCE_BADGE[work.source] ?? 'bg-gray-100 text-gray-500'}`}
          >
            {SOURCE_LABEL[work.source] ?? work.source}
          </span>
          {work.checkedAt && (
            <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">
              手動確認済
            </span>
          )}
          {/* OG画像ステータスバッジ */}
          {work.ogImageStatus === 'success' ? (
            <span
              className="bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded text-[9px]"
              title={`OG取得済: ${work.ogImageUrl ?? ''}\n取得元: ${work.ogSourceUrl ?? ''}\n${ogFetchedDate ? `取得日: ${ogFetchedDate}` : ''}`}
            >
              OG済 {ogFetchedDate}
            </span>
          ) : work.ogImageStatus === 'failed' ? (
            <span
              className="bg-red-50 text-red-400 px-1.5 py-0.5 rounded text-[9px]"
              title={`OG取得失敗: ${work.ogImageError ?? ''}${ogFetchedDate ? ` (${ogFetchedDate})` : ''}`}
            >
              OG失敗: {work.ogImageError ?? '不明'}
            </span>
          ) : work.ogImageStatus === 'skipped' ? (
            <span
              className="bg-gray-50 text-gray-400 px-1.5 py-0.5 rounded text-[9px]"
              title={`OGスキップ: ${work.ogImageError ?? ''}`}
            >
              OGスキップ
            </span>
          ) : !work.ogImageUrl && !work.ogImageStatus ? (
            <span className="text-gray-300 px-1.5 py-0.5 rounded text-[9px]">OG未取得</span>
          ) : null}
          <span
            className={`px-1 py-0.5 rounded ${
              work.usedAi
                ? 'bg-indigo-50 text-indigo-500'
                : 'bg-gray-100 text-gray-400'
            }`}
          >
            {work.usedAi ? '🤖 AI' : '⚙️ ルール'}
          </span>
          <span className="font-mono text-gray-400 text-[10px]">
            {work.confidenceScore}pt
          </span>
        </div>

        {work.aiReason && (
          <p className="text-gray-500 mt-1 italic">{work.aiReason}</p>
        )}

        {work.source === 'openai_suggestion' && !work.checkedAt && (
          <p className="text-purple-600 mt-1 text-[10px]">
            ⚠️ AI推測による補完作品です。出演を確認してから公開してください。
          </p>
        )}

        {/* 配信再確認ステータス */}
        {(work.vodCheckStatus || work.priorityRecheck) && (
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {work.priorityRecheck && (
              <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium">
                🚨 優先再確認
              </span>
            )}
            {work.vodCheckStatus === 'checking' && (
              <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">確認中...</span>
            )}
            {work.vodCheckStatus === 'needs_recheck' && (
              <span className="text-[9px] bg-yellow-100 text-yellow-600 px-1.5 py-0.5 rounded-full">要確認</span>
            )}
            {work.vodCheckStatus === 'checked' && (
              <span className="text-[9px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded-full">確認済</span>
            )}
            {work.vodCheckStatus === 'failed' && (
              <span className="text-[9px] bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full" title={work.vodCheckError}>
                失敗
              </span>
            )}
            {work.lastVodCheckAt && (
              <span className="text-[9px] text-gray-300">
                {new Date(work.lastVodCheckAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}再確認
              </span>
            )}
          </div>
        )}

        <WorkVodActions
          work={work}
          debugMode={debugMode}
          vodFetching={vodFetching}
          manualVodWorkId={manualVodWorkId}
          manualVodName={manualVodName}
          manualVodLink={manualVodLink}
          onVodFetch={onVodFetch}
          onOpenVodResearch={onOpenVodResearch}
          onManualVodOpen={(workId) => setManualVodWorkId(workId)}
          onManualVodClose={() => setManualVodWorkId(null)}
          onManualVodNameChange={(v) => setManualVodName(v)}
          onManualVodLinkChange={(v) => setManualVodLink(v)}
          onManualVodAdd={handleManualVodAddLocal}
          onManualVodRemove={onManualVodRemove}
          onVodProviderDelete={onVodProviderDelete}
        />

        {debugMode && (
          <DebugPanel
            work={work}
            vodDebugItem={vodDebugItem}
            expandedVodDebug={expandedVodDebug}
            onToggleVodDebug={() => setExpandedVodDebug((v) => !v)}
          />
        )}
      </div>

      <div className="flex flex-col gap-1 flex-shrink-0">
        {onEdit && (
          <button
            onClick={onEdit}
            className="text-xs px-2 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-700"
          >
            編集
          </button>
        )}
        <WorkStatusButtons
          work={work}
          debugMode={debugMode}
          recheckingWorkId={recheckingWorkId}
          testingWorkId={testingWorkId}
          onVerdict={onVerdict}
          onVodRecheck={onVodRecheck}
          onPriorityToggle={onPriorityToggle}
          onTestJudge={onTestJudge}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
