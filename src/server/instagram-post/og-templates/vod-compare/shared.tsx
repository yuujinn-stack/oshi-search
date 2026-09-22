/**
 * vod-compareテンプレート専用の共通部品。デザイン値は ./theme.ts を参照する。
 * pickDefined() は完全に汎用のため default-person側の shared.tsx から流用する。
 */
import type { ReactElement } from 'react';
import { pickDefined } from '../shared';
import { BRAND, COLORS, FONT_FAMILY } from './theme';
import type { DecorCircleConfig, DecorDotConfig } from './theme';

export { pickDefined };

export function Decorations({ circles, dots }: { circles: DecorCircleConfig[]; dots: DecorDotConfig[] }): ReactElement {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      {circles.map((c, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: c.size,
            height: c.size,
            ...pickDefined({ top: c.top, bottom: c.bottom, left: c.left, right: c.right }),
            borderRadius: '50%',
            filter: 'blur(50px)',
            background: `radial-gradient(circle, rgba(${COLORS.decorRgb},${c.opacity}) 0%, rgba(${COLORS.decorRgb},0) 70%)`,
            display: 'flex',
          }}
        />
      ))}
      {dots.map((d, i) => (
        <div
          key={`dot-${i}`}
          style={{
            position: 'absolute',
            width: d.size,
            height: d.size,
            ...pickDefined({ top: d.top, left: d.left, right: d.right }),
            borderRadius: '50%',
            background: `rgba(${COLORS.decorRgb},0.28)`,
            display: 'flex',
          }}
        />
      ))}
    </div>
  );
}

export function BrandLabel({ marginTop = 40 }: { marginTop?: number }): ReactElement {
  return (
    <div
      style={{
        marginTop,
        fontSize: BRAND.fontSize,
        fontWeight: 700,
        letterSpacing: BRAND.letterSpacing,
        color: COLORS.accentDark,
        fontFamily: FONT_FAMILY,
        display: 'flex',
      }}
    >
      {BRAND.label}
    </div>
  );
}
