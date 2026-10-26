'use client';

// 推し布教カードのデザイン切り替え（ノーマル＝cool・Editorial Premium／デコ＝cute・Fan Sticker）。作成画面とカードのページで共通。
// 表示名だけを布教カード向けにしている。内部の値（cool / cute）は共有URL（v）・OG画像・GA4（variant）と共通のため変えない。
import type { OshiCardVariant } from '@/lib/oshi-card/params';

const OPTIONS: { value: OshiCardVariant; label: string; hint: string }[] = [
  { value: 'cool', label: 'ノーマル', hint: 'すっきり・見やすいデザイン' },
  { value: 'cute', label: 'デコ', hint: 'カラフル・シール風デザイン' },
];

export default function OshiCardVariantToggle({ value, onChange }: { value: OshiCardVariant; onChange: (v: OshiCardVariant) => void }) {
  return (
    <div className="oc-variant" role="radiogroup" aria-label="カードのデザイン">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`oc-variant-btn oc-variant-btn--${o.value}`} onClick={() => onChange(o.value)}>
          <span className="oc-variant-swatch" aria-hidden="true" />
          <span className="oc-variant-text">
            <span className="oc-variant-label">{o.label}</span>
            <span className="oc-variant-hint">{o.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
