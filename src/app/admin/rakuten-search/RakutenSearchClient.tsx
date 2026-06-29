'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import PersonCombobox, { type PersonOption } from '@/components/admin/PersonCombobox';
import type { RakutenSearchItem } from '@/app/api/admin/rakuten-search/route';
import type { ProductCategory } from '@/types/person';

// ── 型定義 ────────────────────────────────────────────────────────────────────
type SearchMethod = 'person_name' | 'free' | 'year' | 'group';
type ApiType = 'books_kw' | 'books_author' | 'books_title' | 'cd' | 'dvd' | 'ichiba';

interface SearchHistoryEntry {
  id: string;
  keyword: string;
  method: SearchMethod;
  apiType: ApiType;
  year?: string;
  groupName?: string;
  timestamp: number;
}

interface FavoriteSearch {
  id: string;
  label: string;
  keyword: string;
  method: SearchMethod;
  apiType: ApiType;
  year?: string;
  groupName?: string;
}

interface AddResultSummary {
  totalCreated: number;
  totalDuplicates: number;
  personCount: number;
  itemCount: number;
}

// ── 定数 ──────────────────────────────────────────────────────────────────────
const HISTORY_KEY = 'rakuten-search-history';
const FAVORITES_KEY = 'rakuten-search-favorites';
const MAX_HISTORY = 30;

const CATEGORIES: { value: ProductCategory; label: string }[] = [
  { value: '写真集', label: '写真集' },
  { value: '本・雑誌', label: '本・雑誌' },
  { value: 'CD', label: 'CD' },
  { value: 'Blu-ray・DVD', label: 'Blu-ray・DVD' },
  { value: 'グッズ', label: 'グッズ' },
  { value: '中古', label: '中古' },
];

const SORT_BOOKS = [
  { value: 'standard', label: '標準' },
  { value: '-releaseDate', label: '新着順' },
  { value: '-reviewCount', label: 'レビュー多' },
  { value: '+itemPrice', label: '価格安' },
];

const SORT_ICHIBA = [
  { value: 'standard', label: '標準' },
  { value: '-reviewCount', label: 'レビュー多' },
  { value: '+itemPrice', label: '価格安' },
  { value: '-itemPrice', label: '価格高' },
];

const PERSON_TEMPLATES: { label: string; suffix: string; apiType: ApiType }[] = [
  { label: '名前', suffix: '', apiType: 'books_kw' },
  { label: '写真集', suffix: ' 写真集', apiType: 'books_kw' },
  { label: 'カレンダー', suffix: ' カレンダー', apiType: 'books_kw' },
  { label: 'Blu-ray', suffix: ' Blu-ray', apiType: 'books_kw' },
  { label: 'DVD', suffix: '', apiType: 'dvd' },
  { label: 'CD', suffix: '', apiType: 'cd' },
  { label: '雑誌', suffix: ' 雑誌', apiType: 'books_kw' },
];

const GROUP_TEMPLATES: { label: string; suffix: string; apiType: ApiType }[] = [
  { label: '写真集', suffix: ' 写真集', apiType: 'books_kw' },
  { label: 'Blu-ray/DVD', suffix: '', apiType: 'dvd' },
  { label: 'CD', suffix: '', apiType: 'cd' },
  { label: 'グッズ', suffix: ' グッズ', apiType: 'ichiba' },
];

const API_LABEL: Record<ApiType, string> = {
  books_kw: '本KW',
  books_author: '本著者',
  books_title: '本題名',
  cd: 'CD',
  dvd: 'DVD',
  ichiba: '市場',
};

const YEAR_PRESETS = Array.from({ length: 8 }, (_, i) => String(new Date().getFullYear() - i));

// ── localStorage helpers ───────────────────────────────────────────────────────
function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T ?? fallback; } catch { return fallback; }
}

function writeStorage<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function pushHistory(entry: SearchHistoryEntry) {
  const prev = readStorage<SearchHistoryEntry[]>(HISTORY_KEY, [])
    .filter((e) => !(e.keyword === entry.keyword && e.apiType === entry.apiType));
  writeStorage(HISTORY_KEY, [entry, ...prev].slice(0, MAX_HISTORY));
}

function deleteHistory(id: string) {
  writeStorage(HISTORY_KEY, readStorage<SearchHistoryEntry[]>(HISTORY_KEY, []).filter((e) => e.id !== id));
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  persons: PersonOption[];
  groups: string[];
  metaMap: Record<string, { joinedAt?: string; leftAt?: string; activityStatus?: string }>;
}

