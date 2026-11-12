'use client';

// 推し布教カードのデザイン切り替え。作成画面とカードのページで共通。
// - ノーマル＝cool・Editorial Premium／デコ＝cute・Fan Sticker（従来の2種類）
// - ベーシック＝basic／SSR＝ssr（トレカ風。名前を装飾したカード）。レジェンド＝legend は未公開のため出さない（OSHI_CARD_VARIANTS）
// 表示名だけを布教カード向けにしている。内部の値は共有URL（v）・OG画像・GA4（variant）と共通のため変えない。
// スマホでも1行に並ぶよう、小さなカードの形のサムネイル（CSSで描く。画像の読み込みなし）にする。
import { OSHI_CARD_VARIANTS, type OshiCardVariant } from '@/lib/oshi-card/params';

export const OSHI_CARD_VARIANT_OPTIONS: { value: OshiCardVariant; label: string; hint: string }[] = [
  { value: 'cool', label: 'ノーマル', hint: 'すっきり・見やすいデザイン' },
  { value: 'cute', label: 'デコ', hint: 'カラフル・シール風デザイン' },
  { value: 'basic', label: 'ベーシック', hint: 'トレカ風・ピンク×ハート×リボンのかわいいカード' },
  { value: 'ssr', label: 'SSR', hint: 'トレカ風・虹色ホログラムのキラキラカード' },
  { value: 'legend', label: 'レジェンド', hint: 'トレカ風・黒×ゴールドの高級感カード' },
].filter((o) => OSHI_CARD_VARIANTS.includes(o.value as OshiCardVariant)) as { value: OshiCardVariant; label: string; hint: string }[];

export function oshiCardVariantLabel(v: OshiCardVariant): string {
  return OSHI_CARD_VARIANT_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

export default function OshiCardVariantToggle({ value, onChange, only }: { value: OshiCardVariant; onChange: (v: OshiCardVariant) => void; only?: OshiCardVariant[] }) {
  const options = only ? OSHI_CARD_VARIANT_OPTIONS.filter((o) => only.includes(o.value)) : OSHI_CARD_VARIANT_OPTIONS;
  const current = options.find((o) => o.value === value);
  return (
    <div className="oc-variant-wrap">
      <div className="oc-variant" role="radiogroup" aria-label="カードのデザイン" style={{ ['--oc-variant-count' as string]: options.length }}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} aria-label={`${o.label}（${o.hint}）`} className={`oc-variant-btn oc-variant-btn--${o.value}`} onClick={() => onChange(o.value)}>
            <span className="oc-variant-thumb" aria-hidden="true">
              <span className="oc-variant-thumb-name">推</span>
            </span>
            <span className="oc-variant-label">{o.label}</span>
          </button>
        ))}
      </div>
      {current && <p className="oc-variant-hint" aria-live="polite">{current.label}：{current.hint}</p>}
    </div>
  );
}
