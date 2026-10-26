'use client';

// 人物の所属履歴（person_group_memberships）の編集。現在の所属と過去の所属を分けて表示し、
// グループごとに所属状態・加入日・脱退/卒業日を変更できる。保存は /api/admin/person-memberships。
// 日付が不明な場合は空欄のまま保存する（推測で埋めない）。
import { useEffect, useState } from 'react';
import type { ActivityStatus } from './work-check-types';
import type { MembershipRecord, ResolvedMembership } from '@/lib/group-membership';

const STATUS_OPTIONS: { value: ActivityStatus; label: string }[] = [
  { value: 'active', label: '現役' },
  { value: 'hiatus', label: '休止中' },
  { value: 'graduated', label: '卒業' },
  { value: 'withdrawn', label: '脱退' },
  { value: 'retired', label: '引退' },
  { value: 'unknown', label: '不明' },
];

interface Row {
  key: string;
  groupName: string;
  activityStatus: ActivityStatus;
  joinedAt: string;
  leftAt: string;
  note: string;
  /** 保存済みの行（グループ名の変更は「削除＋追加」として扱う） */
  savedGroupName?: string;
}

const isCurrent = (s: ActivityStatus) => s === 'active' || s === 'hiatus' || s === 'unknown';

function toRows(records: MembershipRecord[]): Row[] {
  return records.map((r) => ({
    key: `${r.groupName}`,
    groupName: r.groupName,
    activityStatus: r.activityStatus,
    joinedAt: r.joinedAt ?? '',
    leftAt: r.leftAt ?? '',
    note: r.note ?? '',
    savedGroupName: r.groupName,
  }));
}

interface Props {
  personName: string;
  registeredGroup: string;
  onSaved: (result: { memberships: ResolvedMembership[]; records: MembershipRecord[]; currentGroupName: string | null }) => void;
}

export default function MembershipEditor({ personName, registeredGroup, onSaved }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/person-memberships?person=${encodeURIComponent(personName)}`)
      .then((r) => r.json())
      .then((d: { records?: MembershipRecord[]; error?: string }) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        setRows(toRows(d.records ?? []));
      })
      .catch(() => { if (!cancelled) { setError('所属履歴を取得できませんでした'); setRows([]); } });
    return () => { cancelled = true; };
  }, [personName]);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => (prev ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function remove(row: Row) {
    if (row.savedGroupName && !window.confirm(`${row.savedGroupName} の所属履歴を削除しますか？（人物・作品データは削除されません）`)) return;
    if (row.savedGroupName) setRemoved((prev) => [...prev, row.savedGroupName!]);
    setRows((prev) => (prev ?? []).filter((r) => r.key !== row.key));
  }

  function add(initialGroup = '') {
    setRows((prev) => [
      ...(prev ?? []),
      { key: `new-${Date.now()}`, groupName: initialGroup, activityStatus: 'active', joinedAt: '', leftAt: '', note: '' },
    ]);
  }

  async function save() {
    if (!rows) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const renamedFrom = rows.filter((r) => r.savedGroupName && r.savedGroupName !== r.groupName.trim()).map((r) => r.savedGroupName!);
      const res = await fetch('/api/admin/person-memberships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personName,
          memberships: rows.map((r) => ({
            groupName: r.groupName.trim(),
            activityStatus: r.activityStatus,
            joinedAt: r.joinedAt.trim() || null,
            leftAt: r.leftAt.trim() || null,
            note: r.note.trim() || null,
          })),
          removeGroups: [...removed, ...renamedFrom],
        }),
      });
      const d = (await res.json()) as { error?: string; records?: MembershipRecord[]; memberships?: ResolvedMembership[]; currentGroupName?: string | null; groupsCreated?: string[] };
      if (!res.ok || d.error) { setError(d.error ?? '保存に失敗しました'); return; }
      setRows(toRows(d.records ?? []));
      setRemoved([]);
      setMessage(`保存しました${d.groupsCreated?.length ? `（グループ登録：${d.groupsCreated.join('・')}）` : ''}`);
      onSaved({ memberships: d.memberships ?? [], records: d.records ?? [], currentGroupName: d.currentGroupName ?? null });
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setSaving(false);
    }
  }

  if (!rows) return <p className="text-xs text-gray-400">所属履歴を読み込み中…</p>;

  const current = rows.filter((r) => isCurrent(r.activityStatus));
  const past = rows.filter((r) => !isCurrent(r.activityStatus));

  const renderRow = (r: Row) => (
    <div key={r.key} className="flex items-center gap-1.5 flex-wrap">
      <input
        type="text"
        value={r.groupName}
        onChange={(e) => update(r.key, { groupName: e.target.value })}
        placeholder="グループ名"
        className="w-36 text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-amber-300"
      />
      <select
        value={r.activityStatus}
        onChange={(e) => update(r.key, { activityStatus: e.target.value as ActivityStatus })}
        className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-amber-300"
      >
        {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <label className="text-[11px] text-gray-500">加入</label>
      <input
        type="text"
        value={r.joinedAt}
        onChange={(e) => update(r.key, { joinedAt: e.target.value })}
        placeholder="不明なら空欄"
        className="w-24 text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-amber-300"
      />
      <label className="text-[11px] text-gray-500">脱退・卒業</label>
      <input
        type="text"
        value={r.leftAt}
        onChange={(e) => update(r.key, { leftAt: e.target.value })}
        placeholder={isCurrent(r.activityStatus) ? '—' : '不明なら空欄'}
        disabled={r.activityStatus === 'active' || r.activityStatus === 'hiatus'}
        className="w-24 text-xs border border-gray-200 rounded px-1.5 py-1 bg-white disabled:bg-gray-100 focus:outline-none focus:ring-1 focus:ring-amber-300"
      />
      <button onClick={() => remove(r)} className="text-[11px] text-gray-400 hover:text-red-500 px-1" title="この所属履歴を削除">✕</button>
    </div>
  );

  return (
    <div className="rounded-lg border border-amber-200 bg-white/70 px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold text-slate-700">所属履歴（グループごと）</p>
        <p className="text-[10px] text-gray-400">登録グループ：{registeredGroup || 'なし'}（人物IDは変わりません）</p>
      </div>
      {rows.length === 0 && (
        <div className="text-[11px] text-gray-500 space-y-1">
          <p>所属履歴は未登録です。現在は登録グループと下の旧項目（活動状態・加入日・卒業日）で表示しています。</p>
          {registeredGroup && (
            <button onClick={() => add(registeredGroup)} className="text-indigo-600 hover:underline">
              ＋ {registeredGroup} の所属から始める
            </button>
          )}
        </div>
      )}
      {current.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-green-700">現在の所属</p>
          {current.map(renderRow)}
        </div>
      )}
      {past.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-gray-500">過去の所属（脱退・卒業はこのグループとの所属だけに適用）</p>
          {past.map(renderRow)}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => add()} className="text-xs px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 text-slate-600">
          ＋ 所属を追加
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="text-xs px-3 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {saving ? '保存中…' : '所属履歴を保存'}
        </button>
        {message && <span className="text-[11px] text-green-700">{message}</span>}
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
    </div>
  );
}
