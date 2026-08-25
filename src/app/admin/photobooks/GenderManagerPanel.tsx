'use client';

// 人物・グループの gender（写真集機能用）を安全に設定するための管理パネル。
// 通常の写真集商品一覧（PhotobookAdminClient）とは明確に分離している。
//
// 重要: このコンポーネントは「絞り込みで対象を探しやすくする」だけで、絞り込み操作
// 自体がgenderを保存することは一切ない。保存は必ず「対象を選択→ボタンを押す」という
// 管理者の明示的な操作でのみ発生する（女優/俳優等のジャンルからの自動保存は行わない）。

import { useEffect, useMemo, useState } from 'react';
import type { PersonGenderRow, GroupGenderRow } from '@/lib/photobook-store';
import {
  filterPersonGenderRows,
  filterGroupGenderRows,
  DEFAULT_PERSON_GENDER_FILTERS,
  type PersonGenderFilters,
  type GroupGenderFilters,
  type PersonGenderFilterValue,
  type PersonGenreFilterValue,
  type GroupAffiliationFilterValue,
} from '@/lib/photobook-gender';

type Gender = 'female' | 'male' | null;

const GENDER_LABEL: Record<'female' | 'male', string> = { female: '女性', male: '男性' };

function GenderBadge({ gender }: { gender: Gender }) {
  if (gender === 'female') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-pink-50 text-pink-600 font-medium">女性</span>;
  if (gender === 'male') return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">男性</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 font-medium">未設定</span>;
}

async function postGender(url: string, key: 'personNames' | 'groupNames', names: string[], gender: Gender) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [key]: names, gender }),
  });
  if (!res.ok) throw new Error('保存に失敗しました');
  return res.json() as Promise<{ ok: true; updated: number }>;
}

