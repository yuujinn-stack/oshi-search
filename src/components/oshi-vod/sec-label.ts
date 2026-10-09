import type { CSSProperties } from 'react';

/** C案共通スタイル（graphic-site.css）のセクション見出し英字ラベルを指定する */
export function secLabel(label: string): CSSProperties {
  return { ['--graphic-sec-label' as string]: `'${label}'` } as CSSProperties;
}
