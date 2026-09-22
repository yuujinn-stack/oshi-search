'use client';

import { Fragment, useEffect, useState, useCallback, useMemo } from 'react';
import { safeFetchJson } from './safe-fetch-json';
import { formatJst } from '@/lib/jst-time';
import { getScheduleTemplateMeta } from '@/lib/instagram-templates';
import {
  getStatusLabel,
  getStatusStyle,
  STATUS_FILTER_OPTIONS,
  MAX_AUTO_RETRY_ATTEMPTS,
} from '@/lib/instagram-schedule-status';

interface ScheduleRow {
  id: number;
  personName: string;
  templateId: string;
  scheduledAt: string;
  status: string;
  caption: string;
  hashtags: string;
  imageUrls: string[];
  mediaId: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
  attempts: number;
  updatedAt: string;
}

interface Props {
  /** 値が変わるたびに一覧を再取得する（予約登録・キャンセル・再実行の直後にインクリメントする想定） */
  reloadToken: number;
}

const SUMMARY_CARD_KEYS = ['scheduled', 'processing', 'published', 'failed', 'needs_review', 'cancelled'] as const;

export default function ScheduleList({ reloadToken }: Props) {
  const [schedules, setSchedules] = useState<ScheduleRow[] | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [statusFilter, setStatusFilter] = useState('all');
  const [nameQuery, setNameQuery] = useState('');

  const reload = useCallback(() => {
    safeFetchJson<{ schedules: ScheduleRow[]; statusCounts?: Record<string, number> }>('/api/admin/instagram-schedule')
      .then((data) => {
        setSchedules(data.schedules);
        setStatusCounts(data.statusCounts ?? {});
      })
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

  async function handleRetry(id: number, status: string) {
    const confirmMessage = status === 'needs_review'
      ? 'この投稿はInstagram側で既に公開されている可能性があります。Instagramアプリ/Webで実際に投稿されていないことを確認した上で、この投稿を再実行しますか？'
      : 'この投稿を再実行しますか？';
    if (!window.confirm(confirmMessage)) return;
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

  const filteredSchedules = useMemo(() => {
    if (!schedules) return null;
    const q = nameQuery.trim().toLowerCase();
    return schedules.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (q && !s.personName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [schedules, statusFilter, nameQuery]);

  if (loadError) {
    return <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">一覧の取得に失敗しました: {loadError}</div>;
  }
  if (!schedules || !filteredSchedules) {
    return <p className="text-xs text-gray-400">読み込み中...</p>;
  }

  return (
    <div className="space-y-4">
      {/* サマリーカード（DB側でGROUP BY集計済みのstatusCountsを使う。件数が増えても軽量） */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {SUMMARY_CARD_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
            className={`text-left border rounded-lg px-3 py-2 transition-colors ${
              statusFilter === key ? 'border-violet-400 bg-violet-50' : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <p className="text-[11px] text-gray-500">{getStatusLabel(key)}</p>
            <p className="text-lg font-bold text-slate-800">{statusCounts[key] ?? 0}件</p>
          </button>
        ))}
      </div>

      {/* フィルター */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5"
        >
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <input
          type="text"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="人物名で検索..."
          className="text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 w-40"
        />
        <span className="text-xs text-gray-400">{filteredSchedules.length}件表示中（全{schedules.length}件）</span>
      </div>

      {schedules.length === 0 ? (
        <p className="text-xs text-gray-400">予約はまだありません。</p>
      ) : filteredSchedules.length === 0 ? (
        <p className="text-xs text-gray-400">条件に一致する予約がありません。</p>
      ) : (
        <>
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
                {filteredSchedules.map((s) => {
                  const isExpanded = expandedId === s.id;
                  const templateLabel = getScheduleTemplateMeta(s.templateId)?.label ?? s.templateId;
                  const canRetry = s.status === 'failed' || s.status === 'needs_review';
                  const canCancel = s.status === 'draft' || s.status === 'scheduled' || s.status === 'failed' || s.status === 'needs_review';
                  return (
                    <Fragment key={s.id}>
                      <tr className="border-b border-gray-100 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-700">{formatJst(s.scheduledAt)}</td>
                        <td className="py-2 pr-3 whitespace-nowrap font-medium text-slate-800">{s.personName}</td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{templateLabel}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${getStatusStyle(s.status)}`}>
                            {getStatusLabel(s.status)}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-xs text-gray-500 max-w-xs">
                          {s.status === 'published' && s.mediaId && <span className="font-mono">media_id: {s.mediaId}</span>}
                          {s.status === 'failed' && s.errorMessage && (
                            <span className="text-red-600 line-clamp-2">{s.errorMessage}（試行{s.attempts}回）</span>
                          )}
                          {s.status === 'needs_review' && (
                            <span className="text-orange-700">⚠️ Instagram側の状態確認が必要です</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : s.id)}
                              className="text-xs px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600"
                            >
                              {isExpanded ? '閉じる' : '詳細'}
                            </button>
                            {canRetry && (
                              <button
                                onClick={() => handleRetry(s.id, s.status)}
                                disabled={busyId === s.id}
                                className="text-xs px-3 py-1 rounded-md bg-violet-50 hover:bg-violet-100 text-violet-700 disabled:opacity-50"
                              >
                                再実行
                              </button>
                            )}
                            {canCancel && (
                              <button
                                onClick={() => handleCancel(s.id)}
                                disabled={busyId === s.id}
                                className="text-xs px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 disabled:opacity-50"
                              >
                                キャンセル
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-gray-100 bg-gray-50">
                          <td colSpan={6} className="py-3 px-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600">
                              <p><span className="text-gray-400">人物名：</span>{s.personName}</p>
                              <p><span className="text-gray-400">予定日時（JST）：</span>{formatJst(s.scheduledAt)}</p>
                              <p><span className="text-gray-400">使用テンプレート：</span>{templateLabel}</p>
                              <p><span className="text-gray-400">状態：</span>{getStatusLabel(s.status)}</p>
                              <p><span className="text-gray-400">再試行回数：</span>{s.attempts} / {MAX_AUTO_RETRY_ATTEMPTS}</p>
                              <p><span className="text-gray-400">最終更新日時（JST）：</span>{formatJst(s.updatedAt)}</p>
                            </div>

                            {s.status === 'published' && (
                              <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-xs text-emerald-800 space-y-1">
                                <p>Instagram投稿ID：<span className="font-mono">{s.mediaId ?? '（なし）'}</span></p>
                                <p>投稿日時：{s.publishedAt ? formatJst(s.publishedAt) : '（不明）'}</p>
                              </div>
                            )}

                            {s.status === 'failed' && (
                              <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 space-y-1">
                                <p>エラー内容：{s.errorMessage ?? '（記録なし）'}</p>
                                <p>再試行回数：{s.attempts} / {MAX_AUTO_RETRY_ATTEMPTS}</p>
                                {s.attempts < MAX_AUTO_RETRY_ATTEMPTS ? (
                                  <p>次回のCronで自動再試行されます。</p>
                                ) : (
                                  <p>自動再試行上限に達しました。手動で「再実行」を行ってください。</p>
                                )}
                              </div>
                            )}

                            {s.status === 'needs_review' && (
                              <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg p-3 text-xs text-orange-800 space-y-1">
                                <p className="font-semibold">Instagram側の状態確認が必要です</p>
                                <p>
                                  Instagramへの投稿API呼び出し（media_publish）自体でエラーが発生しましたが、
                                  Instagram側では実際に投稿が完了している可能性があります。
                                  二重投稿を避けるため、この予約は自動再試行の対象から除外されています。
                                </p>
                                <p>Instagramアプリ/Webで実際に投稿されているか確認した上で、投稿されていなければ「再実行」を、既に投稿されていれば「キャンセル」を行ってください。</p>
                                {s.errorMessage && <p>エラー内容：{s.errorMessage}</p>}
                              </div>
                            )}

                            {s.status === 'cancelled' && (
                              <p className="mt-3 text-xs text-gray-500">この予約はキャンセルされており、Cronの処理対象にはなりません。</p>
                            )}

                            {(s.status === 'scheduled' || s.status === 'draft') && (
                              <p className="mt-3 text-xs text-gray-500">予定日時になると、次回のCron実行時に自動投稿されます。</p>
                            )}

                            {s.status === 'processing' && (
                              <p className="mt-3 text-xs text-amber-700">現在Cronが投稿処理中です（通常は数十秒〜数分で完了します）。</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
