/**
 * search-flowテンプレート 3枚目: 推しサーチへの導線。
 * Instagramの投稿画像からは直接サイトへ遷移できないため、「ここをタップ」のような
 * 画像内リンクがあるように見える表現は使わず、プロフィールのリンクへ案内する文言のみにしている。
 */
import type { ReactElement } from 'react';
import { BACKGROUNDS, CANVAS, COLORS, FONT_FAMILY, PAGE3 } from './theme';
import { BrandLogo, Decorations, MarkedText, SearchIcon } from './shared';

export interface SearchFlowPage3Data {
  personName: string;
}

export function buildSearchFlowPage3Element(_data: SearchFlowPage3Data): ReactElement {
  const box = PAGE3.searchBox;
  return (
    <div
      style={{
        position: 'relative',
        width: CANVAS.width,
        height: CANVAS.height,
        backgroundImage: BACKGROUNDS.page3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT_FAMILY,
      }}
    >
      <Decorations circles={[...PAGE3.decorations]} />
      <BrandLogo fontSize={PAGE3.brand.fontSize} iconSize={PAGE3.brand.iconSize} />

      <div style={{ position: 'relative', marginTop: PAGE3.copy.marginTop, display: 'flex' }}>
        <MarkedText text={PAGE3.copy.text} fontSize={PAGE3.copy.fontSize} markerColor={COLORS.white} />
      </div>

      {/* 検索窓風UI（プレースホルダー表示） */}
      <div
        style={{
          position: 'relative',
          marginTop: box.marginTop,
          width: box.width,
          height: box.height,
          borderRadius: 999,
          border: `${box.borderWidth}px solid ${COLORS.accent}`,
          background: COLORS.white,
          boxShadow: box.boxShadow,
          padding: `0 ${box.paddingX}px`,
          display: 'flex',
          alignItems: 'center',
          gap: box.gap,
        }}
      >
        <div
          style={{
            width: box.iconCircleSize,
            height: box.iconCircleSize,
            borderRadius: '50%',
            background: COLORS.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <SearchIcon size={box.iconSize} color={COLORS.white} strokeWidth={3} />
        </div>
        <div style={{ width: 4, height: box.cursorHeight, borderRadius: 2, background: COLORS.accent, display: 'flex' }} />
        <span style={{ fontSize: box.fontSize, fontWeight: 700, color: COLORS.placeholder, display: 'flex' }}>
          {box.placeholder}
        </span>
      </div>

      <div
        style={{
          position: 'relative',
          marginTop: PAGE3.sub.marginTop,
          fontSize: PAGE3.sub.fontSize,
          fontWeight: 700,
          color: COLORS.textDark,
          display: 'flex',
        }}
      >
        {PAGE3.sub.text}
      </div>

      <div
        style={{
          position: 'relative',
          marginTop: PAGE3.cta.marginTop,
          width: PAGE3.cta.width,
          padding: `${PAGE3.cta.paddingY}px 0`,
          borderRadius: PAGE3.cta.borderRadius,
          border: `${PAGE3.cta.borderWidth}px solid ${COLORS.accent}`,
          background: COLORS.white,
          fontSize: PAGE3.cta.fontSize,
          fontWeight: 700,
          color: COLORS.accentDark,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {PAGE3.cta.text}
      </div>
    </div>
  );
}
