'use client';

// 推しに合うサブスク診断（/oshi-vod）専用の人物複数選択UI。
// ヘッダー検索（SmartSearchInput）は候補選択で必ずページ遷移するため流用せず、
// 同じ人物データ源（getAllPersonsMerged：名前・グループ・別名）と同じ操作感（部分一致・
// キーボード操作・外側クリックで閉じる）で「選択中リストへ追加」する専用コンポーネントとした。
// ユーザー操作は「推しを選ぶ → 診断する」だけ。

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendGaEvent } from '@/lib/ga-event';
import { OSHI_VOD_MAX_PERSONS, buildOshiVodResultPath } from '@/lib/oshi-vod/params';
import {
  canSelectWholeGroup,
  searchPickerSuggestions,
  type OshiVodPickerGroup,
  type OshiVodPickerPerson,
  type PickerSuggestion,
} from '@/lib/oshi-vod/picker';

export type DiagnosisStartSource = 'top' | 'person' | 'group' | 'direct' | 'result';

interface Props {
  persons: OshiVodPickerPerson[];
  groups: OshiVodPickerGroup[];
  initialSelected?: string[];
  initialGroup?: string | null;
  /** 診断開始イベントの流入元（未指定はリファラから top / direct を判定） */
  source?: DiagnosisStartSource;
  submitLabel?: string;
}

