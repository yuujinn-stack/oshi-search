'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { SuggestionItem } from '@/types/search';

// ─── 定数 ────────────────────────────────────────────────────────────────────
const HISTORY_KEY = 'oshi-search-history';

function trackSearch(keyword: string) {
  fetch('/api/search-track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword }),
  }).catch(() => {});
}
const HISTORY_MAX = 5;
const SUGGEST_MAX = 8;

// ─── localStorage 履歴ユーティリティ ─────────────────────────────────────────
function getHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function addToHistory(q: string) {
  if (!q.trim()) return;
  try {
    const prev = getHistory().filter((h) => h !== q);
    localStorage.setItem(HISTORY_KEY, JSON.stringify([q, ...prev].slice(0, HISTORY_MAX)));
  } catch { /* ignore */ }
}

function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch { /* ignore */ }
}

// ─── 型定義 ──────────────────────────────────────────────────────────────────
interface DropdownItem {
  label: string;
  sublabel?: string;
  href?: string;
  isHistory: boolean;
}

interface Props {
  defaultValue?: string;
  suggestions?: SuggestionItem[];
  compact?: boolean;
  placeholder?: string;
  /** Hero用: カスタム input クラス（省略時はデフォルトTailwindスタイル） */
  inputClassName?: string;
  /** Hero用: カスタム button クラス */
  buttonClassName?: string;
  buttonLabel?: string;
  /** 検索後に呼ばれるコールバック（ページ遷移前に呼ぶ） */
  onSearch?: (q: string) => void;
}

// ─── コンポーネント ───────────────────────────────────────────────────────────
export default function SmartSearchInput({
  defaultValue = '',
  suggestions = [],
  compact = false,
  placeholder,
  inputClassName,
  buttonClassName,
  buttonLabel = '検索する',
  onSearch,
}: Props) {
  const [query, setQuery] = useState(defaultValue);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [history, setHistory] = useState<string[]>([]);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  // マウント時に履歴を読み込む
  useEffect(() => {
    setHistory(getHistory());
  }, []);

  const trimmed = query.trim();

  // サジェスト候補を絞り込み（最大 SUGGEST_MAX 件）
  const filtered: DropdownItem[] = trimmed.length === 0
    ? []
    : suggestions
        .filter((s) => s.label.toLowerCase().includes(trimmed.toLowerCase()))
        .slice(0, SUGGEST_MAX)
        .map((s) => ({ label: s.label, sublabel: s.sublabel, href: s.href, isHistory: false }));

  const showHistory = isOpen && trimmed.length === 0 && history.length > 0;
  const showSuggest = isOpen && filtered.length > 0;
  const isDropdownOpen = showHistory || showSuggest;

  const items: DropdownItem[] = showHistory
    ? history.map((h) => ({ label: h, isHistory: true }))
    : filtered;

  // 選択して遷移
  const navigate = useCallback(
    (label: string, href?: string) => {
      addToHistory(label);
      setHistory(getHistory());
      setIsOpen(false);
      setActiveIdx(-1);
      trackSearch(label);
      onSearch?.(label);
      router.push(href ?? `/search?q=${encodeURIComponent(label)}`);
    },
    [router, onSearch],
  );

  // フォーム送信
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    addToHistory(q);
    setHistory(getHistory());
    setIsOpen(false);
    setActiveIdx(-1);
    trackSearch(q);
    onSearch?.(q);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  // キーボード操作
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isDropdownOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setActiveIdx(-1);
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      const item = items[activeIdx];
      if (item) navigate(item.label, item.href);
    }
  };

  // 外側クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveIdx(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // デフォルトスタイル（Hero用に上書き可能）
  const defaultInputCls = compact
    ? 'flex-1 border border-gray-300 rounded-full py-2 px-4 text-sm text-slate-800 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent'
    : 'flex-1 border border-gray-300 rounded-full py-4 px-5 text-slate-800 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent';

  const defaultButtonCls = compact
    ? 'bg-primary text-white rounded-full font-bold whitespace-nowrap hover:bg-indigo-700 active:bg-indigo-800 transition-colors px-4 py-2 text-sm flex items-center justify-center'
    : 'bg-primary text-white rounded-full font-bold whitespace-nowrap hover:bg-indigo-700 active:bg-indigo-800 transition-colors px-7 py-4 flex items-center justify-center';

  return (
    <div ref={containerRef} className="relative w-full">
      <form onSubmit={handleSubmit} className="flex gap-2 w-full">
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(-1); }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? (compact ? '人物・グループを検索' : '人物名・グループ名・ジャンルで検索')}
          className={inputClassName ?? defaultInputCls}
          style={{ fontSize: '16px' }}
          autoComplete="off"
          aria-label="検索"
          aria-expanded={isDropdownOpen}
          aria-autocomplete="list"
        />
        <button
          type="submit"
          className={buttonClassName ?? defaultButtonCls}
          style={{ minHeight: '44px', minWidth: '44px' }}
        >
          {buttonLabel}
        </button>
      </form>

      {/* ─ ドロップダウン ─ */}
      {isDropdownOpen && (
        <div
          className="absolute left-0 right-0 mt-1.5 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-[100]"
          style={{ top: '100%' }}
          role="listbox"
        >
          {/* 履歴ヘッダー */}
          {showHistory && (
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-50">
              <span className="text-xs font-semibold text-gray-400">最近の検索</span>
              <button
                type="button"
                onClick={() => { clearHistory(); setHistory([]); }}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                履歴を消去
              </button>
            </div>
          )}

          {/* 候補一覧 */}
          {items.map((item, idx) => (
            <button
              key={`${item.label}-${idx}`}
              type="button"
              role="option"
              aria-selected={activeIdx === idx}
              onMouseDown={(e) => { e.preventDefault(); navigate(item.label, item.href); }}
              onMouseEnter={() => setActiveIdx(idx)}
              className={`w-full text-left px-4 py-2.5 flex items-center gap-2.5 transition-colors ${
                activeIdx === idx ? 'bg-indigo-50' : 'hover:bg-gray-50'
              }`}
            >
              <span className="text-gray-400 text-sm flex-shrink-0" aria-hidden="true">
                {item.isHistory ? '🕐' : '🔍'}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-slate-800">{item.label}</span>
                {item.sublabel && (
                  <span className="text-xs text-gray-400 ml-2">{item.sublabel}</span>
                )}
              </div>
              {item.isHistory && (
                <span className="text-gray-200 text-xs flex-shrink-0">↩</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
