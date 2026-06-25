'use client';

import { useState } from 'react';
import type { GroupMeta, GroupActivityStatus } from '@/types/group';

const STATUS_OPTIONS: { value: GroupActivityStatus; label: string }[] = [
  { value: 'active',    label: '活動中' },
  { value: 'renamed',  label: '改名済み' },
  { value: 'disbanded', label: '解散' },
  { value: 'hiatus',   label: '活動休止' },
  { value: 'unknown',  label: '不明' },
];

const STATUS_BADGE: Record<GroupActivityStatus, string> = {
  active:    'bg-green-100 text-green-700',
  renamed:   'bg-blue-100 text-blue-700',
  disbanded: 'bg-red-100 text-red-600',
  hiatus:    'bg-amber-100 text-amber-700',
  unknown:   'bg-gray-100 text-gray-400',
};

// ─── 追加フォーム ──────────────────────────────────────────────────────────────
interface AddFormProps {
  onAdded: (record: GroupMeta) => void;
}

function AddForm({ onAdded }: AddFormProps) {
  const [open, setOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [slug, setSlug] = useState('');
  const [activityStatus, setActivityStatus] = useState<GroupActivityStatus>('active');
  const [formedAt, setFormedAt] = useState('');
  const [endedAt, setEndedAt] = useState('');
  const [renamedFrom, setRenamedFrom] = useState('');
  const [renamedTo, setRenamedTo] = useState('');
  const [formerNamesStr, setFormerNamesStr] = useState('');
  const [officialSite, setOfficialSite] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function autoSlug() {
    setSlug(encodeURIComponent(groupName));
  }

  function reset() {
    setGroupName(''); setSlug(''); setActivityStatus('active');
    setFormedAt(''); setEndedAt(''); setRenamedFrom(''); setRenamedTo('');
    setFormerNamesStr(''); setOfficialSite(''); setNote('');
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) { setError('グループ名は必須です'); return; }
    setSaving(true); setError('');
    try {
      const formerNames = formerNamesStr.split(/[,、\n]/).map((s) => s.trim()).filter(Boolean);
      const res = await fetch('/api/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupName: groupName.trim(),
          slug: slug.trim() || groupName.trim(),
          activityStatus,
          formedAt: formedAt.trim() || undefined,
          endedAt: endedAt.trim() || undefined,
          renamedFrom: renamedFrom.trim() || undefined,
          renamedTo: renamedTo.trim() || undefined,
          formerNames,
          officialSite: officialSite.trim() || undefined,
          note: note.trim() || undefined,
          createdAt: Date.now(),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? '登録に失敗しました');
        return;
      }
      const record = await res.json() as GroupMeta;
      onAdded(record);
      reset();
      setOpen(false);
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-6 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
      >
        + グループを追加
      </button>
    );
  }

  return (
    <div className="mb-6 bg-indigo-50 border border-indigo-200 rounded-2xl p-5">
      <h2 className="font-bold text-indigo-900 text-sm mb-3">グループ追加</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">グループ名 *</label>
            <input type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)}
              placeholder="例: 乃木坂46"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">slug</label>
            <div className="flex gap-1">
              <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)}
                placeholder="URLスラッグ"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              <button type="button" onClick={autoSlug}
                className="px-2 py-2 text-xs text-indigo-600 border border-indigo-300 rounded-lg hover:bg-indigo-50">
                自動
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">活動状態</label>
            <select value={activityStatus} onChange={(e) => setActivityStatus(e.target.value as GroupActivityStatus)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">結成日</label>
            <input type="text" value={formedAt} onChange={(e) => setFormedAt(e.target.value)}
              placeholder="例: 2011-08"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">改名/解散日</label>
            <input type="text" value={endedAt} onChange={(e) => setEndedAt(e.target.value)}
              placeholder="例: 2020-10"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">改名前</label>
            <input type="text" value={renamedFrom} onChange={(e) => setRenamedFrom(e.target.value)}
              placeholder="例: 欅坂46"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">改名後</label>
            <input type="text" value={renamedTo} onChange={(e) => setRenamedTo(e.target.value)}
              placeholder="例: 櫻坂46"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              旧グループ名（カンマ区切り）
            </label>
            <input type="text" value={formerNamesStr} onChange={(e) => setFormerNamesStr(e.target.value)}
              placeholder="例: 欅坂46, 欅坂"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">公式サイト</label>
            <input type="text" value={officialSite} onChange={(e) => setOfficialSite(e.target.value)}
              placeholder="https://..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">備考</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="補足情報など"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={() => { reset(); setOpen(false); }}
            className="px-3 py-2 text-sm text-gray-500 border border-gray-300 rounded-xl hover:bg-gray-50">
            キャンセル
          </button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50">
            {saving ? '登録中…' : '登録する'}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </div>
  );
}

// ─── インライン編集行 ──────────────────────────────────────────────────────────
interface EditRowProps {
  record: GroupMeta;
  onSaved: (updated: GroupMeta) => void;
  onCancel: () => void;
}

