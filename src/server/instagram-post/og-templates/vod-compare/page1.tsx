/**
 * vod-compareテンプレート 1枚目: 表紙。人物写真は使用しない。
 * 実データの集計（2枚目）を予感させる「比較バー」風の装飾を表示する。
 */
import type { ReactElement } from 'react';
import { CANVAS, COLORS, FONT_FAMILY, PAGE1 } from './theme';
import { BrandLabel, Decorations } from './shared';

export interface VodComparePage1Data {
  personName: string;
}

export function buildVodComparePage1Element(data: VodComparePage1Data): ReactElement {
  const [titleLine1, titleLine2] = PAGE1.buildTitleLines(data.personName);
  const { previewCard } = PAGE1;

  return (
    <div
      style={{
        position: 'relative',
        width: CANVAS.width,
        height: CANVAS.height,
        background: COLORS.background,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: FONT_FAMILY,
      }}
    >
      <Decorations circles={[...PAGE1.decorations.circles]} dots={[...PAGE1.decorations.dots]} />
      <BrandLabel marginTop={PAGE1.brandLabelMarginTop} />
      <div
        style={{
          position: 'relative',
          marginTop: PAGE1.title.marginTop,
          textAlign: 'center',
          fontSize: PAGE1.title.fontSize,
          fontWeight: 700,
          lineHeight: PAGE1.title.lineHeight,
          color: COLORS.textDark,
          padding: `0 ${PAGE1.title.paddingX}px`,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <span>{titleLine1}</span>
        <span>{titleLine2}</span>
      </div>

      {/* 比較バー風の装飾（実データではなく、2枚目で実際の比較を見せる予告表現） */}
      <div
        style={{
          position: 'relative',
          marginTop: previewCard.marginTop,
          width: previewCard.width,
          height: previewCard.height,
          borderRadius: previewCard.borderRadius,
          border: `${previewCard.borderWidth}px solid ${COLORS.cardBorder}`,
          background: `linear-gradient(135deg, ${COLORS.panelBackground} 0%, ${COLORS.white} 100%)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 28,
        }}
      >
        {previewCard.barWidths.map((w, i) => (
          <div
            key={i}
            style={{
              width: previewCard.barWidths[0] + 60,
              height: previewCard.barHeight,
              borderRadius: previewCard.barHeight / 2,
              background: COLORS.white,
              border: `2px solid ${COLORS.cardBorder}`,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 8,
              paddingRight: 8,
            }}
          >
            <div
              style={{
                width: w,
                height: previewCard.barHeight - 8,
                borderRadius: (previewCard.barHeight - 8) / 2,
                background: i === 0 ? COLORS.accentDark : COLORS.accent,
                opacity: 1 - i * 0.18,
                display: 'flex',
              }}
            />
          </div>
        ))}
      </div>

      <div
        style={{
          position: 'relative',
          marginTop: PAGE1.cta.marginTop,
          fontSize: PAGE1.cta.fontSize,
          fontWeight: 700,
          textAlign: 'center',
          color: COLORS.accentDark,
          display: 'flex',
        }}
      >
        {PAGE1.cta.text}
      </div>
    </div>
  );
}
