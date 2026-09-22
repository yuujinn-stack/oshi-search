/**
 * vod-compareテンプレート 3枚目: CTA専用ページ。人物写真は使用しない。
 */
import type { ReactElement } from 'react';
import { CANVAS, COLORS, FONT_FAMILY, PAGE3 } from './theme';
import { BrandLabel, Decorations } from './shared';

export interface VodComparePage3Data {
  personName: string;
}

export function buildVodComparePage3Element(data: VodComparePage3Data): ReactElement {
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
