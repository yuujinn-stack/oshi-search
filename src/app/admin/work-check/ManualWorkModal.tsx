'use client';

import { useState } from 'react';
import type { WorkRecord, WorkType, WorkStatus } from '@/types/work';
import { WORK_TYPE_LABEL } from '@/types/work';

const WORK_TYPES: { value: WorkType; label: string }[] = [
  { value: 'movie', label: '映画' },
  { value: 'tv', label: 'ドラマ' },
  { value: 'variety', label: 'バラエティ' },
  { value: 'anime', label: 'アニメ' },
];

const WORK_STATUSES: { value: WorkStatus; label: string }[] = [
  { value: 'auto_published', label: '公開' },
  { value: 'needs_review', label: '確認待ち' },
  { value: 'hidden', label: '非表示' },
];

interface Props {
  personName: string;
  editWork?: WorkRecord;
  onClose: () => void;
  onSaved: () => void;
}

export default function ManualWorkModal({ personName, editWork, onClose, onSaved }: Props) {
  const isEdit = !!editWork;

  const [title, setTitle] = useState(editWork?.title ?? '');
  const [type, setType] = useState<WorkType>(editWork?.type ?? 'movie');
  const [releaseYear, setReleaseYear] = useState(editWork?.releaseYear ? String(editWork.releaseYear) : '');
  const [roleName, setRoleName] = useState(editWork?.roleName ?? '');
  const [overview, setOverview] = useState(editWork?.overview ?? '');
  const [status, setStatus] = useState<WorkStatus>(editWork?.status ?? 'auto_published');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('作品名は必須です');
      return;
    }
    setSaving(true);
    setError('');

    const payload = {
      personName,
      title: title.trim(),
      type,
      releaseYear: releaseYear ? Number(releaseYear) : undefined,
      roleName: roleName.trim() || undefined,
      overview: overview.trim() || undefined,
      status,
      ...(isEdit ? { workId: editWork!.id } : {}),
    };

    const res = await fetch('/api/admin/work-manual', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      onSaved();
      onClose();
    } else {
      const data = await res.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? '保存に失敗しました');
    }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-slate-800 text-base">
            {isEdit ? '作品を編集' : '＋ 作品を手動追加'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 作品名 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              作品名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 花より男子"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
              required
            />
          </div>

          {/* 種別 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              種別 <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {WORK_TYPES.map(({ value, label }) => (
                <label
                  key={value}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border cursor-pointer text-xs font-medium transition-colors ${
                    type === value
                      ? 'bg-slate-700 text-white border-slate-700'
                      : 'border-gray-200 text-gray-500 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="type"
                    value={value}
                    checked={type === value}
                    onChange={() => setType(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* 公開年 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">公開年</label>
            <input
              type="number"
              value={releaseYear}
              onChange={(e) => setReleaseYear(e.target.value)}
              placeholder="例: 2024"
              min={1900}
              max={2100}
              className="w-32 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          {/* 役名 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">役名</label>
            <input
              type="text"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              placeholder="例: 牧野つくし"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          {/* あらすじ */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">あらすじ・説明</label>
            <textarea
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
              placeholder="任意のあらすじや説明"
              rows={3}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none"
            />
          </div>

          {/* ステータス */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">公開状態</label>
            <div className="flex gap-2">
              {WORK_STATUSES.map(({ value, label }) => (
                <label
                  key={value}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border cursor-pointer text-xs font-medium transition-colors ${
                    status === value
                      ? 'bg-slate-700 text-white border-slate-700'
                      : 'border-gray-200 text-gray-500 hover:border-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="status"
                    value={value}
                    checked={status === value}
                    onChange={() => setStatus(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="text-sm px-5 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white font-medium transition-colors disabled:opacity-50"
            >
              {saving ? '保存中...' : isEdit ? '変更を保存' : '追加する'}
            </button>
          </div>
        </form>

        {/* 手動追加の注意 */}
        {!isEdit && (
          <div className="px-6 pb-4">
            <p className="text-[11px] text-gray-400 bg-gray-50 px-3 py-2 rounded-lg">
              手動追加した作品は <span className="font-medium text-green-600">公開</span> で登録されます。
              追加後に管理画面から配信情報・ポスター画像を補完できます。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// 型ラベルの再エクスポート（admin WorkCard で使用）
export { WORK_TYPE_LABEL };
