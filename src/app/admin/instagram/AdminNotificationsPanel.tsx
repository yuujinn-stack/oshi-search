'use client';

import { useState } from 'react';
import { formatJst } from '@/lib/jst-time';
import { getStatusLabel, getStatusStyle } from '@/lib/instagram-schedule-status';

export interface NotificationItem {
  id: number;
  scheduleId: number;
  status: string;
  personName: string;
  scheduledAt: string;
  templateLabel: string;
  attempts: number;
  errorMessage: string | null;
  updatedAt: string;
}

interface Props {
  initial: NotificationItem[];
}

/**
 * 「要対応」パネル（未読のfailed/needs_review通知）。
 * 「確認済みにする」はこのテーブルの既読状態のみを更新する（予約本体のstatusは一切変更しない）。
 */
export default function AdminNotificationsPanel({ initial }: Props) {
  const [items, setItems] = useState(initial);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleMarkRead(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/instagram-schedule/notifications/${id}/read`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `確認済みへの更新に失敗しました（HTTP ${res.status}）`);
      }
      setItems((prev) => prev.filter((it) => it.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return <p className="text-xs text-emerald-700">✓ 現在、確認が必要な投稿はありません</p>;
  }

  return (
    <div>
      <p className="text-sm font-bold text-red-600 mb-2">⚠️ 要対応 {items.length}件</p>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="border border-gray-100 rounded-lg p-2 text-xs">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-semibold text-slate-800">{it.personName}</span>
              <span className={`inline-block px-1.5 py-0.5 rounded-full font-semibold ${getStatusStyle(it.status)}`}>
                {getStatusLabel(it.status)}
              </span>
            </div>
            <p className="text-gray-500">{formatJst(it.scheduledAt)} ／ {it.templateLabel}</p>
            <p className="text-gray-400">試行回数：{it.attempts}</p>
            {it.errorMessage && <p className="text-red-600 line-clamp-2">{it.errorMessage}</p>}
            <div className="flex items-center gap-3 mt-1.5">
              <a
                href={`/admin/instagram-schedule?status=${it.status}&scheduleId=${it.scheduleId}`}
                className="text-violet-600 hover:text-violet-700 font-semibold"
              >
                詳細を確認 →
              </a>
              <button
                onClick={() => handleMarkRead(it.id)}
                disabled={busyId === it.id}
                className="text-gray-500 hover:text-slate-700 font-semibold disabled:opacity-50"
              >
                {busyId === it.id ? '更新中...' : '確認済みにする'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
