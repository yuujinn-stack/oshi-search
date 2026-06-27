'use client';

import { useState, useRef, useEffect, useMemo } from 'react';

export interface PersonOption {
  name: string;
  group?: string;
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

const RECENT_KEY = 'admin-person-recent';
const RECENT_MAX = 8;
const MAX_DISPLAY = 40;

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

function matches(p: PersonOption, q: string): boolean {
  const lq = q.toLowerCase();
  if (p.name.toLowerCase().includes(lq)) return true;
  if ((p.group ?? '').toLowerCase().includes(lq)) return true;
  if ((p.generation ?? '').toLowerCase().includes(lq)) return true;
  if ((p.membershipNote ?? '').toLowerCase().includes(lq)) return true;
  if ((p.aliases ?? []).some((a) => a.toLowerCase().includes(lq))) return true;
  if ((p.formerGroupNames ?? []).some((g) => g.toLowerCase().includes(lq))) return true;
  return false;
}

const STATUS_LABEL: Record<string, string> = {
  active: '現役', graduated: '卒業', withdrawn: '脱退',
  hiatus: '休止中', retired: '引退', unknown: '不明',
};
const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  graduated: 'bg-blue-100 text-blue-700',
  withdrawn: 'bg-red-100 text-red-600',
  hiatus: 'bg-amber-100 text-amber-700',
  retired: 'bg-gray-200 text-gray-500',
  unknown: 'bg-gray-100 text-gray-400',
};

