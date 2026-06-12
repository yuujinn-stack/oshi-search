'use client';

import { useState } from 'react';
import type { WorkRecord, WorkStatus } from '@/types/work';

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

type FilterMode = WorkStatus | 'all';

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

const RELATION_LABEL: Record<string, string> = {
  strong: '強い関連',
  medium: '中程度の関連',
  weak: '弱い関連',
  none: '関連なし',
};

const RELATION_COLOR: Record<string, string> = {
  strong: 'text-green-600',
  medium: 'text-blue-600',
  weak: 'text-orange-500',
  none: 'text-red-500',
};

// スコアがどの閾値に該当するか説明
function scoreExplanation(score: number): string {
  if (score >= 90) return `${score}点 → 自動公開（90点以上）`;
  if (score >= 70) return `${score}点 → 確認待ち（70〜89点）`;
  return `${score}点 → 非表示（70点未満）`;
}

export default function PersonWorks({ personName, group, counts }: Props) {
  const [open, setOpen] = useState(false);
  const [works, setWorks] = useState<WorkRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<FilterMode>('needs_review');
  const [debugMode, setDebugMode] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);
  const [testingWorkId, setTestingWorkId] = useState<string | null>(null);
  const [matchedPerson, setMatchedPerson] = useState<{
    id: number;
    name: string;
    matchScore: number;
    matchDetails: string;
  } | null>(null);

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

  async function handleProcess(forceRejudge = false) {
    setProcessing(true);
    setMessage('');
    const res = await fetch('/api/admin/work-process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, forceRejudge }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        newCount: number;
        rejudgedCount: number;
        aiJudgedCount: number;
        ruleBasedCount: number;
        autoPublishedCount: number;
        needsReviewCount: number;
        hiddenCount: number;
        matchedTmdbPerson?: { id: number; name: string; matchScore: number; matchDetails: string };
        error?: string;
      };
      if (data.matchedTmdbPerson) setMatchedPerson(data.matchedTmdbPerson);
      if (data.error) {
        setMessage(`エラー: ${data.error}`);
      } else {
        const parts = [
          `新規${data.newCount}件`,
          forceRejudge && data.rejudgedCount > 0 ? `再判定${data.rejudgedCount}件` : '',
          `AI判定${data.aiJudgedCount}件`,
          data.ruleBasedCount > 0 ? `ルールベース${data.ruleBasedCount}件` : '',
          `公開${data.autoPublishedCount} / 確認待ち${data.needsReviewCount} / 非表示${data.hiddenCount}`,
        ].filter(Boolean);
        setMessage(`完了: ${parts.join(' ')}`);
        await loadWorks();
      }
    } else {
      setMessage('処理に失敗しました');
    }
    setProcessing(false);
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
          type: work.type,
          releaseYear: work.releaseYear,
          roleName: work.roleName,
          overview: work.overview,
          voteCount: undefined,
        },
      }),
    });
    if (res.ok) {
      setTestResult(await res.json());
    }
    setTestingWorkId(null);
  }

  const filteredWorks = works
    ? (filter === 'all' ? works : works.filter((w) => w.status === filter)).sort(
        (a, b) => b.confidenceScore - a.confidenceScore,
      )
    : [];

  const reviewCount = works
    ? works.filter((w) => w.status === 'needs_review').length
    : counts.review;

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
          <span className="text-gray-400 text-xs ml-1">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* 展開パネル */}
      {open && (
        <div className="p-4 space-y-4 bg-white">
          {/* アクションバー */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleProcess(false)}
              disabled={processing}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 transition-colors disabled:opacity-50"
            >
              {processing ? '処理中...' : '🎬 TMDb取得・AI判定'}
            </button>
            <button
              onClick={() => handleProcess(true)}
              disabled={processing}
              title="手動確認済み以外を全て再判定（プロンプト改善後に使用）"
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-600 transition-colors disabled:opacity-50"
            >
              {processing ? '処理中...' : '🔄 再判定'}
            </button>
            <button
              onClick={loadWorks}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-600 transition-colors disabled:opacity-50"
            >
              {loading ? '読込中...' : '更新'}
            </button>
            <button
              onClick={() => setDebugMode((v) => !v)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                debugMode
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-gray-100 hover:bg-gray-200 text-slate-600'
              }`}
            >
              🔍 デバッグ{debugMode ? ' ON' : ''}
            </button>
            {/* フィルタ */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs ml-auto">
              {(
                [
                  { key: 'needs_review', label: '確認待ち' },
                  { key: 'auto_published', label: '公開中' },
                  { key: 'hidden', label: '非表示' },
                  { key: 'all', label: '全て' },
                ] as { key: FilterMode; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1.5 border-l first:border-l-0 border-gray-200 ${
                    filter === key
                      ? 'bg-indigo-50 text-indigo-700 font-medium'
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

          {/* マッチした TMDb 人物情報 */}
          {matchedPerson && (
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs flex-wrap">
              <span className="text-slate-500">TMDb人物:</span>
              <span className="font-medium text-slate-700">{matchedPerson.name}</span>
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
                <span className="text-orange-500">⚠️ 人物不一致の可能性あり・tmdbPersonIdで固定推奨</span>
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
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-bold text-purple-800">🔍 AI判定テスト結果</p>
                <button
                  onClick={() => setTestResult(null)}
                  className="text-purple-400 hover:text-purple-600"
                >
                  ✕
                </button>
              </div>
              <pre className="bg-white rounded p-3 overflow-auto text-purple-900 text-[10px] max-h-60">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          )}

          {/* 作品リスト */}
          {works === null ? (
            <p className="text-sm text-gray-400 text-center py-4">読み込み中...</p>
          ) : filteredWorks.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              {filter === 'needs_review'
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
                      <span className="text-gray-400">
                        {work.type === 'movie' ? '映画' : 'ドラマ'}
                      </span>
                      {work.releaseYear && (
                        <span className="text-gray-400">{work.releaseYear}年</span>
                      )}
                      {work.checkedAt && (
                        <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">
                          手動確認済
                        </span>
                      )}
                    </div>

                    {work.roleName && (
                      <p className="text-indigo-600 mt-0.5">役: {work.roleName}</p>
                    )}
                    {work.overview && (
                      <p className="text-gray-500 mt-0.5 line-clamp-2">{work.overview}</p>
                    )}

                    {/* ステータス・スコア */}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded ${STATUS_BADGE[work.status]}`}>
                        {STATUS_LABEL[work.status]}
                      </span>
                      <span
                        className="font-mono text-gray-600"
                        title={scoreExplanation(work.confidenceScore)}
                      >
                        {work.confidenceScore}点
                      </span>
                      {work.aiRelation && (
                        <span className={`${RELATION_COLOR[work.aiRelation] ?? 'text-gray-500'}`}>
                          {RELATION_LABEL[work.aiRelation]}
                        </span>
                      )}
                      <span
                        className={`px-1 py-0.5 rounded ${
                          work.usedAi
                            ? 'bg-indigo-50 text-indigo-500'
                            : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {work.usedAi ? '🤖 AI' : '⚙️ ルール'}
                      </span>
                      {work.aiNeedsHumanReview && (
                        <span className="text-orange-500">⚠️ 要確認</span>
                      )}
                    </div>

                    {work.aiReason && (
                      <p className="text-gray-500 mt-1 italic">{work.aiReason}</p>
                    )}

                    {/* デバッグ詳細 */}
                    {debugMode && (
                      <div className="mt-2 p-2 bg-gray-50 rounded text-[10px] font-mono text-gray-600 space-y-0.5">
                        <p>id: {work.id}</p>
                        <p>tmdbId: {work.tmdbId ?? '—'}</p>
                        <p>source: {work.source}</p>
                        <p>score: {work.confidenceScore} → threshold 90/70</p>
                        <p>
                          scoreExplanation: {scoreExplanation(work.confidenceScore)}
                        </p>
                        {work.aiStatusRecommendation && (
                          <p>AI推奨ステータス: {work.aiStatusRecommendation}</p>
                        )}
                        <p>usedAi: {String(work.usedAi ?? '不明（旧データ）')}</p>
                        <p>
                          checkedAt:{' '}
                          {work.checkedAt
                            ? new Date(work.checkedAt).toLocaleString('ja-JP')
                            : '未確認'}
                        </p>
                        <p>
                          createdAt:{' '}
                          {new Date(work.createdAt).toLocaleString('ja-JP')}
                        </p>
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
                        className="text-xs px-2 py-1 rounded bg-purple-100 hover:bg-purple-200 text-purple-700 disabled:opacity-40"
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
