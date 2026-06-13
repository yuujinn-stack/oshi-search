'use client';

import { useState } from 'react';
import type { WorkRecord, WorkStatus, WorkSource } from '@/types/work';
import type { VodProvider } from '@/types/vod';

// vod-fetch API のデバッグ型（route.ts の VodFetchDebugItem と同一）
interface VodFetchDebugItem {
  title: string;
  workId: string;
  tmdbId?: number;
  workType: 'movie' | 'tv';
  jpExists: boolean;
  tmdbProviderCount: number;
  tmdbFlatrateCount: number;
  tmdbRentCount: number;
  tmdbBuyCount: number;
  tmdbAdsCount: number;
  tmdbReason?: string;
  aiCalled: boolean;
  aiCallReason: string;
  aiProviderCount: number;
  finalProviderCount: number;
  finalProviders: Array<{
    name: string;
    type: string;
    source: string;
    sourceLabel?: string;
    confidence?: string;
    officialUrl?: string;
    reason?: string;
    checkedDate?: string;
    note?: string;
    publicVisible: boolean;
    hiddenReason?: string;
  }>;
}

const PROVIDER_LOGO_BASE = 'https://image.tmdb.org/t/p/w45';

interface Counts {
  total: number;
  published: number;
  review: number;
  hidden: number;
}

interface Props {
  personName: string;
  group: string;
  counts: Counts;
}

type StatusFilter = WorkStatus | 'all';
type SourceFilter = WorkSource | 'all';

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

// source バッジ（青=TMDb、紫=AI補完、緑=手動）
const SOURCE_BADGE: Record<WorkSource, string> = {
  tmdb: 'bg-blue-100 text-blue-700',
  openai_suggestion: 'bg-purple-100 text-purple-700',
  manual: 'bg-green-100 text-green-700',
};
const SOURCE_LABEL: Record<WorkSource, string> = {
  tmdb: 'TMDb',
  openai_suggestion: 'AI補完',
  manual: '手動',
};

