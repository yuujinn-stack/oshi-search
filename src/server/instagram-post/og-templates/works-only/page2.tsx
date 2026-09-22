/**
 * works-onlyテンプレート 2枚目: 出演作品・配信サービス一覧。
 * default-person版（../page2.tsx）とレイアウト・カードデザインはほぼ同一だが、
 * キャンバスサイズ（1080×1080）に合わせて余白を調整した独立実装。
 */
import type { ReactElement } from 'react';
import { CANVAS, COLORS, FONT_FAMILY, PAGE2 } from './theme';
import { BrandLabel, Decorations } from './shared';

export interface WorksOnlyWorkData {
  title: string;
  vod: string;
  /** 取得失敗時はnull（画像なしのフォールバックカードとして描画する） */
  imageDataUri: string | null;
}

export interface WorksOnlyPage2Data {
  personName: string;
  works: [WorksOnlyWorkData, WorksOnlyWorkData, WorksOnlyWorkData];
}

function WorkCard({ work }: { work: WorksOnlyWorkData }): ReactElement {
  const { card } = PAGE2;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: card.gap,
        background: COLORS.white,
        border: `${card.borderWidth}px solid ${COLORS.cardBorder}`,
        borderRadius: card.borderRadius,
        padding: `${card.paddingY}px ${card.paddingX}px`,
        height: card.height,
        boxShadow: card.boxShadow,
      }}
    >
      <div
        style={{
          width: card.image.width,
          height: card.image.height,
          borderRadius: card.image.borderRadius,
          overflow: 'hidden',
          background: COLORS.accentSoft,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {work.imageDataUri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={work.imageDataUri}
            width={card.image.width}
            height={card.image.height}
            style={{ objectFit: 'cover' }}
          />
        ) : (
          // 作品画像が取得できなかった場合のシンプルなプレースホルダー（テキストなし、人物写真は使用しない）
          <div
            style={{
              width: Math.round(Math.min(card.image.width, card.image.height) * 0.4),
              height: Math.round(Math.min(card.image.width, card.image.height) * 0.4),
              borderRadius: '50%',
              background: COLORS.cardBorder,
              display: 'flex',
            }}
          />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, flex: 1 }}>
        <div
          style={{
            fontSize: card.titleFontSize,
            fontWeight: 700,
            lineHeight: card.titleLineHeight,
            color: COLORS.textDark,
            display: 'block',
            lineClamp: 2,
          }}
        >
          {work.title}
        </div>
        <div
          style={{
            alignSelf: 'flex-start',
            fontSize: card.vodFontSize,
            fontWeight: 700,
            color: COLORS.accentDark,
            background: COLORS.accentSoft,
            borderRadius: 999,
            padding: `${card.vodPaddingY}px ${card.vodPaddingX}px`,
            display: 'flex',
          }}
        >
          {work.vod}
        </div>
      </div>
    </div>
  );
}

export function buildWorksOnlyPage2Element(data: WorksOnlyPage2Data): ReactElement {
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
      <Decorations circles={[...PAGE2.decorations.circles]} dots={[...PAGE2.decorations.dots]} />
      <BrandLabel marginTop={PAGE2.brandLabelMarginTop} />
      <div
        style={{
          marginTop: PAGE2.title.marginTop,
          textAlign: 'center',
          fontSize: PAGE2.title.fontSize,
          fontWeight: 700,
          color: COLORS.textDark,
          display: 'flex',
        }}
      >
        {PAGE2.buildTitle(data.personName)}
      </div>
      <div
        style={{
          position: 'relative',
          marginTop: PAGE2.panel.marginTop,
          width: PAGE2.panel.width,
          background: COLORS.panelBackground,
          border: `${PAGE2.panel.borderWidth}px solid ${COLORS.panelBorder}`,
          borderRadius: PAGE2.panel.borderRadius,
          padding: `${PAGE2.panel.paddingY}px ${PAGE2.panel.paddingX}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: PAGE2.panel.gap,
          boxShadow: PAGE2.panel.boxShadow,
        }}
      >
        <WorkCard work={data.works[0]} />
        <WorkCard work={data.works[1]} />
        <WorkCard work={data.works[2]} />
      </div>
    </div>
  );
}
