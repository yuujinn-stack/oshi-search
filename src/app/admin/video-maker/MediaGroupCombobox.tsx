'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SonkamoGroupOption } from './SonkamoTargetPicker';

// 推しサーチ総合紹介動画（グループ版: OSHI_GROUP_05・OSHI_GROUP_10）のグループ選択。
// 欄をクリックすると、推しサーチに登録されたグループ（公開サイトのグループ一覧と同じ。サーバーが DB から渡す）を全件表示し、
// クリックだけで選べる。検索は任意（入力すると絞り込む）。選べるのは一覧にあるグループだけ（自由入力の名前は確定しない）。

export type MediaGroupsStatus = 'loading' | 'ready' | 'error';

/** 検索用の正規化（全角半角・大文字小文字・カタカナ/ひらがな・空白や記号の違いを無視） */
export function normalizeGroupQuery(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * 入力に合うグループ（空の入力なら全件・元の並び順）。グループ名・読み（Worker が報告した読み。例: M!LK → みるく）に合うものを先に、
 * メンバー名だけで合うものを後ろに並べる
 */
export function filterMediaGroups(
  groups: SonkamoGroupOption[],
  query: string,
  readings: Record<string, string> = {},
): { group: SonkamoGroupOption; member: string | null }[] {
  const q = normalizeGroupQuery(query);
  if (!q) return groups.map((group) => ({ group, member: null }));
  const byName: { group: SonkamoGroupOption; member: string | null }[] = [];
  const byMember: { group: SonkamoGroupOption; member: string | null }[] = [];
  for (const group of groups) {
    if (normalizeGroupQuery(group.name).includes(q) || (readings[group.name] && normalizeGroupQuery(readings[group.name]).includes(q))) byName.push({ group, member: null });
    else {
      const member = group.members.find((m) => normalizeGroupQuery(m).includes(q));
      if (member) byMember.push({ group, member });
    }
  }
  return [...byName, ...byMember];
}

export default function MediaGroupCombobox({
  groups,
  status = 'ready',
  errorMessage = null,
  value,
  onChange,
  readings = {},
}: {
  groups: SonkamoGroupOption[];
  /** グループ名の読み（検索だけに使う。例: M!LK → みるく） */
  readings?: Record<string, string>;
  status?: MediaGroupsStatus;
  errorMessage?: string | null;
  /** 選んだグループの正式名称（一覧の name そのもの。未選択は空） */
  value: string;
  onChange: (groupName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const items = useMemo(() => filterMediaGroups(groups, query, readings), [groups, query, readings]);
  const selected = groups.find((g) => g.name === value) ?? null;

  // 一覧の外をクリックしたら閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // 開いたら検索欄にフォーカスし、選択中のグループを見える位置にする（閉じたら検索の入力を消す。次に開くと全件から）
  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    searchRef.current?.focus();
    const i = Math.max(0, items.findIndex((x) => x.group.name === value));
    setActive(i);
    listRef.current?.querySelector<HTMLElement>(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[active];
      if (item) pick(item.group.name);
    }
  };

  if (status === 'loading') {
    return <p className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-2 max-w-sm">登録済みのグループを読み込み中…</p>;
  }
  if (status === 'error') {
    return (
      <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-2 max-w-md">
        登録済みのグループを取得できませんでした。ページを再読み込みしてください。{errorMessage ? `（${errorMessage}）` : ''}
      </p>
    );
  }
  if (groups.length === 0) {
    return (
      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-2 max-w-md">
        選べるグループがありません（推しサーチに、公開中のメンバーがいるグループが登録されていません）。
      </p>
    );
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-sm" onKeyDown={onKeyDown}>
      <button
        type="button"
        id="vm-media-group"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm text-left bg-white ${open ? 'border-violet-500 ring-1 ring-violet-300' : 'border-gray-300 hover:border-violet-400'}`}
      >
        <span className={selected ? 'font-bold text-slate-800 truncate' : 'text-gray-400'}>{selected ? selected.name : 'クリックしてグループを選ぶ'}</span>
        <span className="text-gray-400 text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 w-full min-w-[280px] bg-white border border-gray-200 rounded-lg shadow-xl">
          <div className="p-2 border-b border-gray-100">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="検索（任意）: グループ名・読み・メンバー名"
              aria-label="グループを検索"
              aria-controls={listId}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              {query ? `${items.length}件 / 全${groups.length}件` : `登録済みのグループ 全${groups.length}件`}
            </p>
          </div>
          <ul id={listId} ref={listRef} role="listbox" aria-label="登録済みのグループ" className="max-h-72 overflow-y-auto py-1">
            {items.length === 0 ? (
              <li className="px-3 py-2 text-xs text-gray-500">「{query}」に一致するグループがありません</li>
            ) : (
              items.map(({ group, member }, i) => {
                const isSel = group.name === value;
                return (
                  <li
                    key={group.name}
                    data-index={i}
                    role="option"
                    aria-selected={isSel}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(group.name)}
                    className={`px-3 py-1.5 cursor-pointer flex items-baseline justify-between gap-2 text-sm ${i === active ? 'bg-violet-50' : ''} ${isSel ? 'font-bold text-violet-700' : 'text-slate-800'}`}
                  >
                    <span className="truncate">
                      {isSel ? '✓ ' : ''}
                      {group.name}
                    </span>
                    <span className="text-[11px] text-gray-400 shrink-0">{member ? `メンバー: ${member}` : `${group.members.length}人`}</span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
