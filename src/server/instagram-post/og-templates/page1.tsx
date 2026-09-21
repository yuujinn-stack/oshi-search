/**
 * Instagram投稿1枚目: 人物写真＋タイトル。
 * デザイン値は ./theme.ts の PAGE1 / COLORS を参照。レイアウト構造を変えたい場合はここを編集する。
 */
import type { ReactElement } from 'react';
import { CANVAS, COLORS, FONT_FAMILY, PAGE1 } from './theme';
import { BrandLabel, Decorations } from './shared';

export interface Page1Data {
  personName: string;
  personImageDataUri: string;
}

export function buildPage1Element(data: Page1Data): ReactElement {
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
      <div
        style={{
          position: 'relative',
          marginTop: PAGE1.photo.marginTop,
          width: PAGE1.photo.width,
          height: PAGE1.photo.height,
          borderRadius: PAGE1.photo.borderRadius,
          overflow: 'hidden',
          border: `${PAGE1.photo.borderWidth}px solid ${COLORS.photoFrameBorder}`,
          background: COLORS.photoFrameBackground,
          display: 'flex',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.personImageDataUri}
          width={PAGE1.photo.width}
          height={PAGE1.photo.height}
          style={{ objectFit: 'cover', objectPosition: PAGE1.photo.objectPosition }}
        />
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