export default function RakutenSearchClient({ persons, groups, metaMap }: Props) {
  // ── 検索フォーム ──────────────────────────────────────────────────────────
  const [searchMethod, setSearchMethod] = useState<SearchMethod>('person_name');
  const [searchPerson, setSearchPerson] = useState('');
  const [freeKeyword, setFreeKeyword] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [groupKeyword, setGroupKeyword] = useState('');
  const [apiType, setApiType] = useState<ApiType>('books_kw');
  const [hits, setHits] = useState(20);
  const [sort, setSort] = useState('standard');

  // ── 履歴・お気に入り ──────────────────────────────────────────────────────
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<FavoriteSearch[]>([]);
  const [quickOpen, setQuickOpen] = useState(true);

  // ── 検索結果 ──────────────────────────────────────────────────────────────
  const [items, setItems] = useState<RakutenSearchItem[]>([]);
  const [resultCount, setResultCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [lastQuery, setLastQuery] = useState('');

  // ── 選択 ─────────────────────────────────────────────────────────────────
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  // ── 結果フィルター ────────────────────────────────────────────────────────
  const [fltNewOnly, setFltNewOnly] = useState(false);
  const [fltUsedOnly, setFltUsedOnly] = useState(false);
  const [fltImageOnly, setFltImageOnly] = useState(false);
  const [fltMinPrice, setFltMinPrice] = useState('');
  const [fltMaxPrice, setFltMaxPrice] = useState('');
  const [fltShop, setFltShop] = useState('');

  // ── 画像ズーム ────────────────────────────────────────────────────────────
  const [zoomUrl, setZoomUrl] = useState('');
  const [copiedUrl, setCopiedUrl] = useState('');

  // ── 追加先人物 ────────────────────────────────────────────────────────────
  const [targetNames, setTargetNames] = useState<string[]>([]);
  const [comboKey, setComboKey] = useState(0);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [addCategory, setAddCategory] = useState<ProductCategory>('写真集');

  // ── 追加結果 ─────────────────────────────────────────────────────────────
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [addResult, setAddResult] = useState<AddResultSummary | null>(null);

  // ── 初期化 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    setHistory(readStorage<SearchHistoryEntry[]>(HISTORY_KEY, []));
    setFavorites(readStorage<FavoriteSearch[]>(FAVORITES_KEY, []));
  }, []);

  // ── computed ──────────────────────────────────────────────────────────────
  const builtKeyword = useMemo(() => {
    if (searchMethod === 'person_name') return searchPerson;
    if (searchMethod === 'free') return freeKeyword;
    if (searchMethod === 'year') return searchPerson ? `${searchPerson} ${year}` : year;
    if (searchMethod === 'group') return groupKeyword;
    return '';
  }, [searchMethod, searchPerson, freeKeyword, year, groupKeyword]);

  const sortOptions = apiType === 'ichiba' ? SORT_ICHIBA : SORT_BOOKS;
  const searchPersonMeta = metaMap[searchPerson];
  const searchPersonGroup = persons.find((p) => p.name === searchPerson)?.group;

  const hasFilters = fltNewOnly || fltUsedOnly || fltImageOnly || fltMinPrice !== '' || fltMaxPrice !== '' || fltShop !== '';

  const displayItems = useMemo(() => {
    let r = items;
    if (fltNewOnly) r = r.filter((i) => !i.isUsed);
    if (fltUsedOnly) r = r.filter((i) => i.isUsed);
    if (fltImageOnly) r = r.filter((i) => !!i.imageUrl);
    if (fltMinPrice !== '') r = r.filter((i) => i.price >= Number(fltMinPrice));
    if (fltMaxPrice !== '') r = r.filter((i) => i.price <= Number(fltMaxPrice));
    if (fltShop !== '') r = r.filter((i) => (i.shopName ?? '').includes(fltShop));
    return r;
  }, [items, fltNewOnly, fltUsedOnly, fltImageOnly, fltMinPrice, fltMaxPrice, fltShop]);

  const selectedItems = useMemo(
    () => displayItems.filter((item) => selectedUrls.has(item.itemUrl)),
    [displayItems, selectedUrls],
  );

  const targetGroups = useMemo(() => [...new Set(
    targetNames.map((n) => persons.find((p) => p.name === n)?.group).filter(Boolean) as string[]
  )], [targetNames, persons]);

  const availableForCombo = useMemo(
    () => persons.filter((p) => !targetNames.includes(p.name)),
    [persons, targetNames],
  );

  const isFavorited = favorites.some((f) => f.keyword === builtKeyword.trim() && f.apiType === apiType);

  // ── 検索コア ──────────────────────────────────────────────────────────────
  async function performSearch(q: string, type: ApiType, method: SearchMethod, sortParam: string, hitsParam: number) {
    if (!q.trim()) return;
    setLoading(true);
    setSearchError('');
    setItems([]);
    setSelectedUrls(new Set());
    setAddResult(null);
    setLastQuery(q);

    const entry: SearchHistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      keyword: q,
      method,
      apiType: type,
      year,
      groupName: groupKeyword,
      timestamp: Date.now(),
    };
    pushHistory(entry);
    setHistory(readStorage<SearchHistoryEntry[]>(HISTORY_KEY, []));

    try {
      const params = new URLSearchParams({ q, type, hits: String(hitsParam), sort: sortParam });
      const res = await fetch(`/api/admin/rakuten-search?${params}`);
      const data = await res.json() as { items?: RakutenSearchItem[]; count?: number; error?: string };
      if (data.error) { setSearchError(data.error); return; }
      setItems(data.items ?? []);
      setResultCount(data.count ?? (data.items?.length ?? 0));
    } catch (err) {
      setSearchError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    void performSearch(builtKeyword, apiType, searchMethod, sort, hits);
  }

  // ── テンプレート検索 ──────────────────────────────────────────────────────
  function applyTemplate(baseName: string, suffix: string, targetApiType: ApiType) {
    const keyword = suffix ? `${baseName}${suffix}` : baseName;
    setFreeKeyword(keyword);
    setSearchMethod('free');
    setApiType(targetApiType);
    setSort('standard');
    void performSearch(keyword, targetApiType, 'free', 'standard', hits);
  }

  // ── 履歴・お気に入り操作 ──────────────────────────────────────────────────
  function applyHistoryEntry(entry: SearchHistoryEntry) {
    setSearchMethod(entry.method);
    setApiType(entry.apiType);
    setFreeKeyword(entry.keyword);
    if (entry.year) setYear(entry.year);
    if (entry.groupName) setGroupKeyword(entry.groupName);
    void performSearch(entry.keyword, entry.apiType, entry.method, sort, hits);
  }

  function removeHistoryEntry(id: string) {
    deleteHistory(id);
    setHistory(readStorage<SearchHistoryEntry[]>(HISTORY_KEY, []));
  }

  function saveFavorite() {
    const q = builtKeyword.trim();
    if (!q || isFavorited) return;
    const fav: FavoriteSearch = {
      id: `${Date.now()}`,
      label: q,
      keyword: q,
      method: searchMethod,
      apiType,
      year,
      groupName: groupKeyword,
    };
    const next = [fav, ...favorites];
    setFavorites(next);
    writeStorage(FAVORITES_KEY, next);
  }

  function removeFavorite(id: string) {
    const next = favorites.filter((f) => f.id !== id);
    setFavorites(next);
    writeStorage(FAVORITES_KEY, next);
  }

  function applyFavorite(fav: FavoriteSearch) {
    setSearchMethod(fav.method);
    setApiType(fav.apiType);
    setFreeKeyword(fav.keyword);
    if (fav.year) setYear(fav.year);
    if (fav.groupName) setGroupKeyword(fav.groupName);
    void performSearch(fav.keyword, fav.apiType, fav.method, sort, hits);
  }

  // ── 選択操作 ─────────────────────────────────────────────────────────────
  function toggleItem(url: string) {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }
  function selectAll() { setSelectedUrls(new Set(displayItems.map((i) => i.itemUrl))); }
  function deselectAll() { setSelectedUrls(new Set()); }
  function invertSelection() {
    setSelectedUrls(new Set(displayItems.filter((i) => !selectedUrls.has(i.itemUrl)).map((i) => i.itemUrl)));
  }

  // ── コピー ────────────────────────────────────────────────────────────────
  async function copyTitle(title: string, url: string) {
    try {
      await navigator.clipboard.writeText(title);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(''), 2000);
    } catch { /* ignore */ }
  }

  // ── 追加先人物操作 ────────────────────────────────────────────────────────
  const addTargetName = useCallback((name: string) => {
    if (!name) return;
    setTargetNames((prev) => prev.includes(name) ? prev : [...prev, name]);
    setComboKey((k) => k + 1);
  }, []);

  function removeTargetName(name: string) {
    setTargetNames((prev) => prev.filter((n) => n !== name));
  }

  function addGroupMembers(groupName: string, activeOnly: boolean) {
    const members = persons
      .filter((p) => p.group === groupName && (!activeOnly || p.activityStatus === 'active'))
      .map((p) => p.name);
    setTargetNames((prev) => [...new Set([...prev, ...members])]);
  }

  function applyCSV() {
    const names = csvText.split(/[\n,、]/).map((s) => s.trim()).filter(Boolean);
    const valid = names.filter((n) => persons.some((p) => p.name === n));
    setTargetNames((prev) => [...new Set([...prev, ...valid])]);
    setCsvText('');
    setCsvOpen(false);
  }

  // ── 追加実行 ──────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (selectedItems.length === 0 || targetNames.length === 0) return;
    setAdding(true);
    setAddError('');
    setAddResult(null);

    let totalCreated = 0;
    let totalDuplicates = 0;
    const uniquePersons = new Set<string>();
    let itemCount = 0;

    for (const item of selectedItems) {
      try {
        const res = await fetch('/api/admin/product-manual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personNames: targetNames,
            title: item.title,
            itemUrl: item.itemUrl,
            imageUrl: item.imageUrl,
            category: addCategory,
            price: item.price,
            shopName: item.shopName,
            isUsed: item.isUsed,
          }),
        });
        const data = await res.json() as { created?: string[]; duplicates?: string[]; error?: string };
        if (data.error) { setAddError(data.error); setAdding(false); return; }
        for (const n of data.created ?? []) { uniquePersons.add(n); }
        totalCreated += data.created?.length ?? 0;
        totalDuplicates += data.duplicates?.length ?? 0;
        if ((data.created?.length ?? 0) > 0) itemCount++;
      } catch (err) {
        setAddError(String(err));
        setAdding(false);
        return;
      }
    }

    setAddResult({ totalCreated, totalDuplicates, personCount: uniquePersons.size, itemCount });
    setAdding(false);
  }

  function clearAll() {
    setItems([]);
    setSelectedUrls(new Set());
    setAddResult(null);
    setLastQuery('');
    setSearchError('');
    setFltNewOnly(false);
    setFltUsedOnly(false);
    setFltImageOnly(false);
    setFltMinPrice('');
    setFltMaxPrice('');
    setFltShop('');
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* 画像ズームモーダル */}
      {zoomUrl && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center cursor-zoom-out"
          onClick={() => setZoomUrl('')}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomUrl}
            alt=""
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-xl bg-black/50 rounded-full w-9 h-9 flex items-center justify-center hover:bg-black/70"
            onClick={() => setZoomUrl('')}
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex gap-4 items-start">
        {/* ─────────────────── 左サイドバー ─────────────────── */}
        <div className="w-72 flex-shrink-0 space-y-3">

          {/* クイック検索（履歴 + お気に入り） */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setQuickOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 text-left hover:bg-gray-50 transition-colors"
            >
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                クイック検索
              </span>
              <span className="text-gray-400 text-[10px]">{quickOpen ? '▲' : '▼'}</span>
            </button>

            {quickOpen && (
              <div className="px-3 pb-3 space-y-2.5">
                {/* お気に入り */}
                {favorites.length > 0 && (
                  <div>
                    <p className="text-[10px] text-amber-500 font-bold mb-1 px-0.5">★ お気に入り</p>
                    <div className="space-y-0.5">
                      {favorites.map((fav) => (
                        <div key={fav.id} className="flex items-center gap-1 group">
                          <button
                            type="button"
                            onClick={() => applyFavorite(fav)}
                            className="flex-1 text-left text-[11px] px-2 py-1 rounded hover:bg-amber-50 hover:text-amber-700 text-slate-700 transition-colors"
                          >
                            <span className="truncate block">{fav.label}</span>
                            <span className="text-[9px] text-gray-300 font-mono">{API_LABEL[fav.apiType]}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFavorite(fav.id)}
                            className="text-gray-200 hover:text-red-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 px-1"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 履歴 */}
                {history.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-400 font-bold mb-1 px-0.5">最近検索</p>
                    <div className="space-y-0.5 max-h-40 overflow-y-auto">
                      {history.map((entry) => (
                        <div key={entry.id} className="flex items-center gap-1 group">
                          <button
                            type="button"
                            onClick={() => applyHistoryEntry(entry)}
                            className="flex-1 text-left text-[11px] px-2 py-1 rounded hover:bg-slate-50 text-slate-600 transition-colors"
                          >
                            <span className="truncate block">{entry.keyword}</span>
                            <span className="text-[9px] text-gray-300 font-mono">{API_LABEL[entry.apiType]}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeHistoryEntry(entry.id)}
                            className="text-gray-200 hover:text-red-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 px-1"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {favorites.length === 0 && history.length === 0 && (
                  <p className="text-[11px] text-gray-300 text-center py-2">検索すると履歴が表示されます</p>
                )}
              </div>
            )}
          </div>

          {/* テンプレート（人物/グループ選択時のみ） */}
          {(searchPerson || (searchMethod === 'group' && groupKeyword)) && (
            <div className="bg-white border border-indigo-100 rounded-xl p-3 space-y-2.5">
              <p className="text-[11px] font-bold text-indigo-600 uppercase tracking-wide">ワンクリック検索</p>

              {searchPerson && (
                <div>
                  <p className="text-[10px] text-gray-400 font-medium mb-1.5 truncate">{searchPerson}</p>
                  <div className="flex flex-wrap gap-1">
                    {PERSON_TEMPLATES.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => applyTemplate(searchPerson, t.suffix, t.apiType)}
                        disabled={loading}
                        className="text-[11px] px-2 py-1 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium transition-colors disabled:opacity-40"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(searchPersonGroup || (searchMethod === 'group' && groupKeyword)) && (
                <div>
                  <p className="text-[10px] text-gray-400 font-medium mb-1.5 truncate">
                    {searchPersonGroup ?? groupKeyword}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {GROUP_TEMPLATES.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => applyTemplate(searchPersonGroup ?? groupKeyword, t.suffix, t.apiType)}
                        disabled={loading}
                        className="text-[11px] px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium transition-colors disabled:opacity-40"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 検索設定 */}
          <div className="bg-white border border-gray-200 rounded-xl p-3.5 space-y-3">
            <h2 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">検索設定</h2>

            {/* 検索方法 */}
            <div className="grid grid-cols-2 gap-1">
              {([
                ['person_name', '① 人物名'],
                ['free', '② 自由入力'],
                ['year', '③ 年指定'],
                ['group', '④ グループ'],
              ] as const).map(([val, label]) => (
                <label
                  key={val}
                  className={`flex items-center justify-center px-2 py-1.5 rounded-lg border cursor-pointer text-[11px] font-medium transition-colors ${
                    searchMethod === val
                      ? 'bg-slate-700 text-white border-slate-700'
                      : 'border-gray-200 text-gray-500 hover:border-slate-300'
                  }`}
                >
                  <input type="radio" name="searchMethod" value={val} checked={searchMethod === val}
                    onChange={() => setSearchMethod(val)} className="sr-only" />
                  {label}
                </label>
              ))}
            </div>

            {/* 人物選択 */}
            {(searchMethod === 'person_name' || searchMethod === 'year') && (
              <div>
                <PersonCombobox persons={persons} value={searchPerson} onChange={setSearchPerson}
                  placeholder="人物を選択..." allowEmpty emptyLabel="人物を選択..." />
                {searchPersonMeta && (searchPersonMeta.joinedAt || searchPersonMeta.leftAt) && (
                  <div className="mt-1 text-[10px] text-gray-400 flex gap-2">
                    {searchPersonMeta.joinedAt && <span>参加 {searchPersonMeta.joinedAt}</span>}
                    {searchPersonMeta.leftAt && <span>脱退 {searchPersonMeta.leftAt}</span>}
                  </div>
                )}
              </div>
            )}

            {/* 自由入力 */}
            {searchMethod === 'free' && (
              <input type="text" value={freeKeyword} onChange={(e) => setFreeKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="例: 乃木坂46 写真集"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300" />
            )}

            {/* 年入力 */}
            {searchMethod === 'year' && (
              <div>
                <input type="number" value={year} onChange={(e) => setYear(e.target.value)}
                  min={2000} max={2099}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300 mb-1.5" />
                <div className="flex flex-wrap gap-1">
                  {YEAR_PRESETS.map((y) => (
                    <button key={y} type="button" onClick={() => setYear(y)}
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                        year === y ? 'bg-slate-700 text-white border-slate-700' : 'border-gray-200 text-gray-500 hover:border-slate-400'
                      }`}
                    >{y}</button>
                  ))}
                </div>
              </div>
            )}

            {/* グループ選択 */}
            {searchMethod === 'group' && (
              <select value={groupKeyword} onChange={(e) => setGroupKeyword(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300">
                <option value="">グループを選択...</option>
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}

            {/* キーワードプレビュー */}
            {builtKeyword && (
              <div className="text-[10px] text-gray-400 bg-gray-50 rounded px-2 py-1 font-mono truncate">
                {builtKeyword}
              </div>
            )}

            {/* API種別 */}
            <div className="space-y-0.5">
              {([
                ['books_kw', '本/写真集 (キーワード)'],
                ['books_author', '本/写真集 (著者名)'],
                ['books_title', '本/写真集 (タイトル)'],
                ['cd', 'CD (アーティスト名)'],
                ['dvd', 'DVD・Blu-ray (アーティスト名)'],
                ['ichiba', '楽天市場 (キーワード)'],
              ] as const).map(([val, label]) => (
                <label key={val}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-[11px] transition-colors ${
                    apiType === val
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200 font-medium'
                      : 'border-gray-100 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <input type="radio" name="apiType" value={val} checked={apiType === val}
                    onChange={() => { setApiType(val); setSort('standard'); }} className="sr-only" />
                  {label}
                </label>
              ))}
            </div>

            {/* 件数・並び順 */}
            <div className="flex gap-2">
              <div className="flex-1">
                <p className="text-[10px] text-gray-500 mb-1">件数</p>
                <select value={hits} onChange={(e) => setHits(Number(e.target.value))}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-slate-300">
                  <option value={10}>10件</option>
                  <option value={20}>20件</option>
                  <option value={30}>30件</option>
                </select>
              </div>
              <div className="flex-1">
                <p className="text-[10px] text-gray-500 mb-1">並び順</p>
                <select value={sort} onChange={(e) => setSort(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-slate-300">
                  {sortOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            </div>

            {/* ボタン行 */}
            <div className="flex gap-2">
              <button type="button" onClick={saveFavorite} disabled={!builtKeyword.trim() || isFavorited}
                title={isFavorited ? 'お気に入り登録済み' : 'お気に入りに追加'}
                className={`w-9 h-9 rounded-lg border flex items-center justify-center text-sm shrink-0 transition-colors ${
                  isFavorited ? 'bg-amber-50 border-amber-200 text-amber-400'
                  : 'border-gray-200 text-gray-300 hover:border-amber-300 hover:text-amber-400 disabled:opacity-30'
                }`}
              >★</button>
              <button onClick={handleSearch} disabled={loading || !builtKeyword.trim()}
                className="flex-1 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium transition-colors disabled:opacity-40">
                {loading ? '検索中...' : '🔍 検索'}
              </button>
            </div>
          </div>

          {/* 追加設定パネル */}
          {displayItems.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">追加設定</h2>
                <span className="text-[11px] text-gray-400">
                  選択 <span className="font-bold text-slate-700">{selectedItems.length}</span>/{displayItems.length}件
                </span>
              </div>

              {/* カテゴリ */}
              <div>
                <p className="text-[10px] text-gray-500 font-medium mb-1.5">保存カテゴリ</p>
                <div className="flex flex-wrap gap-1">
                  {CATEGORIES.map(({ value, label }) => (
                    <label key={value}
                      className={`px-2 py-1 rounded-md border cursor-pointer text-[11px] font-medium transition-colors ${
                        addCategory === value ? 'bg-slate-700 text-white border-slate-700' : 'border-gray-200 text-gray-500 hover:border-slate-300'
                      }`}
                    >
                      <input type="radio" name="addCategory" value={value} checked={addCategory === value}
                        onChange={() => setAddCategory(value)} className="sr-only" />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* 追加先人物 */}
              <div>
                <p className="text-[10px] text-gray-500 font-medium mb-1.5">
                  追加先人物 {targetNames.length > 0 && <span className="text-slate-700 font-bold">{targetNames.length}人</span>}
                </p>

                {targetNames.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {targetNames.map((name) => (
                      <span key={name} className="flex items-center gap-1 text-[11px] bg-slate-100 text-slate-700 rounded-full px-2 py-0.5">
                        {name}
                        <button type="button" onClick={() => removeTargetName(name)} className="text-gray-400 hover:text-red-500 leading-none">✕</button>
                      </span>
                    ))}
                  </div>
                )}

                <PersonCombobox key={comboKey} persons={availableForCombo} value="" onChange={addTargetName}
                  placeholder="人物を追加..." allowEmpty emptyLabel="人物を追加..." />

                {targetGroups.map((grp) => (
                  <div key={grp} className="mt-1.5 flex gap-1.5 flex-wrap">
                    <button type="button" onClick={() => addGroupMembers(grp, true)}
                      className="text-[11px] px-2 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 transition-colors">
                      {grp} 現役
                    </button>
                    <button type="button" onClick={() => addGroupMembers(grp, false)}
                      className="text-[11px] px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">
                      {grp} 全員
                    </button>
                  </div>
                ))}

                <button type="button" onClick={() => setCsvOpen((v) => !v)}
                  className="mt-1.5 text-[11px] text-indigo-500 hover:text-indigo-700 underline">
                  {csvOpen ? '▲ 閉じる' : '▼ 名前を貼り付け'}
                </button>
                {csvOpen && (
                  <div className="mt-1 space-y-1">
                    <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)}
                      placeholder={'田中\n山田\n佐藤'} rows={3}
                      className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none font-mono focus:outline-none focus:ring-1 focus:ring-slate-300" />
                    <button type="button" onClick={applyCSV}
                      className="text-xs px-2.5 py-1 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700">追加</button>
                  </div>
                )}
              </div>

              {/* 追加結果 or 追加ボタン */}
              {addResult ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="bg-green-50 border border-green-100 rounded-lg p-2 text-center">
                      <p className="text-xl font-bold text-green-700">{addResult.totalCreated}</p>
                      <p className="text-[10px] text-green-600">追加成功</p>
                    </div>
                    <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 text-center">
                      <p className="text-xl font-bold text-amber-700">{addResult.totalDuplicates}</p>
                      <p className="text-[10px] text-amber-600">スキップ</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-2 text-center">
                      <p className="text-xl font-bold text-blue-700">{addResult.personCount}</p>
                      <p className="text-[10px] text-blue-600">追加先</p>
                    </div>
                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-center">
                      <p className="text-xl font-bold text-slate-700">{addResult.itemCount}</p>
                      <p className="text-[10px] text-slate-500">追加商品</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setAddResult(null)}
                    className="w-full py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-xs font-medium transition-colors">
                    そのまま検索を続ける
                  </button>
                  <button type="button" onClick={clearAll}
                    className="w-full py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium transition-colors">
                    検索条件をクリア
                  </button>
                </div>
              ) : (
                <>
                  <button onClick={handleAdd} disabled={adding || selectedItems.length === 0 || targetNames.length === 0}
                    className="w-full py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors disabled:opacity-40">
                    {adding ? '追加中...' : `✚ 選択${selectedItems.length}件を${targetNames.length}人に追加`}
                  </button>
                  {addError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{addError}</p>}
                </>
              )}
            </div>
          )}
        </div>

        {/* ─────────────────── メイン（結果） ─────────────────── */}
        <div className="flex-1 min-w-0">
          {/* エラー */}
          {searchError && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm border border-red-100">
              {searchError}
            </div>
          )}

          {/* 初期表示 */}
          {!loading && items.length === 0 && !searchError && !lastQuery && (
            <div className="flex flex-col items-center justify-center h-72 text-gray-300 select-none">
              <span className="text-5xl mb-3">🛍</span>
              <p className="text-sm">左のフォームで検索してください</p>
              <p className="text-xs mt-1 text-gray-200">ワンクリック検索で素早く商品を探せます</p>
            </div>
          )}

          {/* ローディング */}
          {loading && (
            <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
              <svg className="animate-spin w-5 h-5 mr-2 text-slate-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              検索中...
            </div>
          )}

          {/* 結果エリア */}
          {!loading && (items.length > 0 || (lastQuery && !searchError)) && (
            <>
              {/* フィルターバー */}
              <div className="mb-3 px-3 py-2.5 bg-gray-50 border border-gray-100 rounded-xl">
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] text-gray-400 font-bold shrink-0">フィルター</span>

                  {(['新品のみ', '中古のみ', '画像あり'] as const).map((label) => {
                    const isActive =
                      label === '新品のみ' ? fltNewOnly :
                      label === '中古のみ' ? fltUsedOnly : fltImageOnly;
                    return (
                      <button key={label} type="button"
                        onClick={() => {
                          if (label === '新品のみ') { setFltNewOnly(!fltNewOnly); if (!fltNewOnly) setFltUsedOnly(false); }
                          else if (label === '中古のみ') { setFltUsedOnly(!fltUsedOnly); if (!fltUsedOnly) setFltNewOnly(false); }
                          else setFltImageOnly(!fltImageOnly);
                        }}
                        className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                          isActive ? 'bg-slate-700 text-white border-slate-700' : 'border-gray-200 text-gray-500 hover:border-gray-400'
                        }`}
                      >{label}</button>
                    );
                  })}

                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-400">¥</span>
                    <input type="number" placeholder="最低" value={fltMinPrice} onChange={(e) => setFltMinPrice(e.target.value)}
                      className="w-16 text-[11px] border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-slate-300" />
                    <span className="text-[10px] text-gray-300">〜</span>
                    <input type="number" placeholder="最高" value={fltMaxPrice} onChange={(e) => setFltMaxPrice(e.target.value)}
                      className="w-16 text-[11px] border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-slate-300" />
                  </div>

                  <input type="text" placeholder="ショップ名" value={fltShop} onChange={(e) => setFltShop(e.target.value)}
                    className="w-24 text-[11px] border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-slate-300" />

                  {hasFilters && (
                    <button type="button" onClick={() => {
                      setFltNewOnly(false); setFltUsedOnly(false); setFltImageOnly(false);
                      setFltMinPrice(''); setFltMaxPrice(''); setFltShop('');
                    }} className="text-[11px] text-red-400 hover:text-red-600 underline">クリア</button>
                  )}
                </div>
              </div>

              {/* 結果ヘッダー */}
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-gray-500 min-w-0">
                  <span className="font-bold text-slate-700">{displayItems.length}件</span>
                  {resultCount > items.length && (
                    <span className="ml-1 text-gray-400 text-xs">（全{resultCount.toLocaleString()}件中{items.length}件取得）</span>
                  )}
                  {lastQuery && (
                    <span className="ml-2 text-gray-300 font-mono text-xs truncate">「{lastQuery}」</span>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={selectAll} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors">全選択</button>
                  <button onClick={invertSelection} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors">反転</button>
                  <button onClick={deselectAll} className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 transition-colors">解除</button>
                </div>
              </div>

              {/* 0件 */}
              {displayItems.length === 0 && (
                <div className="flex flex-col items-center justify-center h-40 text-gray-300 text-sm select-none">
                  <span className="text-4xl mb-2">🔍</span>
                  <p>{items.length > 0 ? 'フィルター条件に一致する商品がありません' : `「${lastQuery}」の結果は見つかりませんでした`}</p>
                </div>
              )}

              {/* カードグリッド */}
              {displayItems.length > 0 && (
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                  {displayItems.map((item) => {
                    const isSelected = selectedUrls.has(item.itemUrl);
                    const isCopied = copiedUrl === item.itemUrl;
                    return (
                      <div
                        key={item.itemUrl}
                        onClick={() => toggleItem(item.itemUrl)}
                        className={`relative rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-slate-500 bg-slate-50 ring-2 ring-slate-400/20'
                            : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                        }`}
                      >
                        {/* チェック */}
                        <div className={`absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center z-10 transition-colors ${
                          isSelected ? 'bg-slate-700 border-slate-700 text-white' : 'bg-white border-gray-300'
                        }`}>
                          {isSelected && (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>

                        {/* 画像 */}
                        <div
                          className="relative h-36 bg-gray-50 rounded-t-xl overflow-hidden flex items-center justify-center"
                          onClick={(e) => {
                            if (item.imageUrl) { e.stopPropagation(); setZoomUrl(item.imageUrl); }
                          }}
                        >
                          {item.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={item.imageUrl} alt=""
                              className="h-full w-full object-contain hover:scale-105 transition-transform duration-200"
                              loading="lazy"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                          ) : (
                            <span className="text-3xl text-gray-200 select-none">📦</span>
                          )}
                          {item.imageUrl && (
                            <div className="absolute inset-0 bg-black/0 hover:bg-black/15 transition-colors flex items-end justify-center pb-2">
                              <span className="text-[10px] text-white/0 hover:text-white/90 bg-black/0 hover:bg-black/30 px-2 py-0.5 rounded-full transition-all">拡大</span>
                            </div>
                          )}
                        </div>

                        {/* 情報 */}
                        <div className="p-2.5">
                          <p className="text-xs font-medium text-slate-800 line-clamp-3 leading-snug mb-1">
                            {item.title}
                          </p>
                          {(item.author || item.artistName) && (
                            <p className="text-[10px] text-gray-400 truncate">{item.author ?? item.artistName}</p>
                          )}
                          {item.shopName && (
                            <p className="text-[10px] text-gray-400 truncate">{item.shopName}</p>
                          )}
                          <div className="flex items-center justify-between mt-1.5" onClick={(e) => e.stopPropagation()}>
                            <span className="text-xs font-bold text-slate-700">
                              {item.price > 0 ? `¥${item.price.toLocaleString()}` : '価格不明'}
                            </span>
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => void copyTitle(item.title, item.itemUrl)}
                                title="タイトルをコピー"
                                className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                                  isCopied ? 'border-green-300 text-green-600 bg-green-50' : 'border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-500'
                                }`}>
                                {isCopied ? '✓' : '📋'}
                              </button>
                              <a href={item.itemUrl} target="_blank" rel="noopener noreferrer"
                                className="text-[10px] text-indigo-400 hover:text-indigo-600 underline">楽天</a>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
