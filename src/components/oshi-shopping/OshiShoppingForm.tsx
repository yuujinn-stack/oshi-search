'use client';

// 推し活お買い物診断の入力フォーム（Q1 推しを1人選ぶ → Q2 用途 → Q3 予算）。
// 人物検索は推しに合うサブスク診断と同じデータ・検索関数（src/lib/oshi-vod/picker.ts）を使う。
// グループ名で検索した場合はメンバーの中から1人を選ぶ（グループ単位の診断はしない）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  searchPickerSuggestions,
  type OshiVodPickerGroup,
  type OshiVodPickerPerson,
  type PickerSuggestion,
} from '@/lib/oshi-vod/picker';
import {
  BUDGET_OPTIONS,
  USE_OPTIONS,
  buildOshiShoppingResultPath,
  type OshiShoppingBudget,
  type OshiShoppingUse,
} from '@/lib/oshi-shopping/params';
import { sendGaEvent } from '@/lib/ga-event';

interface Props {
  persons: OshiVodPickerPerson[];
  groups: OshiVodPickerGroup[];
  initialPerson?: string;
  initialUse?: OshiShoppingUse | null;
  initialBudget?: OshiShoppingBudget | null;
  submitLabel?: string;
}

export default function OshiShoppingForm({ persons, groups, initialPerson, initialUse, initialBudget, submitLabel = '診断する' }: Props) {
  const router = useRouter();
  const personByName = useMemo(() => new Map(persons.map((p) => [p.name, p])), [persons]);
  const [person, setPerson] = useState<string | null>(initialPerson && personByName.has(initialPerson) ? initialPerson : null);
  const [use, setUse] = useState<OshiShoppingUse | null>(initialUse ?? null);
  const [budget, setBudget] = useState<OshiShoppingBudget | null>(initialBudget ?? null);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => searchPickerSuggestions(query, persons, groups), [query, persons, groups]);
  const groupPanel = openGroup ? groups.find((g) => g.name === openGroup) ?? null : null;
  const showDropdown = isOpen && suggestions.length > 0;
  const ready = !!person && !!use && !!budget;

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

  // 条件が変わったら送信中表示を解除（同じURLへの遷移時の固着防止）
  useEffect(() => { setSubmitting(false); }, [person, use, budget]);

  const choosePerson = (name: string) => {
    setPerson(name);
    setOpenGroup(null);
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
    if (!person || !use || !budget || submitting) return;
    sendGaEvent('oshi_shopping_start', { use, budget });
    setSubmitting(true);
    router.push(buildOshiShoppingResultPath(person, use, budget));
  };

  const selectedGroup = person ? personByName.get(person)?.group : '';

  return (
    <div className="os-form">
      {/* ─ Q1 推し ─ */}
      <fieldset className="os-q">
        <legend className="os-q-title"><span className="os-q-num">Q1</span>推しを選ぶ</legend>
        {person ? (
          <div className="os-selected">
            <span className="os-selected-name">{person}</span>
            {selectedGroup && <span className="os-selected-sub">{selectedGroup}</span>}
            <button type="button" className="os-btn-sub" onClick={() => setPerson(null)}>変更する</button>
          </div>
        ) : (
          <div ref={containerRef}>
            <label htmlFor="oshi-shopping-search" className="os-label">推しの名前・グループ名で探す</label>
            <div className="relative">
              <input
                id="oshi-shopping-search"
                type="search"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setIsOpen(true); setActiveIdx(-1); }}
                onFocus={() => setIsOpen(true)}
                onKeyDown={handleKeyDown}
                placeholder="例：目黒蓮、乃木坂46"
                className="os-input"
                style={{ fontSize: '16px' }}
                autoComplete="off"
                role="combobox"
                aria-expanded={showDropdown}
                aria-controls="oshi-shopping-suggest"
                aria-autocomplete="list"
              />
              {showDropdown && (
                <div id="oshi-shopping-suggest" role="listbox" className="os-dropdown">
                  {suggestions.map((s, idx) => (
                    <button
                      key={`${s.kind}-${s.value}`}
                      type="button"
                      role="option"
                      aria-selected={activeIdx === idx}
                      onMouseDown={(e) => { e.preventDefault(); chooseSuggestion(s); }}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={`os-option${activeIdx === idx ? ' is-active' : ''}`}
                    >
                      <span className="os-option-kind" aria-hidden="true">{s.kind === 'group' ? 'GROUP' : '+'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="os-option-label">{s.value}</span>
                        {s.sublabel && <span className="os-option-sub">{s.kind === 'group' ? `メンバー${s.sublabel}から選ぶ` : s.sublabel}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {groupPanel && (
              <div className="os-group-panel">
                <p className="os-group-title">{groupPanel.name}のメンバーから1人選ぶ</p>
                <div className="os-chips">
                  {[...groupPanel.currentMembers, ...groupPanel.formerMembers].map((n) => (
                    <button key={n} type="button" className="os-chip" onClick={() => choosePerson(n)}>{n}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </fieldset>

      {/* ─ Q2 用途 ─ */}
      <fieldset className="os-q">
        <legend className="os-q-title"><span className="os-q-num">Q2</span>何に使う商品を探していますか？</legend>
        <div className="os-choices" role="radiogroup" aria-label="用途">
          {USE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={use === o.value}
              className={`os-choice${use === o.value ? ' is-on' : ''}`}
              onClick={() => setUse(o.value)}
            >
              <span className="os-choice-label">{o.label}</span>
              <span className="os-choice-desc">{o.description}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* ─ Q3 予算 ─ */}
      <fieldset className="os-q">
        <legend className="os-q-title"><span className="os-q-num">Q3</span>1つあたりの予算は？</legend>
        <div className="os-chips" role="radiogroup" aria-label="予算">
          {BUDGET_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={budget === o.value}
              className={`os-chip${budget === o.value ? ' is-on' : ''}`}
              onClick={() => setBudget(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </fieldset>

      <button type="button" className="os-btn-main" disabled={!ready || submitting} onClick={submit}>
        {submitting ? '診断しています…' : submitLabel}
      </button>
      {!ready && (
        <p className="os-note" role="status">
          {!person ? '推しを選んでください' : !use ? '用途を選んでください' : '予算を選んでください'}
        </p>
      )}
    </div>
  );
}
