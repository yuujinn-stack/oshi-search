'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { PersonOption } from '@/components/admin/PersonCombobox';
import { getEffectiveGroup, createGroupList } from './group-utils';

// ── localStorage ───────────────────────────────────────────────────────────────
const RECENT_KEY = 'rakuten-person-recent';
const MAX_RECENT = 12;

function readRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]; } catch { return []; }
}

export function recordRecentPersons(names: string[]) {
  const prev = readRecent().filter((n) => !names.includes(n));
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([...names, ...prev].slice(0, MAX_RECENT))); } catch { /* ignore */ }
}

// ── status ────────────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  graduated: '卒', withdrawn: '脱', hiatus: '休', retired: '引退', unknown: '?',
};
const STATUS_COLOR: Record<string, string> = {
  graduated: 'text-sky-500', withdrawn: 'text-red-400',
  hiatus: 'text-amber-500', retired: 'text-gray-400',
};

// ── helpers ───────────────────────────────────────────────────────────────────
function genNum(g: string): number {
  return parseInt(g.replace(/\D/g, '') || '0', 10);
}

function normalizeGeneration(g: string): string {
  const n = genNum(g);
  if (n === 0) return g;
  return `${n}期生`;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  persons: PersonOption[];
  selected: string[];
  onAdd: (names: string[]) => void;
  onRemove: (name: string) => void;
}

