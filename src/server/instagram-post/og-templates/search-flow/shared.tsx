/**
 * search-flowテンプレート専用の共通部品。デザイン値は ./theme.ts を参照する。
 * pickDefined() は完全に汎用のため default-person側の shared.tsx から流用する。
 *
 * 絵文字はSatoriで別途フォントが必要になるため使わず、虫眼鏡・矢印はSVGで描画する。
 */
import type { ReactElement } from 'react';
import { pickDefined } from '../shared';
import { BRAND, COLORS, FONT_FAMILY } from './theme';
import type { DecorCircleConfig } from './theme';

export interface SearchFlowWorkData {
  title: string;
  /** buildVodDisplayString()の結果（例: "Netflix / U-NEXT"）。空文字の作品は呼び出し側で除外済み */
  vod: string;
  /** 取得失敗時はnull（タイトル頭文字のフォールバックカードとして描画する） */
  imageDataUri: string | null;
  /** 画像の幅/高さ比（黒帯除去後）。不明ならnull（縦長ポスターとして扱う） */
  imageAspect: number | null;
}

/** 背景に重ねる白い光の円（色付き背景に奥行きを出す） */
export function Decorations({ circles }: { circles: DecorCircleConfig[] }): ReactElement {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      {circles.map((c, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: c.size,
            height: c.size,
            ...pickDefined({ top: c.top, bottom: c.bottom, left: c.left, right: c.right }),
            borderRadius: '50%',
            filter: 'blur(40px)',
            background: `radial-gradient(circle, rgba(${COLORS.glowRgb},${c.opacity}) 0%, rgba(${COLORS.glowRgb},0) 70%)`,
            display: 'flex',
          }}
        />
      ))}
    </div>
  );
}

export function SearchIcon({ size, color, strokeWidth = 2.6 }: { size: number; color: string; strokeWidth?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="10.5" cy="10.5" r="6.5" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="15.4" y1="15.4" x2="20.5" y2="20.5" stroke={color} strokeWidth={strokeWidth + 0.4} strokeLinecap="round" />
    </svg>
  );
}

export function ArrowRight({ size, color, strokeWidth = 3 }: { size: number; color: string; strokeWidth?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <polyline points="9,5 16,12 9,19" stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 横向きの矢印（線＋矢じり）。2枚目の「作品 → 配信先」をつなぐ */
export function ArrowLong({ size, color }: { size: number; color: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <line x1="3" y1="12" x2="19" y2="12" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <polyline points="13,6 20,12 13,18" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 虫眼鏡アイコン＋「推しサーチ」のロゴ（ワードマーク）。全ページで同じ見た目にする */
export function BrandLogo({ fontSize, iconSize }: { fontSize: number; iconSize: number }): ReactElement {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: Math.round(fontSize * 0.25) }}>
      <SearchIcon size={iconSize} color={COLORS.accent} strokeWidth={3} />
      <span
        style={{
          fontSize,
          fontWeight: 700,
          letterSpacing: BRAND.letterSpacing,
          color: COLORS.accentDark,
          fontFamily: FONT_FAMILY,
          display: 'flex',
        }}
      >
        {BRAND.label}
      </span>
    </div>
  );
}

/** 白いピル型の上にロゴを置いたもの（色付き背景の上でもロゴがはっきり読めるようにする） */
export function BrandPill({
  fontSize,
  iconSize,
  paddingY,
  paddingX,
  marginTop,
}: {
  fontSize: number;
  iconSize: number;
  paddingY: number;
  paddingX: number;
  marginTop: number;
}): ReactElement {
  return (
    <div
      style={{
        position: 'relative',
        marginTop,
        padding: `${paddingY}px ${paddingX}px`,
        borderRadius: 999,
        background: COLORS.white,
        boxShadow: '0 8px 20px rgba(16,51,73,0.10)',
        display: 'flex',
      }}
    >
      <BrandLogo fontSize={fontSize} iconSize={iconSize} />
    </div>
  );
}

/** 「STEP 1」等の小さなラベル */
export function StepPill({ label, fontSize }: { label: string; fontSize: number }): ReactElement {
  return (
    <div
      style={{
        fontSize,
        fontWeight: 700,
        color: COLORS.white,
        background: COLORS.accentDark,
        borderRadius: 999,
        padding: `${Math.round(fontSize * 0.2)}px ${Math.round(fontSize * 0.7)}px`,
        letterSpacing: 1,
        display: 'flex',
        flexShrink: 0,
      }}
    >
      {label}
    </div>
  );
}

/** キーワードの下半分にマーカー線を引いたテキスト（背景色に応じてマーカー色を指定する） */
export function MarkedText({
  text,
  fontSize,
  markerColor,
  color = COLORS.textDark,
}: {
  text: string;
  fontSize: number;
  markerColor: string;
  color?: string;
}): ReactElement {
  return (
    <span
      style={{
        fontSize,
        fontWeight: 700,
        color,
        backgroundImage: `linear-gradient(transparent 62%, ${markerColor} 62%)`,
        padding: `0 ${Math.round(fontSize * 0.12)}px`,
        display: 'flex',
      }}
    >
      {text}
    </span>
  );
}

/**
 * 作品画像。画像が無い（取得失敗含む）場合は、淡い水色のグラデーション＋タイトル頭文字のカードで代用する。
 * 画像の比率に関わらず、指定した枠（width×height）に object-fit: cover で収める。
 */
export function WorkThumb({
  work,
  width,
  height,
  borderRadius,
  fallbackFontSize,
}: {
  work: SearchFlowWorkData;
  width: number;
  height: number;
  borderRadius: number;
  fallbackFontSize: number;
}): ReactElement {
  if (work.imageDataUri) {
    return (
      <div style={{ width, height, borderRadius, overflow: 'hidden', display: 'flex', flexShrink: 0, background: COLORS.accentSoft }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={work.imageDataUri} width={width} height={height} style={{ objectFit: 'cover' }} />
      </div>
    );
  }
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        border: `1.5px solid ${COLORS.cardBorder}`,
        background: `linear-gradient(160deg, ${COLORS.fallbackFrom} 0%, ${COLORS.fallbackTo} 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: fallbackFontSize, fontWeight: 700, color: COLORS.accentDark, display: 'flex' }}>
        {fallbackInitial(work.title)}
      </span>
    </div>
  );
}

/**
 * テキストの表示幅の目安（全角=1、半角=0.58）。Satoriは1行に収まらない文字を自動縮小しないため、
 * 人物名・配信サービス名のように長さが事前に分からない文字列はこの目安で文字サイズを決める。
 */
export function estimateTextUnits(text: string): number {
  let units = 0;
  for (const ch of Array.from(text)) {
    units += ch.charCodeAt(0) < 0x80 ? 0.58 : 1;
  }
  return units;
}

/** availableWidthに1行で収まる文字サイズ（maxFontSize〜minFontSizeの範囲）を返す */
export function fitFontSize(text: string, availableWidth: number, maxFontSize: number, minFontSize: number): number {
  const units = Math.max(estimateTextUnits(text), 1);
  return Math.max(minFontSize, Math.min(maxFontSize, Math.floor(availableWidth / units)));
}

/**
 * 作品画像が取得できない場合のフォールバックに表示する1文字
 * （タイトル先頭の記号・括弧を飛ばした最初の文字）。
 */
export function fallbackInitial(title: string): string {
  const ch = Array.from(title).find((c) => /[\p{L}\p{N}]/u.test(c));
  return ch ?? '';
}
