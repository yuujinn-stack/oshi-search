/**
 * Instagram投稿3枚目: 人物ページへのCTA。
 *
 * 実際のWebページのスクリーンショットではなく、人物名・「推しサーチ」ロゴ（ワードマーク）・
 * 人物ページへのCTAで構成する専用テンプレート。デザイン値は ./theme.ts の PAGE3 / COLORS を参照。
 */
import type { ReactElement } from 'react';
import { CANVAS, COLORS, FONT_FAMILY, PAGE3 } from './theme';
import { BrandLabel, Decorations } from './shared';

export interface Page3Data {
  personName: string;
  personImageDataUri: string;
}

export function buildPage3Element(data: Page3Data): ReactElement {
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

      {/* スクリーンショットの代わりに、人物写真＋ブランドの帯を重ねたカードを表示する */}
      <div
        style={{
          position: 'relative',
          marginTop: PAGE3.photoFrame.marginTop,
          width: PAGE3.photoFrame.width,
          height: PAGE3.photoFrame.height,
          borderRadius: PAGE3.photoFrame.borderRadius,
          overflow: 'hidden',
          border: `${PAGE3.photoFrame.borderWidth}px solid ${COLORS.photoFrameBorder}`,
          background: COLORS.photoFrameBackground,
          display: 'flex',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.personImageDataUri}
          width={PAGE3.photoFrame.width}
          height={PAGE3.photoFrame.height}
          style={{ objectFit: 'cover', objectPosition: PAGE3.photoFrame.objectPosition }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: PAGE3.overlay.gap,
            padding: `${PAGE3.overlay.paddingY}px 0`,
            background: COLORS.overlayBackground,
          }}
        >
          <span style={{ fontSize: PAGE3.overlay.brandFontSize, fontWeight: 700, color: COLORS.white, display: 'flex' }}>
            推しサーチ
          </span>
          <span style={{ fontSize: PAGE3.overlay.nameFontSize, fontWeight: 700, color: COLORS.overlayNameColor, display: 'flex' }}>
            {data.personName}
          </span>
        </div>
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
