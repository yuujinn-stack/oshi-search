'use client';

import { useEffect, useState, useCallback } from 'react';
import { safeFetchJson } from './safe-fetch-json';
import { formatJst } from '@/lib/jst-time';

interface ScheduleRow {
  id: number;
  personName: string;
  templateId: string;
  scheduledAt: string;
  status: 'draft' | 'scheduled' | 'processing' | 'published' | 'failed' | 'cancelled' | 'needs_review';
  caption: string;
  hashtags: string;
  imageUrls: string[];
  mediaId: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
  attempts: number;
}

const STATUS_LABEL: Record<ScheduleRow['status'], string> = {
  draft: '下書き',
  scheduled: '予約済み',
  processing: '処理中',
  published: '投稿済み',
  failed: '失敗',
  cancelled: 'キャンセル済み',
  needs_review: '要確認',
};

const STATUS_STYLE: Record<ScheduleRow['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-50 text-blue-700',
  processing: 'bg-amber-50 text-amber-700',
  published: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400',
  needs_review: 'bg-orange-100 text-orange-800',
};

interface Props {
  /** 値が変わるたびに一覧を再取得する（予約登録・キャンセル・再実行の直後にインクリメントする想定） */
  reloadToken: number;
}

export default function ScheduleList({ reloadToken }: Props) {
  const [schedules, setSchedules] = useState<ScheduleRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(() => {
    safeFetchJson<{ schedules: ScheduleRow[] }>('/api/admin/instagram-schedule')
      .then((data) => setSchedules(data.schedules))
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload, reloadToken]);

  async function handleCancel(id: number) {
    if (!window.confirm('この予約をキャンセルしますか？')) return;
    setBusyId(id);
    setActionError(null);
    try {
      await safeFetchJson(`/api/admin/instagram-schedule/${id}/cancel`, { method: 'POST' });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRetry(id: number) {
    setBusyId(id);
    setActionError(null);
    try {
      await safeFetchJson(`/api/admin/instagram-schedule/${id}/retry`, { method: 'POST' });
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  if (loadError) {
    return <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">一覧の取得に失敗しました: {loadError}</div>;
  }
  if (!schedules) {
    return <p className="text-xs text-gray-400">読み込み中...</p>;
  }
  if (schedules.length === 0) {
    return <p className="text-xs text-gray-400">予約はまだありません。</p>;
  }

  return (
    <div className="space-y-3">
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{actionError}</div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
              <th className="py-2 pr-3">予定日時（JST）</th>
              <th className="py-2 pr-3">人物</th>
              <th className="py-2 pr-3">テンプレート</th>
              <th className="py-2 pr-3">状態</th>
              <th className="py-2 pr-3">詳細</th>
              <th className="py-2 pr-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3 whitespace-nowrap text-slate-700">{formatJst(s.scheduledAt)}</td>
                <td className="py-2 pr-3 whitespace-nowrap font-medium text-slate-800">{s.personName}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{s.templateId}</td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[s.status]}`}>
                    {STATUS_LABEL[s.status]}
                  </span>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-500 max-w-xs">
                  {s.status === 'published' && s.mediaId && <span className="font-mono">media_id: {s.mediaId}</span>}
                  {s.status === 'failed' && s.errorMessage && (
                    <span className="text-red-600">{s.errorMessage}（試行{s.attempts}回）</span>
                  )}
                  {s.status === 'needs_review' && (
                    <span className="text-orange-700">
                      ⚠️ Instagram側で実際に公開済みの可能性があります。Instagramアプリ/Webで実際に投稿されていないか確認してから対応してください。
                      {s.errorMessage && <> {s.errorMessage}</>}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {(s.status === 'scheduled' || s.status === 'draft') && (
                    <button
                      onClick={() => handleCancel(s.id)}
                      disabled={busyId === s.id}
                      className="text-xs px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-50"
                    >
                      キャンセル
                    </button>
                  )}
                  {s.status === 'failed' && (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleRetry(s.id)}
                        disabled={busyId === s.id}
                        className="text-xs px-3 py-1 rounded-md bg-violet-50 hover:bg-violet-100 text-violet-700 disabled:opacity-50"
                      >
                        再実行
                      </button>
                      <button
                        onClick={() => handleCancel(s.id)}
                        disabled={busyId === s.id}
                        className="text-xs px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-50"
                      >
                        キャンセル
                      </button>
                    </div>
                  )}
                  {s.status === 'needs_review' && (
                    <button
                      onClick={() => handleCancel(s.id)}
                      disabled={busyId === s.id}
                      className="text-xs px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-50"
                    >
                      キャンセル（要確認後）
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
