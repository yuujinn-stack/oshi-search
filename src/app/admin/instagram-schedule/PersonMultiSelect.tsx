'use client';

import { useMemo, useState } from 'react';
import type { PersonOption } from '@/components/admin/PersonCombobox';

interface Props {
  persons: PersonOption[];
  /** Instagramへ投稿済みの人物名（「投稿済み」バッジ表示用。選択自体は禁止しない） */
  postedPersonNames: ReadonlySet<string>;
  /** 投稿済み人物の直近投稿日時（ISO文字列）。バッジに「直近投稿日」を添えるための任意情報 */
  lastPostedAt?: ReadonlyMap<string, string>;
  /** 選択中の人物名（選択した順＝1日3枠への割り当て順） */
  selected: string[];
  onChange: (next: string[]) => void;
  /** 選択できる人数の上限（未指定=無制限。1週間分作成モードの「7日×1日あたり件数」用） */
  maxSelected?: number;
}

function formatShortDateJst(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

const MAX_RESULTS = 60;

function matches(p: PersonOption, q: string): boolean {
  const lq = q.toLowerCase();
  return (
    p.name.toLowerCase().includes(lq) ||
    (p.group ?? '').toLowerCase().includes(lq) ||
    (p.aliases ?? []).some((a) => a.toLowerCase().includes(lq))
  );
}

/**
 * 一括予約用の人物複数選択UI。検索欄＋チェックボックス一覧＋選択済み人物の並び替え。
 * 選択順がそのまま「09:00→15:00→20:00...」への割り当て順になる（allocateBulkSlots参照）。
 */
export default function PersonMultiSelect({ persons, postedPersonNames, lastPostedAt, selected, onChange, maxSelected }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim();
    const list = q ? persons.filter((p) => matches(p, q)) : persons;
    return list.slice(0, MAX_RESULTS);
  }, [persons, query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const atMax = maxSelected !== undefined && selected.length >= maxSelected;

  function toggle(name: string) {
    if (selectedSet.has(name)) {
      onChange(selected.filter((n) => n !== name));
    } else {
      if (maxSelected !== undefined && selected.length >= maxSelected) return;
      onChange([...selected, name]);
    }
  }

  function moveUp(index: number) {
    if (index <= 0) return;
    const next = [...selected];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  }

  function moveDown(index: number) {
    if (index >= selected.length - 1) return;
    const next = [...selected];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  }

  function remove(name: string) {
    onChange(selected.filter((n) => n !== name));
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* 検索・チェックボックス一覧 */}
      <div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="人物名・グループ名で検索..."
          className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2 mb-2"
        />
        <div className="border border-gray-200 rounded-lg overflow-y-auto" style={{ maxHeight: 280 }}>
          {filtered.length === 0 && (
            <p className="text-xs text-gray-400 px-3 py-4 text-center">一致する人物がいません</p>
          )}
          {filtered.map((p) => {
            const checked = selectedSet.has(p.name);
            const posted = postedPersonNames.has(p.name);
            const lastDate = lastPostedAt?.get(p.name);
            const disabled = !checked && atMax;
            return (
              <label
                key={p.name}
                className={`flex items-center gap-2 px-3 py-2 text-xs border-b border-gray-50 last:border-0 transition-colors ${
                  checked ? 'bg-violet-50' : disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(p.name)}
                  className="shrink-0"
                />
                <span className="font-medium text-slate-700 truncate">{p.name}</span>
                {p.group && <span className="text-[10px] text-gray-400 shrink-0">{p.group}</span>}
                {posted && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded shrink-0 ml-auto">
                    投稿済み{lastDate ? `（${formatShortDateJst(lastDate)}）` : ''}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {query.trim() && filtered.length >= MAX_RESULTS && (
          <p className="text-[10px] text-gray-400 mt-1">上位{MAX_RESULTS}件を表示中 — さらに絞り込んでください</p>
        )}
      </div>

      {/* 選択済み一覧（並び替え可能） */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">
          選択中（{selected.length}{maxSelected !== undefined ? ` / ${maxSelected}` : ''}人）— この順番で日時へ割り当てられます
          {atMax && <span className="text-amber-600 ml-1">（上限に達しています）</span>}
        </p>
        <div className="border border-gray-200 rounded-lg overflow-y-auto" style={{ maxHeight: 280 }}>
          {selected.length === 0 && (
            <p className="text-xs text-gray-400 px-3 py-4 text-center">左の一覧から人物を選択してください</p>
          )}
          {selected.map((name, i) => (
            <div key={name} className="flex items-center gap-2 px-3 py-2 text-xs border-b border-gray-50 last:border-0">
              <span className="text-[10px] text-gray-400 w-5 shrink-0 text-right">{i + 1}.</span>
              <span className="font-medium text-slate-700 truncate flex-1">{name}</span>
              {postedPersonNames.has(name) && (
                <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded shrink-0">
                  投稿済み{lastPostedAt?.get(name) ? `（${formatShortDateJst(lastPostedAt.get(name)!)}）` : ''}
                </span>
              )}
              <button
                type="button"
                onClick={() => moveUp(i)}
                disabled={i === 0}
                className="text-gray-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed px-1"
                aria-label="上へ"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveDown(i)}
                disabled={i === selected.length - 1}
                className="text-gray-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed px-1"
                aria-label="下へ"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(name)}
                className="text-gray-300 hover:text-red-500 px-1"
                aria-label="削除"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
