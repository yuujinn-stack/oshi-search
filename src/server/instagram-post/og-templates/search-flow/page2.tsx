/**
 * search-flowテンプレート 2枚目: 検索結果（STEP 2 出演作品 → STEP 3 配信先）。
 * 「作品｜配信先」の2列表示にし、列見出しと各行の矢印で「作品ごとに配信先が分かる」流れを示す。
 * 作品は1〜3件に対応する（件数に応じてカードの高さを変える）。
 */
import type { ReactElement } from 'react';
import { BACKGROUNDS, CANVAS, COLORS, FONT_FAMILY, PAGE2 } from './theme';
import { ArrowLong, BrandPill, Decorations, StepPill, WorkThumb, fitFontSize, type SearchFlowWorkData } from './shared';

export type { SearchFlowWorkData };

export interface SearchFlowPage2Data {
  personName: string;
  /** 1〜3件 */
  works: SearchFlowWorkData[];
}

/** 横長画像（16:9等）は横長の枠、それ以外（ポスター・不明）は縦長の枠で表示する */
function thumbSize(work: SearchFlowWorkData, cardHeight: number): { width: number; height: number } {
  const { thumb } = PAGE2;
  const maxHeight = cardHeight - thumb.paddingY * 2;
  if (work.imageDataUri && work.imageAspect && work.imageAspect > 1.2) {
    const width = thumb.landscapeWidth;
    return { width, height: Math.min(maxHeight, Math.round(width / work.imageAspect)) };
  }
  return { width: Math.round(maxHeight * thumb.portraitAspect), height: maxHeight };
}

function ColumnHeader(): ReactElement {
  const { rows, header } = PAGE2;
  const label = (step: string, text: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <StepPill label={step} fontSize={header.pillFontSize} />
      <span style={{ fontSize: header.fontSize, fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>{text}</span>
    </div>
  );
  return (
    <div
      style={{
        width: rows.width,
        padding: `0 ${rows.paddingX}px`,
        marginBottom: header.marginBottom,
        display: 'flex',
        alignItems: 'center',
        gap: rows.arrowGap,
      }}
    >
      <div style={{ flex: 1, display: 'flex' }}>{label('STEP 2', '出演作品')}</div>
      <div style={{ width: rows.arrowSize, display: 'flex' }} />
      <div style={{ width: rows.vodColumnWidth, display: 'flex' }}>{label('STEP 3', '配信先')}</div>
    </div>
  );
}

function WorkRow({ work, height }: { work: SearchFlowWorkData; height: number }): ReactElement {
  const { rows, thumb, title, vod } = PAGE2;
  const size = thumbSize(work, height);
  const vodNames = work.vod.split('/').map((s) => s.trim()).filter(Boolean);
  const badgeTextWidth = rows.vodColumnWidth - vod.paddingX * 2;
  return (
    <div
      style={{
        width: rows.width,
        height,
        display: 'flex',
        alignItems: 'center',
        gap: rows.arrowGap,
        background: COLORS.white,
        border: `${rows.borderWidth}px solid ${COLORS.cardBorder}`,
        borderRadius: rows.borderRadius,
        padding: `0 ${rows.paddingX}px`,
        boxShadow: rows.boxShadow,
      }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: thumb.gap, overflow: 'hidden' }}>
        <WorkThumb
          work={work}
          width={size.width}
          height={size.height}
          borderRadius={thumb.borderRadius}
          fallbackFontSize={thumb.fallbackFontSize}
        />
        <div
          style={{
            flex: 1,
            fontSize: title.fontSize,
            fontWeight: 700,
            lineHeight: title.lineHeight,
            color: COLORS.textDark,
            // 英単語の途中では改行しない（日本語は通常どおり文字単位で折り返す）
            wordBreak: 'break-word',
            display: 'block',
            lineClamp: 2,
          }}
        >
          {work.title}
        </div>
      </div>
      <div style={{ width: rows.arrowSize, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        <ArrowLong size={rows.arrowSize} color={COLORS.accent} />
      </div>
      <div style={{ width: rows.vodColumnWidth, display: 'flex', flexDirection: 'column', gap: vod.gap, flexShrink: 0 }}>
        {vodNames.map((name) => (
          <div
            key={name}
            style={{
              fontSize: fitFontSize(name, badgeTextWidth, vod.maxFontSize, vod.minFontSize),
              fontWeight: 700,
              color: COLORS.white,
              background: COLORS.accentDark,
              borderRadius: 999,
              padding: `${vod.paddingY}px ${vod.paddingX}px`,
              whiteSpace: 'nowrap',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}

export function buildSearchFlowPage2Element(data: SearchFlowPage2Data): ReactElement {
  const works = data.works.slice(0, 3);
  const cardHeight = PAGE2.rows.heightByCount[works.length] ?? PAGE2.rows.heightByCount[3];
  return (
    <div
      style={{
        position: 'relative',
        width: CANVAS.width,
        height: CANVAS.height,
        backgroundImage: BACKGROUNDS.page2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: FONT_FAMILY,
      }}
    >
      <Decorations circles={[...PAGE2.decorations]} />
      <BrandPill
        fontSize={PAGE2.brand.fontSize}
        iconSize={PAGE2.brand.iconSize}
        paddingY={PAGE2.brand.paddingY}
        paddingX={PAGE2.brand.paddingX}
        marginTop={PAGE2.brand.marginTop}
      />

      {/* 作品数（1〜3件）が変わっても上下の余白が偏らないよう、本文ブロックを縦方向中央に配置する */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          paddingBottom: PAGE2.body.paddingBottom,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ColumnHeader />
        <div style={{ display: 'flex', flexDirection: 'column', gap: PAGE2.rows.gap }}>
          {works.map((w, i) => (
            <WorkRow key={`${i}-${w.title}`} work={w} height={cardHeight} />
          ))}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: PAGE2.note.bottom,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          fontSize: PAGE2.note.fontSize,
          color: COLORS.textMuted,
        }}
      >
        {PAGE2.note.text}
      </div>
    </div>
  );
}
