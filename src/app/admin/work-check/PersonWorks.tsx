'use client';

import { useState } from 'react';
import type { WorkRecord, WorkStatus, WorkSource } from '@/types/work';
import type { VodProvider } from '@/types/vod';
import type { VodFetchDebugItem, Counts } from './work-check-types';
import PersonCard from './PersonCard';
import PersonActionBar from './PersonActionBar';
import WorkFilters from './WorkFilters';
import WorkCard from './WorkCard';
import VodIntensiveModal from './VodIntensiveModal';
import VodResearchModal from './VodResearchModal';

interface Props {
  personName: string;
  group: string;
  counts: Counts;
}

type StatusFilter = WorkStatus | 'all';
type SourceFilter = WorkSource | 'all';

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
  const [vodDebugMap, setVodDebugMap] = useState<Record<string, VodFetchDebugItem>>({});
  const [recheckingWorkId, setRecheckingWorkId] = useState<string | null>(null);
  const [recheckMessage, setRecheckMessage] = useState('');
  const [intensiveModalOpen, setIntensiveModalOpen] = useState(false);
  const [intensiveCronEnabled, setIntensiveCronEnabled] = useState<boolean | null>(null);
  const [intensiveCronLoading, setIntensiveCronLoading] = useState(false);
  const [vodResearchWork, setVodResearchWork] = useState<WorkRecord | null>(null);

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

  async function handleManualVodAdd(workId: string, name: string, link: string) {
    if (!name.trim()) return;
    await fetch('/api/admin/vod-add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personName,
        workId,
        provider: { providerName: name.trim(), link: link.trim() || undefined, type: 'flatrate' },
      }),
    });
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

  async function handleVodRecheck(workId: string) {
    setRecheckingWorkId(workId);
    setRecheckMessage('');
    const res = await fetch('/api/admin/vod-recheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, workId }),
    });
    if (res.ok) {
      const data = (await res.json()) as { providerCount: number; vodCheckStatus: string };
      setRecheckMessage(`AI再確認完了: ${data.providerCount}件取得 (${data.vodCheckStatus})`);
      await loadWorks();
    } else {
      const data = (await res.json()).catch?.() ?? {};
      setRecheckMessage(`AI再確認失敗: ${(data as { error?: string }).error ?? 'Unknown error'}`);
    }
    setRecheckingWorkId(null);
  }

  async function handlePriorityToggle(workId: string, current: boolean) {
    await fetch('/api/admin/vod-recheck', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, workId, priority: !current }),
    });
    await loadWorks();
  }

  async function handleOgImageFetch(workId: string) {
    await fetch('/api/admin/og-image-fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, workId }),
    });
    await loadWorks();
  }

  async function handleIntensiveCronToggle() {
    setIntensiveCronLoading(true);
    const newVal = !intensiveCronEnabled;
    const res = await fetch('/api/admin/vod-person-recheck', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, intensive: newVal }),
    });
    if (res.ok) setIntensiveCronEnabled(newVal);
    setIntensiveCronLoading(false);
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

  const isProcessing = processing !== null;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <PersonCard
        personName={personName}
        group={group}
        counts={counts}
        open={open}
        onClick={handleOpen}
      />

      {open && (
        <div className="p-4 space-y-4 bg-white">
          <PersonActionBar
            personName={personName}
            isProcessing={isProcessing}
            processing={processing}
            loading={loading}
            vodFetching={vodFetching}
            debugMode={debugMode}
            intensiveCronEnabled={intensiveCronEnabled}
            intensiveCronLoading={intensiveCronLoading}
            onProcess={handleProcess}
            onVodFetch={handleVodFetch}
            onReload={loadWorks}
            onToggleDebug={() => setDebugMode((v) => !v)}
            onOpenIntensiveModal={() => setIntensiveModalOpen(true)}
            onIntensiveCronToggle={handleIntensiveCronToggle}
          />

          <WorkFilters
            statusFilter={statusFilter}
            sourceFilter={sourceFilter}
            onStatusChange={setStatusFilter}
            onSourceChange={setSourceFilter}
          />

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
          {recheckMessage && (
            <p
              className={`text-xs font-medium px-3 py-2 rounded-lg ${
                recheckMessage.includes('失敗')
                  ? 'bg-red-50 text-red-600'
                  : 'bg-violet-50 text-violet-700'
              }`}
            >
              🔍 {recheckMessage}
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
                <WorkCard
                  key={work.id}
                  work={work}
                  debugMode={debugMode}
                  vodFetching={vodFetching}
                  recheckingWorkId={recheckingWorkId}
                  testingWorkId={testingWorkId}
                  vodDebugItem={vodDebugMap[work.id]}
                  onVodFetch={handleVodFetch}
                  onVodRecheck={handleVodRecheck}
                  onPriorityToggle={handlePriorityToggle}
                  onVerdict={handleVerdict}
                  onDelete={handleDelete}
                  onManualVodAdd={handleManualVodAdd}
                  onManualVodRemove={handleManualVodRemove}
                  onOpenVodResearch={(w) => setVodResearchWork(w)}
                  onTestJudge={handleTestJudge}
                  onOgImageFetch={handleOgImageFetch}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 重点配信確認モーダル */}
      {intensiveModalOpen && (
        <VodIntensiveModal
          personName={personName}
          onClose={() => setIntensiveModalOpen(false)}
          onDone={() => loadWorks()}
        />
      )}

      {vodResearchWork && (
        <VodResearchModal
          work={vodResearchWork}
          onClose={() => setVodResearchWork(null)}
        />
      )}
    </div>
  );
}