export default function PersonMultiPicker({ persons, selected, onAdd, onRemove }: Props) {
  const [activityFilter, setActivityFilter] = useState<'active' | 'all'>('active');
  const [groupFilter, setGroupFilter] = useState('');
  const [generationFilter, setGenerationFilter] = useState('');
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<string[]>([]);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setRecent(readRecent()); }, []);


  // Remove from checked when persons become selected
  useEffect(() => {
    setChecked((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const n of selected) { if (next.delete(n)) changed = true; }
      return changed ? next : prev;
    });
  }, [selected]);

  // Reset generation filter when group changes
  useEffect(() => {
    setGenerationFilter('');
  }, [groupFilter]);

  // ── derived ────────────────────────────────────────────────────────────────
  const allGroups = useMemo(() => createGroupList(persons), [persons]);

  // All persons in selected group (no activity/selection filter) — source for generation tabs
  const groupPersons = useMemo(() =>
    groupFilter ? persons.filter((p) => getEffectiveGroup(p) === groupFilter) : [],
    [groupFilter, persons],
  );

  const generationNamesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of groupPersons) {
      if (!p.generation) continue;
      const norm = normalizeGeneration(p.generation);
      const list = map.get(norm) ?? [];
      list.push(p.name);
      map.set(norm, list);
    }
    return map;
  }, [groupPersons]);

  const generations = useMemo(() =>
    [...generationNamesMap.keys()].sort((a, b) => genNum(a) - genNum(b)),
    [generationNamesMap],
  );

  // Persons not yet added, filtered by activity + group + generation
  const baseFiltered = useMemo(() => persons.filter((p) => {
    if (selected.includes(p.name)) return false;
    if (activityFilter === 'active' && p.activityStatus && p.activityStatus !== 'active') return false;
    if (groupFilter && getEffectiveGroup(p) !== groupFilter) return false;
    if (generationFilter && (!p.generation || normalizeGeneration(p.generation) !== generationFilter)) return false;
    return true;
  }), [persons, selected, activityFilter, groupFilter, generationFilter]);

  // Final display list (search applied)
  const filteredPersons = useMemo(() => {
    if (!search.trim()) return baseFiltered;
    const s = search.toLowerCase();
    return baseFiltered.filter((p) =>
      p.name.toLowerCase().includes(s) ||
      (p.aliases ?? []).some((a) => a.toLowerCase().includes(s))
    );
  }, [baseFiltered, search]);

  const allFilteredChecked = filteredPersons.length > 0 && filteredPersons.every((p) => checked.has(p.name));

  const addableChecked = useMemo(() =>
    [...checked].filter((n) => !selected.includes(n)),
    [checked, selected],
  );

  const availableRecent = useMemo(() =>
    recent.filter((n) => !selected.includes(n) && persons.some((p) => p.name === n)),
    [recent, selected, persons],
  );

  // Active/total counts per group (for tab hints)
  const groupActiveCounts = useMemo(() => {
    const map = new Map<string, { active: number; total: number }>();
    for (const g of allGroups) {
      const inGroup = persons.filter((p) => !selected.includes(p.name) && getEffectiveGroup(p) === g);
      const active = inGroup.filter((p) => !p.activityStatus || p.activityStatus === 'active').length;
      map.set(g, { active, total: inGroup.length });
    }
    return map;
  }, [allGroups, persons, selected]);

  // ── actions ────────────────────────────────────────────────────────────────
  function togglePerson(name: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const selectAllFiltered = useCallback(() => {
    setChecked((prev) => new Set([...prev, ...filteredPersons.map((p) => p.name)]));
  }, [filteredPersons]);

  const deselectAllFiltered = useCallback(() => {
    const fset = new Set(filteredPersons.map((p) => p.name));
    setChecked((prev) => new Set([...prev].filter((n) => !fset.has(n))));
  }, [filteredPersons]);

  function handleGroupClick(g: string) {
    const newFilter = g === groupFilter ? '' : g;
    setGroupFilter(newFilter);
    if (newFilter) {
      const counts = groupActiveCounts.get(newFilter);
      if (counts && counts.active === 0) {
        setActivityFilter('all');
      }
    }
  }

  function handleAdd(names?: string[]) {
    const toAdd = names ?? addableChecked;
    if (toAdd.length === 0) return;
    onAdd(toAdd);
    recordRecentPersons(toAdd);
    setRecent(readRecent());
    if (!names) { setChecked(new Set()); setSearch(''); }
  }

  function applyCSV() {
    const names = csvText.split(/[\n,、]/).map((s) => s.trim()).filter(Boolean);
    const valid = names.filter((n) => !selected.includes(n) && persons.some((p) => p.name === n));
    if (valid.length > 0) {
      onAdd(valid);
      recordRecentPersons(valid);
      setRecent(readRecent());
    }
    setCsvText('');
    setCsvOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (addableChecked.length > 0) {
        handleAdd();
      } else if (filteredPersons.length === 1) {
        handleAdd([filteredPersons[0].name]);
        setSearch('');
      } else if (filteredPersons.length > 0) {
        togglePerson(filteredPersons[0].name);
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      if (allFilteredChecked) deselectAllFiltered(); else selectAllFiltered();
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      {/* Activity filter */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[11px] font-medium">
        {(['active', 'all'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setActivityFilter(f)}
            className={`flex-1 py-1.5 transition-colors ${
              activityFilter === f ? 'bg-slate-700 text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}>
            {f === 'active' ? '現役のみ' : '卒業含む'}
          </button>
        ))}
      </div>

      {/* Group tabs */}
      {allGroups.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => setGroupFilter('')}
            className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 transition-colors ${
              groupFilter === '' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-500 hover:border-indigo-300'
            }`}>
            すべて
          </button>
          {allGroups.map((g) => {
            const counts = groupActiveCounts.get(g) ?? { active: 0, total: 0 };
            const isActive = groupFilter === g;
            const allGraduated = activityFilter === 'active' && counts.active === 0 && counts.total > 0;
            return (
              <button key={g} type="button" onClick={() => handleGroupClick(g)}
                title={`現役: ${counts.active}人 / 合計: ${counts.total}人`}
                className={`text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : allGraduated
                    ? 'border-gray-200 text-gray-300 hover:border-amber-200 hover:text-amber-500'
                    : 'border-gray-200 text-gray-500 hover:border-indigo-300'
                }`}>
                {g}
                {allGraduated && <span className="ml-0.5 text-amber-400">卒</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Generation tabs — shown only when a group is selected and has generation data */}
      {generations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => setGenerationFilter('')}
            className={`text-[10px] px-2 py-0.5 rounded-md border transition-colors ${
              generationFilter === ''
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-blue-200 text-blue-600 hover:bg-blue-50'
            }`}>
            全期
          </button>
          {generations.map((gen) => {
            const count = (generationNamesMap.get(gen) ?? []).length;
            return (
              <button
                key={gen}
                type="button"
                onClick={() => setGenerationFilter(gen === generationFilter ? '' : gen)}
                className={`text-[10px] px-2 py-0.5 rounded-md border transition-colors ${
                  generationFilter === gen
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-blue-200 text-blue-600 hover:bg-blue-50'
                }`}
              >
                {gen}
                <span className="ml-0.5 opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Recent quick-add */}
      {availableRecent.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-[9px] text-gray-300 font-medium shrink-0">最近</span>
          {availableRecent.map((name) => (
            <button key={name} type="button" onClick={() => handleAdd([name])}
              className="text-[10px] px-1.5 py-0.5 rounded bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-100 transition-colors whitespace-nowrap">
              {name} +
            </button>
          ))}
        </div>
      )}

      {/* Search + select buttons */}
      <div className="flex gap-1 items-center">
        <input ref={inputRef} type="text" value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="絞り込み... (Ctrl+A: 全選択)"
          className="flex-1 min-w-0 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-300" />
        <button type="button" onClick={selectAllFiltered}
          className="text-[10px] shrink-0 px-1.5 py-1.5 rounded border border-gray-200 text-gray-500 hover:bg-slate-100 transition-colors whitespace-nowrap">
          全選択
        </button>
        <button type="button" onClick={deselectAllFiltered}
          className="text-[10px] shrink-0 px-1.5 py-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors whitespace-nowrap">
          解除
        </button>
      </div>

      {/* Person list */}
      <div className="border border-gray-200 rounded-lg overflow-y-auto bg-white" style={{ maxHeight: '13rem' }}>
        {filteredPersons.length === 0 ? (
          <div className="py-5 px-3 text-center space-y-1.5">
            <p className="text-[11px] text-gray-300">表示する人物がありません</p>
            {activityFilter === 'active' && (groupFilter || generationFilter) && (
              <button type="button" onClick={() => setActivityFilter('all')}
                className="text-[10px] text-indigo-400 hover:text-indigo-600 underline block mx-auto">
                卒業メンバーも表示する
              </button>
            )}
          </div>
        ) : (
          filteredPersons.map((p) => {
            const isChecked = checked.has(p.name);
            return (
              <label key={p.name}
                className={`flex items-center gap-2 px-2.5 py-1.5 cursor-pointer transition-colors border-b border-gray-50 last:border-0 ${
                  isChecked ? 'bg-indigo-50' : 'hover:bg-slate-50'
                }`}
              >
                <input type="checkbox" checked={isChecked} onChange={() => togglePerson(p.name)} className="sr-only" />
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                  isChecked ? 'bg-slate-700 border-slate-700' : 'border-gray-300'
                }`}>
                  {isChecked && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span className="text-xs text-slate-700 flex-1 leading-tight">{p.name}</span>
                {p.generation && (
                  <span className="text-[9px] text-gray-300 shrink-0">{normalizeGeneration(p.generation)}</span>
                )}
                {p.activityStatus && p.activityStatus !== 'active' && (
                  <span className={`text-[9px] shrink-0 ${STATUS_COLOR[p.activityStatus] ?? 'text-gray-400'}`}>
                    {STATUS_LABEL[p.activityStatus] ?? p.activityStatus}
                  </span>
                )}
              </label>
            );
          })
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between text-[10px] px-0.5">
        <span className="text-gray-400">{filteredPersons.length}人表示</span>
        {addableChecked.length > 0 && (
          <span className="text-indigo-600 font-medium">{addableChecked.length}人チェック中</span>
        )}
      </div>

      {/* Add button */}
      {addableChecked.length > 0 && (
        <button type="button" onClick={() => handleAdd()}
          className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors">
          ✚ {addableChecked.length}人を追加 (Enter)
        </button>
      )}

      {/* CSV paste */}
      <div>
        <button type="button" onClick={() => setCsvOpen((v) => !v)}
          className="text-[11px] text-indigo-400 hover:text-indigo-600 underline">
          {csvOpen ? '▲ 閉じる' : '▼ 名前を改行区切りで貼り付け'}
        </button>
        {csvOpen && (
          <div className="mt-1.5 space-y-1.5">
            <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)}
              placeholder={'賀喜遥香\n遠藤さくら\n井上和'}
              rows={4}
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none font-mono focus:outline-none focus:ring-2 focus:ring-slate-300" />
            <button type="button" onClick={applyCSV}
              className="text-xs px-3 py-1 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors">
              追加する
            </button>
          </div>
        )}
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-400 font-medium mb-1">
            選択済み <span className="text-slate-700 font-bold">{selected.length}人</span>
          </p>
          <div className="flex flex-wrap gap-1">
            {selected.map((name) => (
              <span key={name} className="flex items-center gap-1 text-[11px] bg-slate-100 text-slate-700 rounded-full px-2 py-0.5">
                {name}
                <button type="button" onClick={() => onRemove(name)} className="text-gray-400 hover:text-red-500 leading-none">✕</button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