export default function OshiVodPersonPicker({
  persons,
  groups,
  initialSelected = [],
  initialGroup = null,
  source,
  submitLabel = '診断する',
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(initialSelected.slice(0, OSHI_VOD_MAX_PERSONS));
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [openGroup, setOpenGroup] = useState<string | null>(
    initialGroup && groups.some((g) => g.name === initialGroup) ? initialGroup : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const personByName = useMemo(() => new Map(persons.map((p) => [p.name, p])), [persons]);
  const suggestions = useMemo(() => searchPickerSuggestions(query, persons, groups), [query, persons, groups]);
  const remaining = OSHI_VOD_MAX_PERSONS - selected.length;
  const isFull = remaining <= 0;
  const groupPanel = openGroup ? groups.find((g) => g.name === openGroup) ?? null : null;
  // 選択中の人物が複数グループにまたがる場合だけ、タグにグループ名を添える（同じグループなら冗長なため省略）
  const showGroupInChips = new Set(selected.map((n) => personByName.get(n)?.group ?? '')).size > 1;
  const groupAllSelected = !!groupPanel && groupPanel.currentMembers.length > 0
    && groupPanel.currentMembers.every((n) => selected.includes(n));

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

  const addPerson = (name: string) => {
    if (selected.includes(name)) return;
    if (selected.length >= OSHI_VOD_MAX_PERSONS) {
      setNotice(`一度に選べるのは${OSHI_VOD_MAX_PERSONS}人までです`);
      return;
    }
    setNotice(null);
    setSelected([...selected, name]);
  };

  const removePerson = (name: string) => {
    setNotice(null);
    setSelected((prev) => prev.filter((n) => n !== name));
  };

  const togglePerson = (name: string) => {
    if (selected.includes(name)) removePerson(name);
    else addPerson(name);
  };

  const chooseSuggestion = (s: PickerSuggestion) => {
    if (s.kind === 'person') addPerson(s.value);
    else setOpenGroup(s.value);
    setQuery('');
    setIsOpen(false);
    setActiveIdx(-1);
    if (s.kind === 'person') inputRef.current?.focus();
  };

  const addWholeGroup = (g: OshiVodPickerGroup) => {
    const toAdd = g.currentMembers.filter((n) => !selected.includes(n));
    if (selected.length + toAdd.length > OSHI_VOD_MAX_PERSONS) {
      setNotice(`合計${OSHI_VOD_MAX_PERSONS}人を超えるため追加できません。選択中の人物を減らすか、メンバーを個別に選んでください`);
      return;
    }
    setNotice(null);
    setSelected([...selected, ...toAdd]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setActiveIdx(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = suggestions[activeIdx >= 0 ? activeIdx : 0];
      if (s) chooseSuggestion(s);
    }
  };

  const submit = () => {
    if (selected.length === 0 || submitting) return;
    let src: DiagnosisStartSource = source ?? 'direct';
    if (!source) {
      try {
        const ref = document.referrer ? new URL(document.referrer) : null;
        if (ref && ref.origin === window.location.origin && ref.pathname === '/') src = 'top';
      } catch { /* ignore */ }
    }
    sendGaEvent('diagnosis_start', { person_count: selected.length, source: src });
    setSubmitting(true);
    router.push(buildOshiVodResultPath(selected));
  };

  // 選択内容が変わったら送信中表示を解除（同じURLへの遷移時の固着防止）
  useEffect(() => { setSubmitting(false); }, [selected]);

  const showDropdown = isOpen && suggestions.length > 0;

  return (
    <div className="ov-picker" ref={containerRef}>
      {/* ─ 検索欄 ─ */}
      <label htmlFor="oshi-vod-search" className="ov-picker-label">推しの名前・グループ名で探す</label>
      <div className="relative">
        <input
          id="oshi-vod-search"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); setActiveIdx(-1); }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={isFull ? `${OSHI_VOD_MAX_PERSONS}人まで選択済みです` : '例：目黒蓮、Snow Man'}
          className="ov-picker-input"
          style={{ fontSize: '16px' }}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="oshi-vod-suggest"
          aria-autocomplete="list"
          disabled={isFull}
        />
        {showDropdown && (
          <div id="oshi-vod-suggest" role="listbox" className="ov-picker-dropdown">
            {suggestions.map((s, idx) => {
              const already = s.kind === 'person' && selected.includes(s.value);
              return (
                <button
                  key={`${s.kind}-${s.value}`}
                  type="button"
                  role="option"
                  aria-selected={activeIdx === idx}
                  onMouseDown={(e) => { e.preventDefault(); chooseSuggestion(s); }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={`ov-picker-option${activeIdx === idx ? ' is-active' : ''}`}
                >
                  <span className="ov-picker-option-kind" aria-hidden="true">{s.kind === 'group' ? 'GROUP' : already ? '✓' : '+'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="ov-picker-option-label">{s.value}</span>
                    {s.sublabel && <span className="ov-picker-option-sub">{s.kind === 'group' ? `メンバー${s.sublabel}から選ぶ` : s.sublabel}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ─ グループから選ぶ ─ */}
      <details className="ov-picker-groups" open={!!groupPanel || undefined}>
        <summary>グループから選ぶ</summary>
        <div className="ov-picker-group-chips">
          {groups.map((g) => (
            <button
              key={g.name}
              type="button"
              className={`ov-chip${openGroup === g.name ? ' is-on' : ''}`}
              onClick={() => setOpenGroup(openGroup === g.name ? null : g.name)}
              aria-expanded={openGroup === g.name}
            >
              {g.name}
            </button>
          ))}
        </div>
        {groupPanel && (
          <div className="ov-group-panel" aria-label={`${groupPanel.name}のメンバー`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="ov-group-panel-title">{groupPanel.name}</p>
              {canSelectWholeGroup(groupPanel.currentMembers.length) ? (
                <button type="button" className="ov-btn-sub" onClick={() => addWholeGroup(groupPanel)} disabled={groupAllSelected}>
                  {groupAllSelected ? '✓ 全員選択済み' : `全員を選択（${groupPanel.currentMembers.length}人）`}
                </button>
              ) : (
                groupPanel.currentMembers.length > OSHI_VOD_MAX_PERSONS && (
                  <span className="ov-note">メンバーが{OSHI_VOD_MAX_PERSONS}人を超えるため、推しを選んでください</span>
                )
              )}
            </div>
            <div className="ov-picker-member-chips">
              {groupPanel.currentMembers.map((n) => (
                <button key={n} type="button" className={`ov-chip${selected.includes(n) ? ' is-on' : ''}`} aria-pressed={selected.includes(n)} onClick={() => togglePerson(n)}>
                  {selected.includes(n) ? '✓ ' : ''}{n}
                </button>
              ))}
            </div>
            {groupPanel.formerMembers.length > 0 && (
              <>
                <p className="ov-note mt-3">卒業・脱退メンバー</p>
                <div className="ov-picker-member-chips">
                  {groupPanel.formerMembers.map((n) => (
                    <button key={n} type="button" className={`ov-chip ov-chip--sub${selected.includes(n) ? ' is-on' : ''}`} aria-pressed={selected.includes(n)} onClick={() => togglePerson(n)}>
                      {selected.includes(n) ? '✓ ' : ''}{n}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </details>

      {/* ─ 選択中 ─ */}
      <div className="ov-picker-selected" aria-live="polite">
        <div className="flex items-baseline justify-between gap-2">
          <p className="ov-picker-label m-0">選んだ推し</p>
          <p className="ov-picker-count"><strong>{selected.length}</strong> / {OSHI_VOD_MAX_PERSONS}人</p>
        </div>
        {selected.length === 0 ? (
          <p className="ov-note">まだ選ばれていません。1〜5人くらいがおすすめです（グループ全員なら最大{OSHI_VOD_MAX_PERSONS}人まで）。</p>
        ) : (
          <ul className="ov-selected-chips">
            {selected.map((n) => (
              <li key={n}>
                <span className="ov-selected-chip">
                  <span className="truncate">{n}</span>
                  {showGroupInChips && personByName.get(n)?.group && <span className="ov-selected-chip-sub">{personByName.get(n)!.group}</span>}
                  <button type="button" onClick={() => removePerson(n)} aria-label={`${n}を外す`} className="ov-selected-chip-x">×</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {notice && <p className="ov-notice" role="status">{notice}</p>}
      </div>

      <button type="button" className={`ov-btn-main${selected.length > 0 ? ' is-sticky' : ''}`} onClick={submit} disabled={selected.length === 0 || submitting}>
        {submitting ? '診断中…' : selected.length > 0 ? `${selected.length}人で${submitLabel}` : submitLabel}
      </button>
    </div>
  );
}