export default function PersonWorks({ personName, group, counts }: Props) {
  const [open, setOpen] = useState(false);
  const [works, setWorks] = useState<WorkRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('needs_review');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [debugMode, setDebugMode] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [testingWorkId, setTestingWorkId] = useState<string | null>(null);
  const [matchedPerson, setMatchedPerson] = useState<{
    id: number;
    name: string;
    department?: string;
    matchScore: number;
    matchDetails: string;
  } | null>(null);
  const [vodFetching, setVodFetching] = useState(false);
  const [vodMessage, setVodMessage] = useState('');
  // workId → 最新の VOD取得デバッグ情報（vod-fetch 実行後に更新）
  const [vodDebugMap, setVodDebugMap] = useState<Record<string, VodFetchDebugItem>>({});
  const [expandedVodDebug, setExpandedVodDebug] = useState<string | null>(null);
  const [manualVodWorkId, setManualVodWorkId] = useState<string | null>(null);
  const [manualVodName, setManualVodName] = useState('');
  const [manualVodLink, setManualVodLink] = useState('');

  async function loadWorks() {
    setLoading(true);
    const res = await fetch(`/api/admin/works?person=${encodeURIComponent(personName)}`);
    if (res.ok) {
      const data = (await res.json()) as { works: WorkRecord[] };
      setWorks(data.works);
    }
    setLoading(false);
  }

  async function handleOpen() {
    if (!open && !works) await loadWorks();
    setOpen((v) => !v);
  }

  async function handleVodFetch(workId?: string, opts?: { forceAi?: boolean; skipAi?: boolean }) {
    setVodFetching(true);
    setVodMessage('');
    const res = await fetch('/api/admin/vod-fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personName,
        workId,
        forceAi: opts?.forceAi ?? false,
        skipAi: opts?.skipAi ?? false,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        updatedCount: number;
        skippedCount: number;
        aiCalledCount: number;
        message?: string;
        debugInfo?: VodFetchDebugItem[];
      };

      // debugMap に最新情報を蓄積
      if (data.debugInfo?.length) {
        setVodDebugMap((prev) => {
          const next = { ...prev };
          for (const d of data.debugInfo!) next[d.workId] = d;
          return next;
        });
      }

      const aiHit = data.debugInfo?.filter((d) => d.aiCalled && d.aiProviderCount > 0) ?? [];
      const aiSkipped = data.debugInfo?.filter((d) => !d.aiCalled && d.tmdbProviderCount === 0) ?? [];

      let msg = data.message ?? `配信情報: ${data.updatedCount}件更新`;
      if (data.aiCalledCount > 0) msg += ` / AI Web検索補完${data.aiCalledCount}件呼出し（取得${aiHit.length}件）`;
      if (aiSkipped.length > 0) msg += ` / AI未実行${aiSkipped.length}件（スタール期間内）`;

      setVodMessage(msg);
      if (debugMode && data.debugInfo) {
        console.log('[vod-debug]', JSON.stringify(data.debugInfo, null, 2));
      }
      await loadWorks();
    } else {
      setVodMessage('配信情報取得に失敗しました');
    }
    setVodFetching(false);
  }

  async function handleManualVodAdd(workId: string) {
    if (!manualVodName.trim()) return;
    await fetch('/api/admin/vod-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personName,
        workId,
        provider: { providerName: manualVodName.trim(), link: manualVodLink.trim() || undefined, type: 'flatrate' },
      }),
    });
    setManualVodName('');
    setManualVodLink('');
    setManualVodWorkId(null);
    await loadWorks();
  }

  async function handleManualVodRemove(workId: string, provider: VodProvider) {
    await fetch('/api/admin/vod-add', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, workId, providerId: provider.providerId }),
    });
    await loadWorks();
  }

  async function handleProcess(
    action: 'tmdb' | 'supplement' | 'all',
    opts?: { forceRejudge?: boolean; deleteSupplementFirst?: boolean; includeVod?: boolean },
  ) {
    setProcessing(action);
    setMessage('');
    const res = await fetch('/api/admin/work-process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personName,
        action,
        forceRejudge: opts?.forceRejudge ?? false,
        deleteSupplementFirst: opts?.deleteSupplementFirst ?? false,
        includeVod: opts?.includeVod ?? false,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        newCount: number;
        rejudgedCount: number;
        supplementCount: number;
        aiJudgedCount: number;
        ruleBasedCount: number;
        autoPublishedCount: number;
        needsReviewCount: number;
        hiddenCount: number;
        vodUpdatedCount?: number;
        vodAiCalledCount?: number;
        matchedTmdbPerson?: { id: number; name: string; department?: string; matchScore: number; matchDetails: string };
        error?: string;
      };
      if (data.matchedTmdbPerson) setMatchedPerson(data.matchedTmdbPerson);
      if (data.error) {
        setMessage(`エラー: ${data.error}`);
      } else {
        const parts: string[] = [];
        if (action === 'tmdb' || action === 'all') {
          if (data.newCount > 0 || opts?.forceRejudge) {
            parts.push(`TMDb新規${data.newCount}件`);
            if (opts?.forceRejudge && data.rejudgedCount > 0)
              parts.push(`再判定${data.rejudgedCount}件`);
          }
        }
        if (action === 'supplement' || action === 'all') {
          parts.push(`AI補完${data.supplementCount}件`);
        }
        parts.push(
          `AI判定${data.aiJudgedCount}件`,
          `公開${data.autoPublishedCount} / 確認待ち${data.needsReviewCount} / 非表示${data.hiddenCount}`,
        );
        if (data.vodUpdatedCount !== undefined) {
          parts.push(`📺 配信情報${data.vodUpdatedCount}件更新 / AI Web検索${data.vodAiCalledCount ?? 0}件`);
        }
        setMessage(`完了: ${parts.join(' ')}`);
        await loadWorks();
      }
    } else {
      setMessage('処理に失敗しました');
    }
    setProcessing(null);
  }

  async function handleVerdict(workId: string, status: WorkStatus) {
    const res = await fetch('/api/admin/work-verdict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, workId, status }),
    });
    if (res.ok) await loadWorks();
  }

  async function handleDelete(workId: string) {
    const res = await fetch('/api/admin/work-verdict', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, workId }),
    });
    if (res.ok) {
      setTestResult(null);
      await loadWorks();
    }
  }

  async function handleTestJudge(work: WorkRecord) {
    setTestingWorkId(work.id);
    setTestResult(null);
    const res = await fetch('/api/admin/work-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personName,
        work: {
          tmdbId: work.tmdbId,
          title: work.title,
          originalTitle: work.originalTitle,
          type: work.type,
          releaseYear: work.releaseYear,
          roleName: work.roleName,
          overview: work.overview,
        },
      }),
    });
    if (res.ok) setTestResult(await res.json());
    setTestingWorkId(null);
  }

  const filteredWorks = works
    ? works
        .filter((w) => statusFilter === 'all' || w.status === statusFilter)
        .filter((w) => sourceFilter === 'all' || w.source === sourceFilter)
        .sort((a, b) => b.confidenceScore - a.confidenceScore)
    : [];

  const reviewCount = works
    ? works.filter((w) => w.status === 'needs_review').length
    : counts.review;

  const supplementCount = works
    ? works.filter((w) => w.source === 'openai_suggestion').length
    : 0;

  const isProcessing = processing !== null;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* ヘッダー行 */}
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">{personName}</span>
          {group && <span className="text-xs text-gray-400">{group}</span>}
        </div>
        <div className="flex items-center gap-2">
          {counts.total > 0 && (
            <span className="text-xs text-gray-500">
              公開{counts.published} / 確認待ち{counts.review} / 非表示{counts.hidden}
            </span>
          )}
          {reviewCount > 0 && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
              確認待ち {reviewCount}件
            </span>
          )}
          {supplementCount > 0 && (
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
              AI補完 {supplementCount}件
            </span>
          )}
          <span className="text-gray-400 text-xs ml-1">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* 展開パネル */}
      {open && (
        <div className="p-4 space-y-4 bg-white">
          {/* アクションバー */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleProcess('all', { includeVod: true })}
              disabled={isProcessing || vodFetching}
              title="TMDb取得・AI判定・AI補完・配信情報取得をまとめて実行（新規セットアップ向け）"
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors disabled:opacity-50"
            >
              {isProcessing ? '処理中...' : '🚀 フルセットアップ'}
            </button>
            <button
              onClick={() => handleProcess('tmdb')}
              disabled={isProcessing}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors disabled:opacity-50"
            >
              {processing === 'tmdb' ? '処理中...' : '🎬 TMDb取得・AI判定'}
            </button>
            <button
              onClick={() => handleProcess('tmdb', { forceRejudge: true })}
              disabled={isProcessing}
              title="手動確認済み以外を全て再判定"
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 transition-colors disabled:opacity-50"
            >
              {processing === 'tmdb' ? '処理中...' : '🔄 再判定'}
            </button>
            <button
              onClick={() => handleProcess('supplement')}
              disabled={isProcessing}
              title="TMDbにない作品をOpenAIで補完"
              className="text-xs px-3 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-600 transition-colors disabled:opacity-50"
            >
              {processing === 'supplement' ? '補完中...' : '🤖 AI補完'}
            </button>
            <button
              onClick={() => handleProcess('supplement', { deleteSupplementFirst: true })}
              disabled={isProcessing}
              title="AI補完作品を削除して再補完"
              className="text-xs px-3 py-1.5 rounded-lg bg-pink-50 hover:bg-pink-100 text-pink-600 transition-colors disabled:opacity-50"
            >
              {processing === 'supplement' ? '補完中...' : '🔁 AI補完リセット'}
            </button>
            <button
              onClick={loadWorks}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-600 transition-colors disabled:opacity-50"
            >
              {loading ? '読込中...' : '更新'}
            </button>
            <button
              onClick={() => handleVodFetch()}
              disabled={isProcessing || vodFetching}
              title="公開中の全作品の配信情報をTMDb+AI補完で取得"
              className="text-xs px-3 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-600 transition-colors disabled:opacity-50"
            >
              {vodFetching ? '取得中...' : '📺 配信情報取得'}
            </button>
            <button
              onClick={() => handleVodFetch(undefined, { forceAi: true })}
              disabled={isProcessing || vodFetching}
              title="AI Web検索補完を強制再実行（前回から7日未満でも再実行）"
              className="text-xs px-3 py-1.5 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-600 transition-colors disabled:opacity-50"
            >
              {vodFetching ? '取得中...' : '🔍 AI Web検索補完'}
            </button>
            <button
              onClick={() => setDebugMode((v) => !v)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                debugMode
                  ? 'bg-gray-700 text-white'
                  : 'bg-gray-100 hover:bg-gray-200 text-slate-600'
              }`}
            >
              🔍 デバッグ{debugMode ? ' ON' : ''}
            </button>
          </div>

          {/* フィルターバー */}
          <div className="flex flex-wrap gap-2">
            {/* ステータスフィルター */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {(
                [
                  { key: 'needs_review', label: '確認待ち' },
                  { key: 'auto_published', label: '公開中' },
                  { key: 'hidden', label: '非表示' },
                  { key: 'all', label: '全ステータス' },
                ] as { key: StatusFilter; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`px-3 py-1.5 border-l first:border-l-0 border-gray-200 ${
                    statusFilter === key
                      ? 'bg-slate-700 text-white font-medium'
                      : 'text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* ソースフィルター */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {(
                [
                  { key: 'all', label: '全ソース' },
                  { key: 'tmdb', label: 'TMDb' },
                  { key: 'openai_suggestion', label: 'AI補完' },
                  { key: 'manual', label: '手動' },
                ] as { key: SourceFilter; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSourceFilter(key)}
                  className={`px-3 py-1.5 border-l first:border-l-0 border-gray-200 ${
                    sourceFilter === key
                      ? 'bg-slate-700 text-white font-medium'
                      : 'text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {message && (
            <p
              className={`text-xs font-medium px-3 py-2 rounded-lg ${
                message.startsWith('エラー')
                  ? 'bg-red-50 text-red-600'
                  : 'bg-green-50 text-green-700'
              }`}
            >
              {message}
            </p>
          )}
          {vodMessage && (
            <p
              className={`text-xs font-medium px-3 py-2 rounded-lg ${
                vodMessage.includes('失敗')
                  ? 'bg-red-50 text-red-600'
                  : 'bg-teal-50 text-teal-700'
              }`}
            >
              📺 {vodMessage}
            </p>
          )}

          {/* マッチした TMDb 人物情報 */}
          {matchedPerson && (
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs flex-wrap">
              <span className="text-slate-500">TMDb人物:</span>
              <span className="font-medium text-slate-700">{matchedPerson.name}</span>
              {matchedPerson.department && (
                <span className="text-slate-400">{matchedPerson.department}</span>
              )}
              <span className="text-slate-400">id={matchedPerson.id}</span>
              <span
                className={`px-1.5 py-0.5 rounded font-mono ${
                  matchedPerson.matchScore >= 60
                    ? 'bg-green-100 text-green-700'
                    : matchedPerson.matchScore >= 30
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-red-100 text-red-600'
                }`}
                title={matchedPerson.matchDetails}
              >
                マッチ度{matchedPerson.matchScore}
              </span>
              {matchedPerson.matchScore < 40 && (
                <span className="text-orange-500">⚠️ 人物不一致の可能性・tmdbPersonIdで固定推奨</span>
              )}
              {debugMode && (
                <span className="text-slate-400 text-[10px] w-full mt-0.5 font-mono">
                  {matchedPerson.matchDetails}
                </span>
              )}
            </div>
          )}

          {/* テスト結果 */}
          {testResult && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-bold text-gray-200">🔍 AI判定テスト結果</p>
                <button
                  onClick={() => setTestResult(null)}
                  className="text-gray-400 hover:text-gray-200"
                >
                  ✕
                </button>
              </div>
              <pre className="overflow-auto text-green-400 text-[10px] max-h-60">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          )}

          {/* 作品リスト */}
          {works === null ? (
            <p className="text-sm text-gray-400 text-center py-4">読み込み中...</p>
          ) : filteredWorks.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              {statusFilter === 'needs_review' && sourceFilter === 'all'
                ? '確認待ちの作品はありません ✓'
                : counts.total === 0
                  ? '作品データがありません。「TMDb取得・AI判定」を実行してください。'
                  : 'このフィルタに該当する作品はありません'}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredWorks.map((work) => (
                <div
                  key={work.id}
                  className={`flex items-start gap-3 p-3 rounded-lg text-xs border ${
                    work.status === 'auto_published'
                      ? 'border-green-100 bg-green-50/50'
                      : work.status === 'hidden'
                        ? 'border-red-100 bg-red-50/30 opacity-70'
                        : 'border-yellow-100 bg-yellow-50/50'
                  }`}
                >
                  {/* ポスター */}
                  {work.posterUrl ? (
                    <img
                      src={work.posterUrl}
                      alt=""
                      className="w-10 h-14 object-cover rounded flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-14 bg-gray-100 rounded flex-shrink-0 flex items-center justify-center text-gray-300 text-lg">
                      🎬
                    </div>
                  )}

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
                      {/* ステータスバッジ */}
                      <span className={`px-1.5 py-0.5 rounded ${STATUS_BADGE[work.status]}`}>
                        {STATUS_LABEL[work.status]}
                      </span>
                      {/* ソースバッジ（常に表示） */}
                      <span
                        className={`px-1.5 py-0.5 rounded font-medium ${SOURCE_BADGE[work.source] ?? 'bg-gray-100 text-gray-500'}`}
                      >
                        {SOURCE_LABEL[work.source] ?? work.source}
                      </span>
                      {/* 手動確認済み */}
                      {work.checkedAt && (
                        <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">
                          手動確認済
                        </span>
                      )}
                      {/* AI使用バッジ */}
                      <span
                        className={`px-1 py-0.5 rounded ${
                          work.usedAi
                            ? 'bg-indigo-50 text-indigo-500'
                            : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {work.usedAi ? '🤖 AI' : '⚙️ ルール'}
                      </span>
                      {/* 参考スコア */}
                      <span className="font-mono text-gray-400 text-[10px]">
                        {work.confidenceScore}pt
                      </span>
                    </div>

                    {work.aiReason && (
                      <p className="text-gray-500 mt-1 italic">{work.aiReason}</p>
                    )}

                    {/* AI補完作品の注意書き */}
                    {work.source === 'openai_suggestion' && !work.checkedAt && (
                      <p className="text-purple-600 mt-1 text-[10px]">
                        ⚠️ AI推測による補完作品です。出演を確認してから公開してください。
                      </p>
                    )}

                    {/* 配信情報 */}
                    {(work.vodProviders?.length ?? 0) > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1 items-center">
                        <span className="text-[10px] text-teal-600 font-medium">📺</span>
                        {work.vodProviders!.map((p, pi) => (
                          <span
                            key={`${p.providerId}-${p.type}-${pi}`}
                            className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border ${
                              p.source === 'manual'
                                ? 'bg-green-50 border-green-200 text-green-700'
                                : p.source === 'openai_web_search'
                                  ? 'bg-violet-50 border-violet-200 text-violet-700'
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
                            {(p.source === 'openai_supplement' || p.source === 'openai_web_search') && (
                              <span className="text-[8px] ml-0.5 text-purple-400">
                                {p.source === 'openai_web_search' ? 'Web' : 'AI'}
                              </span>
                            )}
                            {p.source === 'manual' && debugMode && (
                              <button
                                onClick={() => handleManualVodRemove(work.id, p)}
                                className="ml-0.5 text-red-400 hover:text-red-600"
                              >
                                ✕
                              </button>
                            )}
                          </span>
                        ))}
                        {work.tmdbId && (
                          <button
                            onClick={() => handleVodFetch(work.id)}
                            disabled={vodFetching}
                            className="text-[10px] text-teal-500 hover:text-teal-700 ml-1"
                            title="この作品の配信情報を再取得"
                          >
                            🔄
                          </button>
                        )}
                        {work.vodUpdatedAt && (
                          <span className="text-[9px] text-gray-300 ml-1">
                            {new Date(work.vodUpdatedAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}確認
                          </span>
                        )}
                      </div>
                    ) : (
                      work.tmdbId ? (
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
                            onClick={() => handleVodFetch(work.id)}
                            disabled={vodFetching}
                            className="text-[10px] text-teal-500 hover:text-teal-700"
                          >
                            再取得
                          </button>
                          <button
                            onClick={() => handleVodFetch(work.id, { forceAi: true })}
                            disabled={vodFetching}
                            className="text-[10px] text-purple-500 hover:text-purple-700"
                          >
                            AI補完
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 text-[10px] text-gray-300">📺 配信情報取得不可（tmdbIdなし）</p>
                      )
                    )}

                    {/* 手動VOD追加フォーム（デバッグモード） */}
                    {debugMode && manualVodWorkId === work.id ? (
                      <div className="mt-2 flex gap-1">
                        <input
                          value={manualVodName}
                          onChange={(e) => setManualVodName(e.target.value)}
                          placeholder="サービス名"
                          className="text-[10px] border border-gray-200 rounded px-2 py-1 flex-1 min-w-0"
                        />
                        <input
                          value={manualVodLink}
                          onChange={(e) => setManualVodLink(e.target.value)}
                          placeholder="URL（任意）"
                          className="text-[10px] border border-gray-200 rounded px-2 py-1 w-24"
                        />
                        <button
                          onClick={() => handleManualVodAdd(work.id)}
                          className="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded"
                        >
                          追加
                        </button>
                        <button
                          onClick={() => setManualVodWorkId(null)}
                          className="text-[10px] text-gray-400"
                        >
                          ✕
                        </button>
                      </div>
                    ) : debugMode ? (
                      <button
                        onClick={() => setManualVodWorkId(work.id)}
                        className="mt-1 text-[10px] text-green-500 hover:text-green-700"
                      >
                        + 手動でVOD追加
                      </button>
                    ) : null}

                    {/* デバッグ詳細 */}
                    {debugMode && (
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
                          <p>createdAt: {new Date(work.createdAt).toLocaleString('ja-JP')}</p>
                        </div>

                        {/* VOD取得デバッグ（vod-fetch実行後に更新） */}
                        {vodDebugMap[work.id] ? (
                          <div className="border border-teal-200 rounded-lg overflow-hidden">
                            <button
                              onClick={() => setExpandedVodDebug(
                                expandedVodDebug === work.id ? null : work.id,
                              )}
                              className="w-full flex items-center justify-between px-3 py-1.5 bg-teal-50 text-[11px] text-teal-700 font-medium"
                            >
                              <span>📺 VOD取得デバッグ（最終実行結果）</span>
                              <span>{expandedVodDebug === work.id ? '▲' : '▼'}</span>
                            </button>
                            {expandedVodDebug === work.id && (() => {
                              const d = vodDebugMap[work.id];
                              return (
                                <div className="p-3 bg-white text-[10px] space-y-2">
                                  {/* TMDb結果 */}
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

                                  {/* AI補完結果 */}
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

                                  {/* 最終プロバイダー一覧 */}
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
                                                p.source === 'tmdb_watch_provider' ? 'text-blue-600' : 'text-green-600'
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
                    )}
                  </div>

                  {/* 判定ボタン */}
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleVerdict(work.id, 'auto_published')}
                      disabled={work.status === 'auto_published'}
                      className="text-xs px-2 py-1 rounded bg-green-100 hover:bg-green-200 text-green-700 disabled:opacity-40"
                    >
                      公開
                    </button>
                    <button
                      onClick={() => handleVerdict(work.id, 'needs_review')}
                      disabled={work.status === 'needs_review'}
                      className="text-xs px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200 text-yellow-700 disabled:opacity-40"
                    >
                      確認待ち
                    </button>
                    <button
                      onClick={() => handleVerdict(work.id, 'hidden')}
                      disabled={work.status === 'hidden'}
                      className="text-xs px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-40"
                    >
                      非表示
                    </button>
                    {debugMode && (
                      <button
                        onClick={() => handleTestJudge(work)}
                        disabled={testingWorkId === work.id}
                        className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-40"
                      >
                        {testingWorkId === work.id ? '判定中...' : 'テスト'}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(work.id)}
                      className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-500"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
