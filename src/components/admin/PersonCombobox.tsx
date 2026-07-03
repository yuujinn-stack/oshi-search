'use client';

import { useState, useRef, useEffect, useMemo } from 'react';

export interface PersonOption {
  name: string;
  group?: string;
  // currentGroupName: 改名後の現グループ名（欅坂46→櫻坂46 など）。group より優先して使う
  currentGroupName?: string;
  generation?: string;
  activityStatus?: string;
  aliases?: string[];
  formerGroupNames?: string[];
  membershipNote?: string;
}

interface Props {
  persons: PersonOption[];
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}

// ─── localStorage ────────────────────────────────────────────────────────────

const RECENT_KEY = 'admin-person-recent';
const RECENT_MAX = 8;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

function saveRecent(name: string) {
  try {
    const prev = loadRecent();
    const next = [name, ...prev.filter((n) => n !== name)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

// ─── Search ──────────────────────────────────────────────────────────────────

const MAX_FILTERED = 50;

function scoreMatch(p: PersonOption, q: string): number {
  const lq = q.toLowerCase();
  const name = p.name.toLowerCase();
  if (name === lq) return 100;
  if (name.startsWith(lq)) return 90;
  if (name.includes(lq)) return 80;
  if ((p.aliases ?? []).some((a) => a.toLowerCase().startsWith(lq))) return 75;
  if ((p.aliases ?? []).some((a) => a.toLowerCase().includes(lq))) return 70;
  if ((p.group ?? '').toLowerCase().includes(lq)) return 60;
  if ((p.generation ?? '').toLowerCase().includes(lq)) return 50;
  if ((p.formerGroupNames ?? []).some((g) => g.toLowerCase().includes(lq))) return 40;
  if ((p.membershipNote ?? '').toLowerCase().includes(lq)) return 30;
  return 0;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  active: '現役', graduated: '卒業', withdrawn: '脱退',
  hiatus: '休止中', retired: '引退', unknown: '不明',
};
const STATUS_COLOR: Record<string, string> = {
  active:    'bg-green-100 text-green-700',
  graduated: 'bg-sky-100 text-sky-700',
  withdrawn: 'bg-red-100 text-red-600',
  hiatus:    'bg-amber-100 text-amber-700',
  retired:   'bg-gray-100 text-gray-500',
  unknown:   'bg-gray-100 text-gray-400',
};

// ─── Row types ───────────────────────────────────────────────────────────────

type Row =
  | { kind: 'section'; label: string }
  | { kind: 'empty-opt'; selectIdx: number }
  | { kind: 'person'; p: PersonOption; selectIdx: number; isRecent: boolean };

// ─── Component ───────────────────────────────────────────────────────────────

export default function PersonCombobox({
  persons,
  value,
  onChange,
  placeholder = '人物名・グループ名で検索...',
  allowEmpty = false,
  emptyLabel = '選択してください',
  className = '',
}: Props) {
  const [open, setOpen]         = useState(false);
  const [query, setQuery]       = useState('');
  const [hl, setHl]             = useState(0);
  const [recent, setRecent]     = useState<string[]>([]);
  const [mounted, setMounted]   = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);
  const listRef      = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRecent(loadRecent());
    setMounted(true);
  }, []);

  const selectedPerson = persons.find((p) => p.name === value) ?? null;

  // Build display rows + selectable count ────────────────────────────────────
  const { rows, selectableCount } = useMemo((): { rows: Row[]; selectableCount: number } => {
    const result: Row[] = [];
    let si = 0;

    // Empty option always first
    if (allowEmpty) {
      result.push({ kind: 'empty-opt', selectIdx: si++ });
    }

    if (!query.trim()) {
      // ── No query: recently used + group sections ──
      const recentPersons: PersonOption[] = mounted
        ? recent.map((n) => persons.find((p) => p.name === n)).filter((p): p is PersonOption => !!p)
        : [];
      const recentSet = new Set(recentPersons.map((p) => p.name));

      if (recentPersons.length > 0) {
        result.push({ kind: 'section', label: '最近使用した人物' });
        for (const p of recentPersons) {
          result.push({ kind: 'person', p, selectIdx: si++, isRecent: true });
        }
      }

      // Group the rest
      const rest = persons.filter((p) => !recentSet.has(p.name));
      const groupMap = new Map<string, PersonOption[]>();
      for (const p of rest) {
        const key = p.group || '（グループなし）';
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(p);
      }

      const groupKeys = [...groupMap.keys()].sort((a, b) => {
        if (a === '（グループなし）') return 1;
        if (b === '（グループなし）') return -1;
        return a.localeCompare(b, 'ja');
      });

      for (const key of groupKeys) {
        result.push({ kind: 'section', label: key });
        for (const p of groupMap.get(key)!) {
          result.push({ kind: 'person', p, selectIdx: si++, isRecent: false });
        }
      }
    } else {
      // ── With query: scored flat list ──
      const q = query.trim();
      const scored = persons
        .map((p) => ({ p, score: scoreMatch(p, q) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_FILTERED);

      for (const { p } of scored) {
        result.push({ kind: 'person', p, selectIdx: si++, isRecent: false });
      }
    }

    return { rows: result, selectableCount: si };
  }, [persons, query, recent, mounted, allowEmpty]);

  const personRowCount = rows.filter((r) => r.kind === 'person').length;
  const noPersonResults = !!query.trim() && personRowCount === 0;

  // Reset highlight on open/query change ─────────────────────────────────────
  useEffect(() => { setHl(0); }, [query, open]);

  // Close on outside click ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Helpers ──────────────────────────────────────────────────────────────────

  function openDropdown() {
    setOpen(true);
    setQuery('');
    setHl(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function selectByName(name: string) {
    onChange(name);
    if (name) {
      saveRecent(name);
      setRecent(loadRecent());
    }
    setOpen(false);
    setQuery('');
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
  }

  function scrollToHl() {
    requestAnimationFrame(() => {
      listRef.current?.querySelector('[data-hl="true"]')?.scrollIntoView({ block: 'nearest' });
    });
  }

  function getItemAtIdx(idx: number): string | null {
    for (const row of rows) {
      if (row.kind === 'empty-opt' && row.selectIdx === idx) return '';
      if (row.kind === 'person'    && row.selectIdx === idx) return row.p.name;
    }
    return null;
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); openDropdown(); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHl((i) => Math.min(i + 1, selectableCount - 1));
        scrollToHl();
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHl((i) => Math.max(i - 1, 0));
        scrollToHl();
        break;
      case 'Enter': {
        e.preventDefault();
        const name = getItemAtIdx(hl);
        if (name !== null) selectByName(name);
        break;
      }
      case 'Escape':
      case 'Tab':
        setOpen(false);
        setQuery('');
        break;
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>

      {/* ── Trigger (closed) ── */}
      {!open ? (
        <button
          type="button"
          onClick={openDropdown}
          className={`w-full flex items-center justify-between gap-2 text-xs border rounded-lg px-3 py-2 min-h-[36px] text-left transition-colors ${
            value
              ? 'border-indigo-300 bg-indigo-50 hover:border-indigo-400'
              : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <span className="flex items-center gap-1.5 min-w-0 overflow-hidden flex-1">
            {value && selectedPerson ? (
              <>
                <span className="font-semibold text-slate-800 truncate">{selectedPerson.name}</span>
                {selectedPerson.group && (
                  <span className="text-[11px] text-gray-400 shrink-0">{selectedPerson.group}</span>
                )}
                {selectedPerson.generation && (
                  <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded shrink-0">
                    {selectedPerson.generation}
                  </span>
                )}
                {selectedPerson.activityStatus && selectedPerson.activityStatus !== 'active' && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${STATUS_COLOR[selectedPerson.activityStatus] ?? 'bg-gray-100 text-gray-400'}`}>
                    {STATUS_LABEL[selectedPerson.activityStatus] ?? selectedPerson.activityStatus}
                  </span>
                )}
              </>
            ) : value ? (
              <span className="text-slate-700 truncate">{value}</span>
            ) : (
              <span className="text-gray-400">{emptyLabel}</span>
            )}
          </span>
          <span className="flex items-center gap-1 shrink-0 ml-1">
            {value && (
              <span
                role="button"
                tabIndex={-1}
                onClick={handleClear}
                aria-label="クリア"
                className="text-gray-300 hover:text-red-400 text-[11px] cursor-pointer p-0.5 rounded transition-colors"
              >
                ✕
              </span>
            )}
            <span className="text-gray-300 text-[9px]">▼</span>
          </span>
        </button>
      ) : (
        /* ── Search input (open) ── */
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none select-none">
            🔍
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full text-xs border border-indigo-400 rounded-lg pl-7 pr-8 py-2 min-h-[36px] focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
          />
          {query && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-xs transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* ── Dropdown ── */}
      {open && (
        <div
          className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
          style={{
            zIndex: 9999,
            minWidth: 'max(100%, 360px)',
            maxWidth: 'calc(100vw - 32px)',
          }}
        >
          {/* Status bar (search mode only) */}
          {query.trim() && (
            <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <span className="text-[10px] text-gray-400">
                {noPersonResults ? '一致する人物がいません' : `${personRowCount}件`}
              </span>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-[10px] text-indigo-400 hover:text-indigo-600 transition-colors"
              >
                クリア
              </button>
            </div>
          )}

          <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: '420px' }}>
            {/* Row list */}
            {rows.map((row, i) => {
              // Section header
              if (row.kind === 'section') {
                return (
                  <div
                    key={`sec-${i}`}
                    className="sticky top-0 z-10 px-3 py-1.5 bg-gray-50 border-b border-gray-100"
                  >
                    <span className="text-[10px] font-bold text-gray-400 tracking-wide">
                      {row.label}
                    </span>
                  </div>
                );
              }

              // Empty option
              if (row.kind === 'empty-opt') {
                const isHl = hl === row.selectIdx;
                return (
                  <button
                    key="empty-opt"
                    type="button"
                    data-hl={String(isHl)}
                    onClick={() => selectByName('')}
                    className={`w-full text-left px-4 py-2.5 transition-colors border-b border-gray-100 ${
                      isHl ? 'bg-indigo-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-[10px] bg-gray-100 text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full font-medium">
                        {emptyLabel}
                      </span>
                    </span>
                  </button>
                );
              }

              // Person row
              const { p, selectIdx, isRecent } = row;
              const isHl  = hl === selectIdx;
              const isSel = p.name === value;

              return (
                <button
                  key={p.name}
                  type="button"
                  data-hl={String(isHl)}
                  onClick={() => selectByName(p.name)}
                  className={`w-full text-left px-4 py-2.5 transition-colors border-b border-gray-50 last:border-0 ${
                    isSel || isHl ? 'bg-indigo-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {/* Check mark / recent marker */}
                    <span className={`text-[10px] mt-0.5 w-3 shrink-0 ${isSel ? 'text-indigo-500' : 'text-transparent'}`}>
                      ✓
                    </span>

                    <div className="flex-1 min-w-0">
                      {/* Line 1: name + badges */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs font-semibold ${isSel || isHl ? 'text-indigo-700' : 'text-slate-800'}`}>
                          {p.name}
                        </span>
                        {p.generation && (
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded shrink-0">
                            {p.generation}
                          </span>
                        )}
                        {p.activityStatus && p.activityStatus !== 'active' && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${STATUS_COLOR[p.activityStatus] ?? 'bg-gray-100 text-gray-400'}`}>
                            {STATUS_LABEL[p.activityStatus] ?? p.activityStatus}
                          </span>
                        )}
                        {isRecent && (
                          <span className="text-[9px] text-gray-300 shrink-0" title="最近使用">◷</span>
                        )}
                      </div>

                      {/* Line 2: group + former groups */}
                      {(p.group || (p.formerGroupNames?.length ?? 0) > 0) && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {p.group && (
                            <span className="text-[11px] text-gray-400">{p.group}</span>
                          )}
                          {query.trim() && (p.formerGroupNames?.length ?? 0) > 0 && (
                            <span className="text-[10px] text-gray-300">
                              旧: {p.formerGroupNames!.join(' / ')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

            {/* No results message (person search only) */}
            {noPersonResults && (
              <div className="py-8 text-center">
                <p className="text-xs text-gray-400">「{query}」に一致する人物がいません</p>
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="mt-2 text-[11px] text-indigo-400 hover:text-indigo-600 transition-colors"
                >
                  検索をクリア
                </button>
              </div>
            )}

            {/* More results hint */}
            {query.trim() && personRowCount >= MAX_FILTERED && (
              <div className="border-t border-gray-100 px-4 py-2 text-center">
                <span className="text-[10px] text-gray-400">
                  上位{MAX_FILTERED}件を表示 — さらに絞り込んでください
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
