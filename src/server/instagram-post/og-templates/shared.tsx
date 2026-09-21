/**
 * 3枚すべてで共通して使う小さな部品（背景装飾・「推しサーチ」ブランドラベル）。
 * デザイン値そのものは ./theme.ts に集約してあり、ここではそれを使ってJSXを組み立てるだけ。
 */
import type { ReactElement } from 'react';
import { BRAND, COLORS, FONT_FAMILY } from './theme';
import type { DecorCircleConfig, DecorDotConfig } from './theme';

/**
 * 値がundefinedのキーを除去する。
 *
 * 注意（Satoriのハマりどころ）: style オブジェクトに `top: undefined` のように
 * キー自体は存在するが値がundefinedのプロパティを含めると、Satori内部で
 * "Cannot read properties of undefined (reading 'trim')" というエラーになることを
 * 実際に確認した（キーが存在しないのと、値がundefinedなのとでは扱いが異なる）。
 * 装飾円・ドットのように「top/bottom/left/rightのうち一部だけ指定する」ケースで必須。
 */
export function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== undefined) result[key] = obj[key];
  }
  return result;
}

/**
 * 背景の装飾（ぼかした円・小さなドット）。
 * 元のHTML/CLI版は「✦」記号で星を表現していたが、Noto Sans JPフォントにこのグリフが
 * 含まれているか保証できないため、同じ雰囲気を保てる小さな丸ドット（フォント非依存）に
 * 置き換えている。
 */
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

/** 「推しサーチ」ブランドラベル（ロゴ代わりのワードマーク）。marginTopだけページごとに異なる */
export function BrandLabel({ marginTop = 72 }: { marginTop?: number }): ReactElement {
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
