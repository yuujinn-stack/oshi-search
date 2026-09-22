/**
 * works-onlyテンプレート専用の共通部品。デザイン値は ./theme.ts を参照する。
 * pickDefined() は完全に汎用（テーマに依存しない）のため、default-person側の
 * shared.tsx から流用し、重複実装はしていない。
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

export function BrandLabel({ marginTop = 44 }: { marginTop?: number }): ReactElement {
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

/**
 * 人物写真の代わりに使う、抽象的な「作品カード」チップ（実在サービスのロゴ等は一切使わない）。
 * 3枚をわずかにずらして重ねて並べ、「複数の作品がある」ことを視覚的に示すだけの装飾。
 * 各チップ上部に半透明の帯（ハイライトバー）を1本添えて、単なる色面ではなく
 * 「カードらしさ」が出るようにしている（グラデーション・アイコン等は使わず安全なCSSのみ）。
 */
export function ArtChipCluster(): ReactElement {
  const chipBase = {
    width: 150,
    height: 210,
    borderRadius: 20,
    position: 'absolute' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center' as const,
    paddingTop: 22,
  };
  const highlightBar = { width: '62%', height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.55)', display: 'flex' };
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex' }}>
      <div style={{ ...chipBase, left: 90, top: 220, background: COLORS.artChipColors[2], transform: 'rotate(-6deg)' }}>
        <div style={highlightBar} />
      </div>
      <div style={{ ...chipBase, left: 275, top: 190, background: COLORS.artChipColors[1], transform: 'rotate(3deg)' }}>
        <div style={highlightBar} />
      </div>
      <div style={{ ...chipBase, left: 460, top: 220, background: COLORS.artChipColors[0], transform: 'rotate(-3deg)' }}>
        <div style={highlightBar} />
      </div>
    </div>
  );
}

/**
 * 汎用の円形装飾バッジ（特定サービスのアイコンを模したものではない）。
 * 三角形（再生アイコン風）の表現はSatori上で意図通り描画されなかったため廃止し、
 * 同心円のみのシンプルな装飾に置き換えた（確実に安定して描画される表現）。
 */
export function CircleBadge({ size, color, left, bottom }: { size: number; color: string; left: number; bottom: number }): ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left,
        bottom,
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: size * 0.4, height: size * 0.4, borderRadius: '50%', background: COLORS.white, display: 'flex' }} />
    </div>
  );
}
