'use client';

// 推し布教カード：推しを1人選ぶ。人物検索はサブスク診断と同じデータ・検索関数（src/lib/oshi-vod/picker.ts）。
// グループ名で検索した場合はメンバーの中から1人を選ぶ。選んだら作成画面（/oshi-card?p=人物）へ。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { searchPickerSuggestions, type OshiVodPickerGroup, type OshiVodPickerPerson, type PickerSuggestion } from '@/lib/oshi-vod/picker';
import { buildOshiCardEditPath, type OshiCardEntrySource } from '@/lib/oshi-card/params';
import { oshiCardShareParams } from '@/lib/oshi-card/attribution';
import { sendGaEvent } from '@/lib/ga-event';

interface Props {
  persons: OshiVodPickerPerson[];
  groups: OshiVodPickerGroup[];
  from?: OshiCardEntrySource | null;
}

export default function OshiCardPersonPicker({ persons, groups, from }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => searchPickerSuggestions(query, persons, groups), [query, persons, groups]);
  const groupPanel = openGroup ? groups.find((g) => g.name === openGroup) ?? null : null;
  const showDropdown = isOpen && suggestions.length > 0;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) { setIsOpen(false); setActiveIdx(-1); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const choosePerson = (name: string) => {
    sendGaEvent('oshi_card_person_select', { source: from ?? 'direct', ...oshiCardShareParams() });
    setMoving(name);
    router.push(buildOshiCardEditPath(name, from ? { from } : {}));
  };

  const chooseSuggestion = (s: PickerSuggestion) => {
    if (s.kind === 'person') choosePerson(s.value);
    else setOpenGroup(s.value);
    setQuery('');
    setIsOpen(false);
    setActiveIdx(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, -1)); }
    else if (e.key === 'Escape') { setIsOpen(false); setActiveIdx(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const s = suggestions[activeIdx >= 0 ? activeIdx : 0];
      if (s) chooseSuggestion(s);
    }
  };

  return (
    <div className="oc-panel" ref={containerRef}>
      <label htmlFor="oshi-card-search" className="oc-label">推しの名前・グループ名で探す</label>
      <div className="relative">
        <input
          id="oshi-card-search"
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); setActiveIdx(-1); }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="例：目黒蓮、乃木坂46"
          className="oc-input"
          style={{ fontSize: '16px' }}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="oshi-card-suggest"
          aria-autocomplete="list"
          disabled={!!moving}
        />
        {showDropdown && (
          <div id="oshi-card-suggest" role="listbox" className="oc-dropdown">
            {suggestions.map((s, idx) => (
              <button
                key={`${s.kind}-${s.value}`}
                type="button"
                role="option"
                aria-selected={activeIdx === idx}
                onMouseDown={(e) => { e.preventDefault(); chooseSuggestion(s); }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`oc-option${activeIdx === idx ? ' is-active' : ''}`}
              >
                <span className="oc-option-kind" aria-hidden="true">{s.kind === 'group' ? 'GROUP' : '+'}</span>
                <span className="min-w-0 flex-1">
                  <span className="oc-option-label">{s.value}</span>
                  {s.sublabel && <span className="oc-option-sub">{s.kind === 'group' ? `メンバー${s.sublabel}から選ぶ` : s.sublabel}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {groupPanel && (
        <div className="oc-group-panel">
          <p className="oc-group-title">{groupPanel.name}のメンバーから1人選ぶ</p>
          <div className="oc-chips">
            {[...groupPanel.currentMembers, ...groupPanel.formerMembers].map((n) => (
              <button key={n} type="button" className="oc-chip" onClick={() => choosePerson(n)} disabled={!!moving}>{n}</button>
            ))}
          </div>
        </div>
      )}
      {moving && <p className="oc-note" role="status">{moving}の作品を読み込んでいます…</p>}
    </div>
  );
}
