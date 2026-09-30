/**
 * search-flowテンプレート 1枚目: 検索窓に人物名が入力された状態（STEP 1）＋検索結果の予告サムネ。
 * スクロール中でも「名前で検索すると出演作・配信先が分かるサイト」だと一目で伝えることが目的。
 * 人物写真は使用しない（作品サムネは画像が無い場合もフォールバックカードで成立する）。
 */
import type { ReactElement } from 'react';
import { BACKGROUNDS, CANVAS, COLORS, FONT_FAMILY, PAGE1 } from './theme';
import {
  ArrowRight,
  BrandPill,
  Decorations,
  MarkedText,
  SearchIcon,
  StepPill,
  WorkThumb,
  fitFontSize,
  type SearchFlowWorkData,
} from './shared';

export interface SearchFlowPage1Data {
  personName: string;
  /** 検索窓の下に並べる作品（1〜3件） */
  works: SearchFlowWorkData[];
}

export function buildSearchFlowPage1Element(data: SearchFlowPage1Data): ReactElement {
  const [titleLine1, titleLine2] = PAGE1.buildTitleLines(data.personName);
  const titleWidth = CANVAS.width - PAGE1.title.paddingX * 2;
  const titleFontSize = fitFontSize(titleLine1, titleWidth, PAGE1.title.maxFontSize, PAGE1.title.minFontSize);

  const box = PAGE1.searchBox;
  // 検索窓の内側で人物名に使える幅（アイコン・カーソル・検索ボタン・余白を除いた幅）
  const nameMaxWidth =
    box.width - box.borderWidth * 2 - box.paddingX * 2 - box.iconCircleSize - box.buttonWidth - box.gap * 3 - 8;
  const nameFontSize = fitFontSize(data.personName, nameMaxWidth, box.maxFontSize, box.minFontSize);

  const thumbs = PAGE1.thumbs;
  const works = data.works.slice(0, 3);

  return (
    <div
      style={{
        position: 'relative',
        width: CANVAS.width,
        height: CANVAS.height,
        backgroundImage: BACKGROUNDS.page1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: FONT_FAMILY,
      }}
    >
      <Decorations circles={[...PAGE1.decorations]} />
      <BrandPill
        fontSize={PAGE1.brand.fontSize}
        iconSize={PAGE1.brand.iconSize}
        paddingY={PAGE1.brand.paddingY}
        paddingX={PAGE1.brand.paddingX}
        marginTop={PAGE1.brand.marginTop}
      />

      {/* ロゴ以外の本文ブロックは、残りの高さの中で縦方向中央に配置する（人物名の長さで行数が変わっても偏らない） */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          paddingBottom: PAGE1.body.paddingBottom,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            position: 'relative',
            padding: `0 ${PAGE1.title.paddingX}px`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            lineHeight: PAGE1.title.lineHeight,
          }}
        >
          <div
            style={{
              fontSize: titleFontSize,
              fontWeight: 700,
              color: COLORS.textDark,
              textAlign: 'center',
              display: 'block',
              lineClamp: 2,
            }}
          >
            {titleLine1}
          </div>
          <MarkedText text={titleLine2} fontSize={titleFontSize} markerColor={COLORS.white} />
        </div>

        <div style={{ position: 'relative', marginTop: PAGE1.step.marginTop, display: 'flex', alignItems: 'center', gap: 14 }}>
          <StepPill label={PAGE1.step.label} fontSize={PAGE1.step.fontSize} />
          <span style={{ fontSize: PAGE1.step.fontSize, fontWeight: 700, color: COLORS.accentDark, display: 'flex' }}>
            {PAGE1.step.text}
          </span>
        </div>

        {/* 検索窓（実際の人物名が入力された状態） */}
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
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
            <div
              style={{
                maxWidth: nameMaxWidth,
                fontSize: nameFontSize,
                fontWeight: 700,
                color: COLORS.textDark,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'block',
              }}
            >
              {data.personName}
            </div>
            <div style={{ width: 5, height: box.cursorHeight, borderRadius: 3, background: COLORS.accent, display: 'flex', flexShrink: 0 }} />
          </div>
          <div
            style={{
              width: box.buttonWidth,
              height: box.buttonHeight,
              borderRadius: 999,
              background: COLORS.accentDark,
              color: COLORS.white,
              fontSize: box.buttonFontSize,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {box.buttonText}
          </div>
        </div>

        {/* 検索結果の予告として作品サムネを並べる（少し傾けて、中央だけ持ち上げる） */}
        <div style={{ position: 'relative', marginTop: thumbs.marginTop, display: 'flex', alignItems: 'flex-end', gap: thumbs.gap }}>
          {works.map((w, i) => {
            const rotation = works.length === 3 ? thumbs.rotations[i] : 0;
            const isCenter = works.length === 3 && i === 1;
            return (
              <div
                key={`${i}-${w.title}`}
                style={{
                  display: 'flex',
                  padding: thumbs.borderWidth,
                  borderRadius: thumbs.borderRadius + thumbs.borderWidth,
                  background: COLORS.white,
                  boxShadow: thumbs.boxShadow,
                  transform: `rotate(${rotation}deg)`,
                  marginBottom: isCenter ? thumbs.centerLift : 0,
                }}
              >
                <WorkThumb
                  work={w}
                  width={thumbs.width}
                  height={thumbs.height}
                  borderRadius={thumbs.borderRadius}
                  fallbackFontSize={thumbs.fallbackFontSize}
                />
              </div>
            );
          })}
        </div>

        <div
          style={{
            position: 'relative',
            marginTop: PAGE1.lead.marginTop,
            fontSize: PAGE1.lead.fontSize,
            fontWeight: 700,
            color: COLORS.textDark,
            display: 'flex',
          }}
        >
          {PAGE1.lead.text}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: PAGE1.swipe.bottom,
          right: PAGE1.swipe.right,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: PAGE1.swipe.fontSize,
          fontWeight: 700,
          color: COLORS.accentDark,
        }}
      >
        {PAGE1.swipe.text}
        <ArrowRight size={30} color={COLORS.accentDark} />
      </div>
    </div>
  );
}