// ─── 人物パネル ────────────────────────────────────────────────────────────────
function PersonGenderPanel() {
  const [rows, setRows] = useState<PersonGenderRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState<PersonGenderFilters>(DEFAULT_PERSON_GENDER_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/photobooks/gender/persons');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '取得に失敗しました');
      setRows(data.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => filterPersonGenderRows(rows ?? [], filters), [rows, filters]);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected(new Set(filtered.map((r) => r.personName)));
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function applyGender(gender: Gender) {
    if (selected.size === 0) return;
    const label = gender === 'female' ? '女性' : gender === 'male' ? '男性' : '未設定';
    const targets = [...selected];
    if (!window.confirm(`${targets.length}人を${label}に設定します。よろしいですか？`)) return;
    setSaving(true);
    setError('');
    try {
      await postGender('/api/admin/photobooks/gender/persons', 'personNames', targets, gender);
      setRows((prev) => prev?.map((r) => (targets.includes(r.personName) ? { ...r, gender } : r)) ?? prev);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-bold text-slate-800">人物 gender設定</h3>
      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {/* 絞り込み */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={filters.query ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          placeholder="人物名で検索"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs min-w-[160px]"
        />
        <select
          value={filters.gender ?? 'all'}
          onChange={(e) => setFilters((f) => ({ ...f, gender: e.target.value as PersonGenderFilterValue }))}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
        >
          <option value="all">gender: すべて</option>
          <option value="unset">未設定</option>
          <option value="female">女性</option>
          <option value="male">男性</option>
        </select>
        <select
          value={filters.genre ?? 'all'}
          onChange={(e) => setFilters((f) => ({ ...f, genre: e.target.value as PersonGenreFilterValue }))}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
        >
          <option value="all">ジャンル: すべて</option>
          <option value="女優">女優</option>
          <option value="俳優">俳優</option>
          <option value="アイドル">アイドル</option>
          <option value="歌手">歌手</option>
          <option value="その他">その他</option>
        </select>
        <select
          value={filters.groupAffiliation ?? 'all'}
          onChange={(e) => setFilters((f) => ({ ...f, groupAffiliation: e.target.value as GroupAffiliationFilterValue }))}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
        >
          <option value="all">所属: すべて</option>
          <option value="has_group">グループ所属あり</option>
          <option value="no_group">グループ所属なし</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={!!filters.hasCandidatesOnly}
            onChange={(e) => setFilters((f) => ({ ...f, hasCandidatesOnly: e.target.checked }))}
          />
          写真集候補ありのみ
        </label>
        <span className="text-[11px] text-gray-400 ml-auto">{loading ? '読込中...' : `${filtered.length}件`}</span>
      </div>

      {/* 選択補助・一括操作 */}
      <div className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <button onClick={selectAllFiltered} className="text-[11px] text-indigo-600 hover:underline">現在の絞り込み結果をすべて選択</button>
        <button onClick={clearSelection} className="text-[11px] text-gray-500 hover:underline">選択解除</button>
        <span className="text-[11px] text-gray-500">選択中: {selected.size}人</span>
        <div className="ml-auto flex gap-2">
          <button disabled={selected.size === 0 || saving} onClick={() => void applyGender('female')} className="text-[11px] px-3 py-1.5 rounded-lg bg-pink-50 text-pink-700 hover:bg-pink-100 disabled:opacity-40">女性に設定</button>
          <button disabled={selected.size === 0 || saving} onClick={() => void applyGender('male')} className="text-[11px] px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40">男性に設定</button>
          <button disabled={selected.size === 0 || saving} onClick={() => void applyGender(null)} className="text-[11px] px-3 py-1.5 rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300 disabled:opacity-40">未設定に戻す</button>
        </div>
      </div>

      {/* 一覧 */}
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-gray-100 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="p-2 w-8"></th>
              <th className="p-2 text-left">人物名</th>
              <th className="p-2 text-left">主ジャンル</th>
              <th className="p-2 text-left">所属グループ</th>
              <th className="p-2 text-left">現在のgender</th>
              <th className="p-2 text-right">写真集候補</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.personName} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="p-2">
                  <input type="checkbox" checked={selected.has(row.personName)} onChange={() => toggle(row.personName)} />
                </td>
                <td className="p-2 font-medium text-slate-700">{row.personName}</td>
                <td className="p-2 text-gray-500">{row.primaryGenre || row.genre}</td>
                <td className="p-2 text-gray-500">{row.groupName || '（なし）'}</td>
                <td className="p-2"><GenderBadge gender={row.gender} /></td>
                <td className="p-2 text-right text-gray-500">{row.photobookCandidateCount}</td>
              </tr>
            ))}
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={6} className="p-6 text-center text-gray-400">条件に一致する人物がいません</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── グループパネル ──────────────────────────────────────────────────────────────
function GroupGenderPanel() {
  const [rows, setRows] = useState<GroupGenderRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState<GroupGenderFilters>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/photobooks/gender/groups');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '取得に失敗しました');
      setRows(data.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => filterGroupGenderRows(rows ?? [], filters), [rows, filters]);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }
  function selectAllFiltered() { setSelected(new Set(filtered.map((r) => r.groupName))); }
  function clearSelection() { setSelected(new Set()); }

  async function applyGender(gender: Gender) {
    if (selected.size === 0) return;
    const label = gender === 'female' ? '女性' : gender === 'male' ? '男性' : '未設定';
    const targets = [...selected];
    if (!window.confirm(`${targets.length}グループを${label}に設定します。よろしいですか？`)) return;
    setSaving(true);
    setError('');
    try {
      await postGender('/api/admin/photobooks/gender/groups', 'groupNames', targets, gender);
      setRows((prev) => prev?.map((r) => (targets.includes(r.groupName) ? { ...r, gender } : r)) ?? prev);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-bold text-slate-800">グループ gender設定</h3>
      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={filters.query ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          placeholder="グループ名で検索"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-xs min-w-[160px]"
        />
        <select
          value={filters.gender ?? 'all'}
          onChange={(e) => setFilters((f) => ({ ...f, gender: e.target.value as PersonGenderFilterValue }))}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
        >
          <option value="all">gender: すべて</option>
          <option value="unset">未設定</option>
          <option value="female">女性</option>
          <option value="male">男性</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={!!filters.hasCandidatesOnly}
            onChange={(e) => setFilters((f) => ({ ...f, hasCandidatesOnly: e.target.checked }))}
          />
          写真集候補ありのみ
        </label>
        <span className="text-[11px] text-gray-400 ml-auto">{loading ? '読込中...' : `${filtered.length}件`}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
        <button onClick={selectAllFiltered} className="text-[11px] text-indigo-600 hover:underline">現在の絞り込み結果をすべて選択</button>
        <button onClick={clearSelection} className="text-[11px] text-gray-500 hover:underline">選択解除</button>
        <span className="text-[11px] text-gray-500">選択中: {selected.size}グループ</span>
        <div className="ml-auto flex gap-2">
          <button disabled={selected.size === 0 || saving} onClick={() => void applyGender('female')} className="text-[11px] px-3 py-1.5 rounded-lg bg-pink-50 text-pink-700 hover:bg-pink-100 disabled:opacity-40">女性に設定</button>
          <button disabled={selected.size === 0 || saving} onClick={() => void applyGender('male')} className="text-[11px] px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40">男性に設定</button>
          <button disabled={selected.size === 0 || saving} onClick={() => void applyGender(null)} className="text-[11px] px-3 py-1.5 rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300 disabled:opacity-40">未設定に戻す</button>
        </div>
      </div>

      <div className="overflow-x-auto max-h-[320px] overflow-y-auto border border-gray-100 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="p-2 w-8"></th>
              <th className="p-2 text-left">グループ名</th>
              <th className="p-2 text-left">現在のgender</th>
              <th className="p-2 text-right">所属人数</th>
              <th className="p-2 text-right">写真集候補</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.groupName} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="p-2">
                  <input type="checkbox" checked={selected.has(row.groupName)} onChange={() => toggle(row.groupName)} />
                </td>
                <td className="p-2 font-medium text-slate-700">{row.groupName}</td>
                <td className="p-2"><GenderBadge gender={row.gender} /></td>
                <td className="p-2 text-right text-gray-500">{row.memberCount}</td>
                <td className="p-2 text-right text-gray-500">{row.photobookCandidateCount}</td>
              </tr>
            ))}
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={5} className="p-6 text-center text-gray-400">条件に一致するグループがいません</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GenderManagerPanel() {
  return (
    <details className="bg-indigo-50/40 border border-indigo-200 rounded-xl p-4" open>
      <summary className="text-sm font-bold text-indigo-900 cursor-pointer mb-1">
        人物・グループ gender設定（写真集の女性/男性タブ振り分け用）
      </summary>
      <p className="text-[11px] text-gray-500 mt-2 mb-4">
        ジャンル等の絞り込みは対象を探しやすくするためだけのものです。ジャンルを選んだだけでは何も保存されません。
        対象人物・グループにチェックを入れて「女性に設定」「男性に設定」ボタンを押した場合のみ保存されます。
        AIによる自動推測は行いません。
      </p>
      <div className="space-y-4">
        <PersonGenderPanel />
        <GroupGenderPanel />
      </div>
    </details>
  );
}
