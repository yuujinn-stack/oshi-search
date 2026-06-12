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

export default function PersonWorks({ personName, group, counts }: Props) {
  const [open, setOpen] = useState(false);
  const [works, setWorks] = useState<WorkRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<FilterMode>('needs_review');

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

  async function handleProcess() {
    setProcessing(true);
    setMessage('');
    const res = await fetch('/api/admin/work-process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        newCount: number;
        aiJudgedCount: number;
        autoPublishedCount: number;
        needsReviewCount: number;
        hiddenCount: number;
        error?: string;
      };
      if (data.error) {
        setMessage(`エラー: ${data.error}`);
      } else {
        setMessage(
          `完了: 新規${data.newCount}件 AI判定${data.aiJudgedCount}件 ` +
            `（公開${data.autoPublishedCount} / 確認待ち${data.needsReviewCount} / 非表示${data.hiddenCount}）`,
        );
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
    if (res.ok) await loadWorks();
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
              onClick={handleProcess}
              disabled={processing}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 transition-colors disabled:opacity-50"
            >
              {processing ? '処理中...' : '🎬 TMDb取得・AI判定'}
            </button>
            <button
              onClick={loadWorks}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-600 transition-colors disabled:opacity-50"
            >
              {loading ? '読込中...' : '更新'}
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
              className={`text-xs font-medium ${message.startsWith('エラー') ? 'text-red-600' : 'text-green-600'}`}
            >
              {message}
            </p>
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
                        ? 'border-red-100 bg-red-50/30 opacity-60'
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
                    </div>
                    {work.roleName && (
                      <p className="text-indigo-600 mt-0.5">役: {work.roleName}</p>
                    )}
                    {work.overview && (
                      <p className="text-gray-500 mt-0.5 line-clamp-2">{work.overview}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded ${STATUS_BADGE[work.status]}`}>
                        {STATUS_LABEL[work.status]}
                      </span>
                      <span className="text-gray-400">score {work.confidenceScore}</span>
                      <span className="text-gray-400">{work.source}</span>
                      {work.aiReason && (
                        <span className="text-gray-500 truncate max-w-[200px]">
                          {work.aiReason}
                        </span>
                      )}
                    </div>
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
