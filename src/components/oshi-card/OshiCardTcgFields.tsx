'use client';

// トレカ風デザイン（ベーシック／SSR／レジェンド）のカスタマイズ欄：メインの名前・特性・沼ポイント・推し力・推し色。
// 入力中の文字列（draft）をそのまま持ち、カードに使う値への変換・検証は src/lib/oshi-card/tcg.ts の関数で行う。
// デザインを切り替えても draft は作成画面側で保持するため、入力内容は消えない。
import {
  OSHI_CARD_COLORS,
  OSHI_CARD_NAME_MAX,
  OSHI_CARD_NUMA_PRESETS,
  OSHI_CARD_POWER_MAX,
  OSHI_CARD_POWER_NOTE,
  OSHI_CARD_TCG_TEMPLATES,
  OSHI_CARD_TRAIT_MAX,
  OSHI_CARD_TRAIT_PRESETS,
  sanitizeOshiCardPower,
  sanitizeOshiCardText,
  type OshiCardTcgVariant,
} from '@/lib/oshi-card/tcg';

export type { OshiCardTcgDraft } from '@/lib/oshi-card/tcg';
import type { OshiCardTcgDraft } from '@/lib/oshi-card/tcg';

interface Props {
  variant: OshiCardTcgVariant;
  person: { name: string; group: string };
  draft: OshiCardTcgDraft;
  onChange: (next: OshiCardTcgDraft) => void;
}

const POWER_QUICK = [100, 999, 9999, 99999];

/** 入力したのに使えない（URL・@ID 等）とき true */
function rejected(raw: string, max: number): boolean {
  return raw.trim() !== '' && sanitizeOshiCardText(raw, max) === null;
}

export default function OshiCardTcgFields({ variant, person, draft, onChange }: Props) {
  const set = (patch: Partial<OshiCardTcgDraft>) => onChange({ ...draft, ...patch });
  const templateColor = OSHI_CARD_TCG_TEMPLATES[variant].defaultColor;
  const activeColor = draft.color ?? templateColor;
  const powerInvalid = draft.power.trim() !== '' && sanitizeOshiCardPower(draft.power) === null;

  return (
    <div className="oc-tcg">
      <p className="oc-tcg-title">トレカのカスタマイズ</p>

      <div className="oc-field">
        <label className="oc-label" htmlFor="oc-tcg-name">メインの名前（カード中央に大きく表示）</label>
        <input
          id="oc-tcg-name"
          className="oc-input"
          type="text"
          value={draft.name}
          placeholder={person.name}
          maxLength={OSHI_CARD_NAME_MAX}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => set({ name: e.target.value })}
          style={{ fontSize: '16px' }}
        />
        <div className="oc-chips oc-chips--tight">
          <button type="button" className={`oc-chip${draft.name.trim() === '' ? ' is-on' : ''}`} onClick={() => set({ name: '' })}>{person.name}</button>
          {person.group && <button type="button" className={`oc-chip${draft.name.trim() === person.group ? ' is-on' : ''}`} onClick={() => set({ name: person.group })}>{person.group}</button>}
        </div>
        {rejected(draft.name, OSHI_CARD_NAME_MAX) && <p className="oc-field-error" role="alert">URL・@ID・電話番号は入れられません。推しの名前に戻して表示します。</p>}
      </div>

      <div className="oc-field">
        <label className="oc-label" htmlFor="oc-tcg-trait">特性（{OSHI_CARD_TRAIT_MAX}文字まで）</label>
        <input id="oc-tcg-trait" className="oc-input" type="text" value={draft.trait} maxLength={OSHI_CARD_TRAIT_MAX} autoComplete="off" enterKeyHint="done" onChange={(e) => set({ trait: e.target.value })} style={{ fontSize: '16px' }} />
        <div className="oc-chips oc-chips--tight">
          {OSHI_CARD_TRAIT_PRESETS.map((p) => (
            <button key={p} type="button" className={`oc-chip${draft.trait === p ? ' is-on' : ''}`} onClick={() => set({ trait: p })}>{p}</button>
          ))}
        </div>
        {rejected(draft.trait, OSHI_CARD_TRAIT_MAX) && <p className="oc-field-error" role="alert">URL・@ID・電話番号は入れられません。</p>}
      </div>

      <div className="oc-field">
        <label className="oc-label" htmlFor="oc-tcg-numa">沼ポイント（{OSHI_CARD_TRAIT_MAX}文字まで）</label>
        <input id="oc-tcg-numa" className="oc-input" type="text" value={draft.numa} maxLength={OSHI_CARD_TRAIT_MAX} autoComplete="off" enterKeyHint="done" onChange={(e) => set({ numa: e.target.value })} style={{ fontSize: '16px' }} />
        <div className="oc-chips oc-chips--tight">
          {OSHI_CARD_NUMA_PRESETS.map((p) => (
            <button key={p} type="button" className={`oc-chip${draft.numa === p ? ' is-on' : ''}`} onClick={() => set({ numa: p })}>{p}</button>
          ))}
        </div>
        {rejected(draft.numa, OSHI_CARD_TRAIT_MAX) && <p className="oc-field-error" role="alert">URL・@ID・電話番号は入れられません。</p>}
      </div>

      <div className="oc-field">
        <label className="oc-label" htmlFor="oc-tcg-power">推し力（0〜{OSHI_CARD_POWER_MAX.toLocaleString('en-US')}）</label>
        <input
          id="oc-tcg-power"
          className="oc-input oc-input--power"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft.power}
          maxLength={6}
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => set({ power: e.target.value.replace(/[^0-9０-９]/g, '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)) })}
          style={{ fontSize: '16px' }}
        />
        <div className="oc-chips oc-chips--tight">
          {POWER_QUICK.map((n) => (
            <button key={n} type="button" className={`oc-chip${draft.power === String(n) ? ' is-on' : ''}`} onClick={() => set({ power: String(n) })}>{n.toLocaleString('en-US')}</button>
          ))}
        </div>
        {powerInvalid && <p className="oc-field-error" role="alert">数字で入力してください。</p>}
        <p className="oc-note">{OSHI_CARD_POWER_NOTE}</p>
      </div>

      <div className="oc-field">
        <p className="oc-label" id="oc-tcg-color-label">推し色（{OSHI_CARD_COLORS.find((c) => c.id === activeColor)?.label}{draft.color === null ? '・デザインの色' : ''}）</p>
        <div className="oc-colors" role="radiogroup" aria-labelledby="oc-tcg-color-label">
          {OSHI_CARD_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={activeColor === c.id}
              aria-label={c.label}
              className={`oc-color${activeColor === c.id ? ' is-on' : ''}`}
              onClick={() => set({ color: c.id })}
            >
              <span className="oc-color-dot" style={{ background: `linear-gradient(135deg, ${c.light} 0%, ${c.base} 55%, ${c.deep} 100%)` }} aria-hidden="true" />
              <span className="oc-color-name">{c.label}</span>
            </button>
          ))}
        </div>
        {draft.color !== null && <button type="button" className="oc-btn-sub oc-color-reset" onClick={() => set({ color: null })}>デザインの色に戻す</button>}
      </div>
    </div>
  );
}