function EditRow({ record, onSaved, onCancel }: EditRowProps) {
  const [activityStatus, setActivityStatus] = useState<GroupActivityStatus>(record.activityStatus);
  const [formedAt, setFormedAt] = useState(record.formedAt ?? '');
  const [endedAt, setEndedAt] = useState(record.endedAt ?? '');
  const [renamedFrom, setRenamedFrom] = useState(record.renamedFrom ?? '');
  const [renamedTo, setRenamedTo] = useState(record.renamedTo ?? '');
  const [formerNamesStr, setFormerNamesStr] = useState((record.formerNames ?? []).join(', '));
  const [officialSite, setOfficialSite] = useState(record.officialSite ?? '');
  const [note, setNote] = useState(record.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const formerNames = formerNamesStr.split(/[,、\n]/).map((s) => s.trim()).filter(Boolean);
      const res = await fetch('/api/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...record,
          activityStatus,
          formedAt: formedAt.trim() || undefined,
          endedAt: endedAt.trim() || undefined,
          renamedFrom: renamedFrom.trim() || undefined,
          renamedTo: renamedTo.trim() || undefined,
          formerNames,
          officialSite: officialSite.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? '保存に失敗しました');
        return;
      }
      const updated = await res.json() as GroupMeta;
      onSaved(updated);
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-indigo-50 border-t border-indigo-100 px-4 py-4 space-y-3">
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">活動状態</label>
          <select value={activityStatus} onChange={(e) => setActivityStatus(e.target.value as GroupActivityStatus)}
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">結成日</label>
          <input type="text" value={formedAt} onChange={(e) => setFormedAt(e.target.value)}
            placeholder="例: 2011-08"
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">改名/解散日</label>
          <input type="text" value={endedAt} onChange={(e) => setEndedAt(e.target.value)}
            placeholder="例: 2020-10"
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">改名前</label>
          <input type="text" value={renamedFrom} onChange={(e) => setRenamedFrom(e.target.value)}
            placeholder="例: 欅坂46"
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">改名後</label>
          <input type="text" value={renamedTo} onChange={(e) => setRenamedTo(e.target.value)}
            placeholder="例: 櫻坂46"
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">旧グループ名（カンマ区切り）</label>
          <input type="text" value={formerNamesStr} onChange={(e) => setFormerNamesStr(e.target.value)}
            placeholder="例: 欅坂46"
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">公式サイト</label>
          <input type="text" value={officialSite} onChange={(e) => setOfficialSite(e.target.value)}
            placeholder="https://..."
            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-1">備考</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="補足情報"
          className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
          {saving ? '保存中…' : '保存'}
        </button>
        <button onClick={onCancel}
          className="px-3 py-1.5 text-xs text-gray-500 border border-gray-300 rounded-lg hover:bg-gray-50">
          取消
        </button>
      </div>
    </div>
  );
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────
interface Props {
  initialMetas: GroupMeta[];
}

export default function GroupManager({ initialMetas }: Props) {
  const [metas, setMetas] = useState<GroupMeta[]>(initialMetas);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  function handleAdded(record: GroupMeta) {
    setMetas((prev) => {
      const filtered = prev.filter((g) => g.groupName !== record.groupName);
      return [...filtered, record].sort((a, b) => a.groupName.localeCompare(b.groupName, 'ja'));
    });
  }

  function handleSaved(updated: GroupMeta) {
    setMetas((prev) => prev.map((g) => (g.groupName === updated.groupName ? updated : g)));
    setEditingName(null);
  }

  async function handleDelete(groupName: string) {
    if (deletingName !== groupName) { setDeletingName(groupName); return; }
    try {
      await fetch('/api/admin/groups', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName }),
      });
      setMetas((prev) => prev.filter((g) => g.groupName !== groupName));
    } catch { /* ignore */ } finally {
      setDeletingName(null);
    }
  }

  return (
    <>
      <AddForm onAdded={handleAdded} />

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-700 text-sm">
            登録済みグループ
            <span className="ml-2 text-gray-400 font-normal text-xs">{metas.length}件</span>
          </h2>
        </div>

        {metas.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400 text-sm">
            まだ登録されていません。「+ グループを追加」から追加してください。
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {metas.map((g) => (
              <div key={g.groupName}>
                <div className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-800 text-sm">{g.groupName}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[g.activityStatus]}`}>
                        {STATUS_OPTIONS.find((o) => o.value === g.activityStatus)?.label}
                      </span>
                      {g.renamedFrom && (
                        <span className="text-[10px] text-gray-400">旧名: {g.renamedFrom}</span>
                      )}
                      {g.renamedTo && (
                        <span className="text-[10px] text-blue-500">→ {g.renamedTo}</span>
                      )}
                      {(g.formerNames ?? []).length > 0 && (
                        <span className="text-[10px] text-gray-400">
                          旧G: {g.formerNames!.join(' / ')}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1 text-[11px] text-gray-400">
                      {g.formedAt && <span>結成: {g.formedAt}</span>}
                      {g.endedAt && <span>改名/解散: {g.endedAt}</span>}
                      {g.note && <span className="text-gray-500">{g.note}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => setEditingName(editingName === g.groupName ? null : g.groupName)}
                      className="px-2 py-1 text-xs text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDelete(g.groupName)}
                      className={`px-2 py-1 text-xs rounded-lg border transition-colors ${
                        deletingName === g.groupName
                          ? 'bg-red-600 text-white border-red-600'
                          : 'text-red-400 border-red-200 hover:bg-red-50'
                      }`}
                    >
                      {deletingName === g.groupName ? '確認: 削除' : '削除'}
                    </button>
                    {deletingName === g.groupName && (
                      <button
                        onClick={() => setDeletingName(null)}
                        className="px-2 py-1 text-xs text-gray-400 border border-gray-200 rounded-lg hover:bg-gray-50"
                      >
                        取消
                      </button>
                    )}
                  </div>
                </div>
                {editingName === g.groupName && (
                  <EditRow
                    record={g}
                    onSaved={handleSaved}
                    onCancel={() => setEditingName(null)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
