/**
 * works-picksテンプレート 3枚目: CTA専用ページ。人物写真は使用しない。
 * 1枚目と同じ番号バッジを再掲し、「3選」ブランドの一貫性を持たせている。
 */
import type { ReactElement } from 'react';
import { CANVAS, COLORS, FONT_FAMILY, PAGE3 } from './theme';
import { BrandLabel, Decorations, NumberBadgeRow } from './shared';

export interface WorksPicksPage3Data {
  personName: string;
}

export function buildWorksPicksPage3Element(data: WorksPicksPage3Data): ReactElement {
  const [titleLine1, titleLine2] = PAGE3.buildTitleLines(data.personName);

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
        justifyContent: 'center',
        fontFamily: FONT_FAMILY,
      }}
    >
      <Decorations circles={[...PAGE3.decorations.circles]} dots={[...PAGE3.decorations.dots]} />
      <BrandLabel marginTop={PAGE3.brandLabelMarginTop} />
      <div
        style={{
          marginTop: PAGE3.title.marginTop,
          textAlign: 'center',
          fontSize: PAGE3.title.fontSize,
          fontWeight: 700,
          lineHeight: PAGE3.title.lineHeight,
          color: COLORS.textDark,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <span>{titleLine1}</span>
        <span>{titleLine2}</span>
      </div>
      <div
        style={{
          marginTop: PAGE3.subtitle.marginTop,
          textAlign: 'center',
          fontSize: PAGE3.subtitle.fontSize,
          lineHeight: PAGE3.subtitle.lineHeight,
          fontWeight: 700,
          color: COLORS.accentDark,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <span>{PAGE3.subtitle.lines[0]}</span>
        <span>{PAGE3.subtitle.lines[1]}</span>
      </div>

      <div
        style={{
          position: 'relative',
          marginTop: PAGE3.artCard.marginTop,
          width: PAGE3.artCard.width,
          height: PAGE3.artCard.height,
          borderRadius: PAGE3.artCard.borderRadius,
          border: `${PAGE3.artCard.borderWidth}px solid ${COLORS.artCardBorder}`,
          background: `linear-gradient(160deg, ${COLORS.artCardBackground} 0%, ${COLORS.white} 100%)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <NumberBadgeRow size={PAGE3.badge.size} fontSize={PAGE3.badge.fontSize} gap={32} />
      </div>

      <div
        style={{
          position: 'relative',
          marginTop: PAGE3.cta.marginTop,
          width: PAGE3.cta.width,
          background: COLORS.accentDark,
          color: COLORS.white,
          fontWeight: 700,
          fontSize: PAGE3.cta.fontSize,
          padding: `${PAGE3.cta.paddingY}px ${PAGE3.cta.paddingX}px`,
          borderRadius: PAGE3.cta.borderRadius,
          boxShadow: PAGE3.cta.boxShadow,
          textAlign: 'center',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {PAGE3.cta.text}
      </div>
    </div>
  );
}