export default function PersonCombobox({
  persons,
  value,
  onChange,
  placeholder = '人物名・グループ名で検索...',
  allowEmpty = false,
  emptyLabel = '選択してください',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  const selectedPerson = persons.find((p) => p.name === value) ?? null;

  const filtered = useMemo(() => {
    if (!query.trim()) {
      const recentPersons = recent
        .map((n) => persons.find((p) => p.name === n))
        .filter((p): p is PersonOption => !!p);
      const recentNames = new Set(recentPersons.map((p) => p.name));
      const others = persons.filter((p) => !recentNames.has(p.name));
      return [...recentPersons, ...others];
    }
    return persons.filter((p) => matches(p, query.trim()));
  }, [persons, query, recent]);

  const displayList = filtered.slice(0, MAX_DISPLAY);
  const hasMore = filtered.length > MAX_DISPLAY;
  const totalOptions = displayList.length + (allowEmpty ? 1 : 0);

  useEffect(() => { setHighlightIdx(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function openDropdown() {
    setOpen(true);
    setQuery('');
    setHighlightIdx(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function selectPerson(name: string) {
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
    setOpen(false);
    setQuery('');
  }

  function scrollHighlighted() {
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector('[data-hl="true"]')
        ?.scrollIntoView({ block: 'nearest' });
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') { openDropdown(); e.preventDefault(); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIdx((i) => { const next = Math.min(i + 1, totalOptions - 1); return next; });
        scrollHighlighted();
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIdx((i) => { const next = Math.max(i - 1, 0); return next; });
        scrollHighlighted();
        break;
      case 'Enter': {
        e.preventDefault();
        if (allowEmpty && highlightIdx === 0) { selectPerson(''); break; }
        const listIdx = allowEmpty ? highlightIdx - 1 : highlightIdx;
        if (listIdx >= 0 && listIdx < displayList.length) selectPerson(displayList[listIdx].name);
        break;
      }
      case 'Escape':
      case 'Tab':
        setOpen(false);
        setQuery('');
        break;
    }
  }

  const recentNames = new Set(recent);

  return (
    <div ref={containerRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      {/* Trigger / closed display */}
      {!open ? (
        <button
          type="button"
          onClick={openDropdown}
          className={`w-full flex items-center justify-between gap-2 text-xs border rounded-lg px-3 py-2 text-left transition-colors ${
            value
              ? 'border-indigo-300 bg-indigo-50 hover:border-indigo-400'
              : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <span className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            {value && selectedPerson ? (
              <>
                <span className="font-medium text-slate-700 truncate">{selectedPerson.name}</span>
                {selectedPerson.group && (
                  <span className="text-[11px] text-gray-400 shrink-0">{selectedPerson.group}</span>
                )}
                {selectedPerson.generation && (
                  <span className="text-[11px] text-gray-400 shrink-0">{selectedPerson.generation}</span>
                )}
              </>
            ) : (
              <span className={value ? 'text-slate-700' : ''}>{value || emptyLabel}</span>
            )}
          </span>
          <span className="flex items-center gap-0.5 shrink-0">
            {value && (
              <span
                role="button"
                tabIndex={-1}
                onClick={handleClear}
                className="text-gray-300 hover:text-gray-500 text-[11px] cursor-pointer px-1 py-0.5 rounded"
                aria-label="クリア"
              >
                ✕
              </span>
            )}
            <span className="text-gray-300 text-[10px] px-0.5">▼</span>
          </span>
        </button>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full text-xs border border-indigo-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
        />
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          {!query.trim() && recent.length > 0 && (
            <div className="px-3 py-1.5 border-b border-gray-100 bg-gray-50">
              <span className="text-[10px] text-gray-400 font-medium">最近使用した人物</span>
            </div>
          )}

          <div ref={listRef} className="max-h-64 overflow-y-auto">
            {/* Empty option */}
            {allowEmpty && (
              <button
                type="button"
                data-hl={highlightIdx === 0 ? 'true' : 'false'}
                onClick={() => selectPerson('')}
                className={`w-full text-left px-3 py-2 text-xs border-b border-gray-50 transition-colors ${
                  highlightIdx === 0 ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:bg-gray-50'
                }`}
              >
                {emptyLabel}
              </button>
            )}

            {displayList.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">一致する人物がいません</p>
            ) : (
              displayList.map((p, i) => {
                const idx = i + (allowEmpty ? 1 : 0);
                const isHl = highlightIdx === idx;
                const isSel = p.name === value;
                const isRecent = !query.trim() && recentNames.has(p.name);

                return (
                  <button
                    key={p.name}
                    type="button"
                    data-hl={isHl ? 'true' : 'false'}
                    onClick={() => selectPerson(p.name)}
                    className={`w-full text-left px-3 py-2 transition-colors ${
                      isHl ? 'bg-indigo-50' : isSel ? 'bg-indigo-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {isSel && <span className="text-indigo-500 text-[10px] shrink-0">✓</span>}
                      {isRecent && !isSel && (
                        <span className="text-[9px] text-gray-300 shrink-0">◷</span>
                      )}
                      <span className={`text-xs font-medium truncate ${isHl || isSel ? 'text-indigo-700' : 'text-slate-700'}`}>
                        {p.name}
                      </span>
                      {p.group && (
                        <span className="text-[11px] text-gray-400 shrink-0 truncate">{p.group}</span>
                      )}
                      {p.generation && (
                        <span className="text-[11px] text-gray-400 shrink-0">{p.generation}</span>
                      )}
                      {p.activityStatus && p.activityStatus !== 'active' && (
                        <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${STATUS_COLOR[p.activityStatus] ?? 'bg-gray-100 text-gray-400'}`}>
                          {STATUS_LABEL[p.activityStatus] ?? p.activityStatus}
                        </span>
                      )}
                    </div>
                    {!query.trim() && (p.formerGroupNames?.length ?? 0) > 0 && (
                      <div className="text-[10px] text-gray-300 mt-0.5 pl-3 truncate">
                        旧: {p.formerGroupNames!.join(' / ')}
                      </div>
                    )}
                  </button>
                );
              })
            )}

            {hasMore && (
              <div className="border-t border-gray-100 px-3 py-2 text-center">
                <span className="text-[10px] text-gray-400">
                  他{filtered.length - MAX_DISPLAY}件 — 検索で絞り込んでください
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
