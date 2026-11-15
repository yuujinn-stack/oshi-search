// A/Bテストの定義と、基本の設定に A/B の差分を当てる処理（DB非依存）。

import { COLOR_PRESETS, type LinkPosition, type SlideCount, type StoryDesign } from './templates';
import type { AbTestKey, AbVariant } from './utm';

export interface AbTestDef {
  key: AbTestKey;
  label: string;
  a: string;
  b: string;
}

export const AB_TESTS: AbTestDef[] = [
  { key: 'slides', label: '投稿枚数', a: '1枚構成', b: '3枚構成' },
  { key: 'link', label: 'リンク位置', a: '中央（50%）', b: '中央下（60%）' },
  { key: 'cta', label: 'CTA文言', a: '「詳しくはこちら」', b: 'テンプレートのCTA' },
  { key: 'bg', label: '背景色', a: '黄色', b: 'ピンク' },
];

export const AB_CTA_A_DEFAULT = '詳しくはこちら';

/** 1つのパターンの設定 */
export interface StoryVariantConfig {
  slides: SlideCount;
  design: StoryDesign;
  /** スタンプのあるページの CTA 文言を差し替える（null＝テンプレート・編集した文言のまま） */
  ctaOverride: string | null;
}

export interface AbSettings {
  test: AbTestKey;
  /** CTA テストの A・B の文言（B が空ならテンプレート・編集した文言） */
  ctaA: string;
  ctaB: string;
}

const SLIDES: Record<AbVariant, SlideCount> = { a: 1, b: 3 };
const LINK: Record<AbVariant, LinkPosition> = { a: 50, b: 60 };
const BG: Record<AbVariant, 'yellow' | 'pink'> = { a: 'yellow', b: 'pink' };

export function applyAbVariant(base: StoryVariantConfig, ab: AbSettings | null, variant: AbVariant): StoryVariantConfig {
  if (!ab) return base;
  switch (ab.test) {
    case 'slides':
      return { ...base, slides: SLIDES[variant] };
    case 'link':
      return { ...base, design: { ...base.design, linkPos: LINK[variant] } };
    case 'bg':
      return { ...base, design: { ...base.design, colors: { ...COLOR_PRESETS[BG[variant]].colors } } };
    case 'cta': {
      const text = (variant === 'a' ? ab.ctaA : ab.ctaB).trim();
      return { ...base, ctaOverride: text || null };
    }
  }
}
