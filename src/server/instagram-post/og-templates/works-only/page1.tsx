/**
 * works-onlyテンプレート 1枚目: 表紙。人物写真は使用しない。
 * デザイン値は ./theme.ts の PAGE1 / COLORS を参照。
 */
import type { ReactElement } from 'react';
import { CANVAS, COLORS, FONT_FAMILY, PAGE1 } from './theme';
import { BrandLabel, Decorations, ArtChipCluster, CircleBadge } from './shared';

export interface WorksOnlyPage1Data {
  personName: string;
}

export function buildWorksOnlyPage1Element(data: WorksOnlyPage1Data): ReactElement {
  const [titleLine1, titleLine2] = PAGE1.buildTitleLines(data.personName);
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

      {/* 人物写真の代わりの装飾エリア（抽象的な作品カード＋円装飾） */}
      <div
        style={{
          position: 'relative',
          marginTop: PAGE1.artCard.marginTop,
          width: PAGE1.artCard.width,
          height: PAGE1.artCard.height,
          borderRadius: PAGE1.artCard.borderRadius,
          overflow: 'hidden',
          border: `${PAGE1.artCard.borderWidth}px solid ${COLORS.artCardBorder}`,
          background: `linear-gradient(135deg, ${COLORS.artCardBackground} 0%, ${COLORS.white} 100%)`,
          display: 'flex',
        }}
      >
        <ArtChipCluster />
        <CircleBadge size={72} color={COLORS.accentDark} left={140} bottom={70} />
        <CircleBadge size={56} color={COLORS.accent} left={480} bottom={100} />
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
