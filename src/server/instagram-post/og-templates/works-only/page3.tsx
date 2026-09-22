/**
 * works-onlyテンプレート 3枚目: CTA専用ページ。人物写真は使用しない。
 * 検索窓風UI＋簡易作品チップで「推しサーチで検索できる」ことを視覚的に伝える。
 */
import type { ReactElement } from 'react';
import { CANVAS, COLORS, FONT_FAMILY, PAGE3 } from './theme';
import { BrandLabel, Decorations } from './shared';

export interface WorksOnlyPage3Data {
  personName: string;
}

export function buildWorksOnlyPage3Element(data: WorksOnlyPage3Data): ReactElement {
  const [titleLine1, titleLine2] = PAGE3.buildTitleLines(data.personName);
  const { artCard } = PAGE3;
  const chipWidth = (artCard.width - 4 * 24) / 3;

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

      {/* 検索窓風UI＋簡易作品チップの装飾エリア（実在サービスのロゴ等は使用しない） */}
      <div
        style={{
          position: 'relative',
          marginTop: artCard.marginTop,
          width: artCard.width,
          height: artCard.height,
          borderRadius: artCard.borderRadius,
          border: `${artCard.borderWidth}px solid ${COLORS.artCardBorder}`,
          background: `linear-gradient(160deg, ${COLORS.artCardBackground} 0%, ${COLORS.white} 100%)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 40,
        }}
      >
        {/* 検索窓風UI（虫眼鏡アイコンは意味が伝わりにくかったため削除し、テキストのみのシンプルな
            検索バーにした。角丸のピル形状自体が「検索・入力欄」を連想させるため、
            アイコンがなくても意図は伝わる） */}
        <div
          style={{
            width: artCard.searchBarWidth,
            height: artCard.searchBarHeight,
            borderRadius: artCard.searchBarHeight / 2,
            background: COLORS.white,
            border: `2px solid ${COLORS.cardBorder}`,
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 32,
            paddingRight: 32,
            boxShadow: '0 8px 20px rgba(16,51,73,0.08)',
          }}
        >
          <span style={{ fontSize: 26, fontWeight: 700, color: COLORS.textDark, flex: 1, display: 'flex' }}>
            {data.personName} 出演作
          </span>
        </div>

        {/* 簡易作品チップ（3件、実在ロゴは使わない抽象表現。上部にハイライトバーを添えて
            単色の板ではなく「カードらしさ」を出している） */}
        <div style={{ marginTop: 36, display: 'flex', gap: 24 }}>
          {COLORS.artChipColors.map((color, i) => (
            <div
              key={i}
              style={{
                width: chipWidth,
                height: 120,
                borderRadius: 18,
                background: color,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                paddingTop: 16,
              }}
            >
              <div style={{ width: '60%', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.55)', display: 'flex' }} />
            </div>
          ))}
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
