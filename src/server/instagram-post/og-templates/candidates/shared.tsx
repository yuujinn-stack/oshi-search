/**
 * Preview専用テンプレート候補（5種類）共通の部品。デザイン値は ./theme.ts を参照する。
 * pickDefined() は完全に汎用のため default-person側の shared.tsx から流用する。
 * 絵文字はSatoriで別途フォントが必要になるため使わず、アイコン・矢印はSVGで描画する。
 */
import type { ReactElement, ReactNode } from 'react';
import { pickDefined } from '../shared';
import { BRAND, CANVAS, COLORS, COMMON_TEXT, FONT_FAMILY, GLOW_TOP_LEFT_BOTTOM_RIGHT } from './theme';
import type { DecorCircleConfig } from './theme';

/** 作品画像（取得済み）。画像が無い・取得失敗時は dataUri=null でフォールバック表示にする */
export interface CandidateImage {
  title: string;
  dataUri: string | null;
  /** 幅/高さ比（黒帯除去後）。不明ならnull */
  aspect: number | null;
}

export type Tone = 'light' | 'navy';

function Glow({ circles }: { circles: DecorCircleConfig[] }): ReactElement {
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

/**
 * 1080×1080のページ枠。brand=true のときは上部に「推しサーチ」ロゴを置き、
 * 本文（children）はロゴより下の残りの領域で縦方向中央に配置する（本文が長くてもロゴと重ならない）。
 * スワイプ表示・注記など位置を固定したい要素は overlay に渡す（ページ全体を基準に絶対配置）。
 */
export function Page({
  background,
  tone = 'light',
  brand = false,
  overlay,
  children,
  bodyPaddingBottom = 50,
}: {
  background: string;
  tone?: Tone;
  brand?: boolean;
  overlay?: ReactNode;
  children: ReactNode;
  bodyPaddingBottom?: number;
}): ReactElement {
  return (
    <div
      style={{
        position: 'relative',
        width: CANVAS.width,
        height: CANVAS.height,
        backgroundImage: background,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: FONT_FAMILY,
      }}
    >
      <Glow circles={tone === 'navy' ? [{ size: 520, right: -200, top: -200, opacity: 0.12 }] : GLOW_TOP_LEFT_BOTTOM_RIGHT} />
      {brand && (
        <div style={{ position: 'relative', marginTop: 40, display: 'flex', flexShrink: 0 }}>
          <BrandPill />
        </div>
      )}
      <div
        style={{
          position: 'relative',
          flex: 1,
          width: '100%',
          paddingBottom: bodyPaddingBottom,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
      {overlay}
    </div>
  );
}

export function SearchIcon({ size, color, strokeWidth = 3 }: { size: number; color: string; strokeWidth?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="10.5" cy="10.5" r="6.5" stroke={color} strokeWidth={strokeWidth} fill="none" />
      <line x1="15.4" y1="15.4" x2="20.5" y2="20.5" stroke={color} strokeWidth={strokeWidth + 0.4} strokeLinecap="round" />
    </svg>
  );
}

export function ArrowDown({ size, color }: { size: number; color: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <line x1="12" y1="3" x2="12" y2="19" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <polyline points="5,13 12,20 19,13" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowRight({ size, color }: { size: number; color: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <polyline points="9,5 16,12 9,19" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 虫眼鏡＋「推しサーチ」のロゴ。濃紺背景では白文字にする */
export function BrandLogo({ fontSize, tone = 'light' }: { fontSize: number; tone?: Tone }): ReactElement {
  const color = tone === 'navy' ? COLORS.white : COLORS.accentDark;
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: Math.round(fontSize * 0.25) }}>
      <SearchIcon size={Math.round(fontSize * 1.05)} color={tone === 'navy' ? COLORS.accent : COLORS.accent} />
      <span style={{ fontSize, fontWeight: 700, letterSpacing: BRAND.letterSpacing, color, display: 'flex' }}>{BRAND.label}</span>
    </div>
  );
}

/** 白いピル型の上に置いたロゴ（1・2枚目の上部で「推しサーチ」を認識させる） */
export function BrandPill({ fontSize = 34, marginTop = 0 }: { fontSize?: number; marginTop?: number }): ReactElement {
  return (
    <div
      style={{
        position: 'relative',
        marginTop,
        padding: `${Math.round(fontSize * 0.3)}px ${Math.round(fontSize * 0.75)}px`,
        borderRadius: 999,
        background: COLORS.white,
        boxShadow: '0 8px 20px rgba(16,51,73,0.12)',
        display: 'flex',
      }}
    >
      <BrandLogo fontSize={fontSize} />
    </div>
  );
}

/**
 * CTA。Instagramの投稿画像はタップしてもサイトへ遷移しないため、
 * 押せるボタンに見えないよう影を付けず、帯＋枠線の「案内表示」にしている。
 */
export function CtaBand({ tone = 'light', marginTop = 0, width = 800 }: { tone?: Tone; marginTop?: number; width?: number }): ReactElement {
  return (
    <div
      style={{
        position: 'relative',
        marginTop,
        width,
        padding: '26px 0',
        borderRadius: 999,
        border: `3px solid ${COLORS.accent}`,
        background: tone === 'navy' ? 'rgba(255,255,255,0.08)' : COLORS.white,
        color: tone === 'navy' ? COLORS.white : COLORS.accentDark,
        fontSize: 36,
        fontWeight: 700,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      {COMMON_TEXT.cta}
    </div>
  );
}

/** ページ下部の小さな注記（配信情報の確認時点など） */
export function BottomNote({ text = COMMON_TEXT.vodNote, tone = 'light', bottom = 30 }: { text?: string; tone?: Tone; bottom?: number }): ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        bottom,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        fontSize: 24,
        color: tone === 'navy' ? COLORS.textOnNavyMuted : COLORS.textMuted,
      }}
    >
      {text}
    </div>
  );
}

/** 右下の「スワイプ ›」 */
export function SwipeHint({ tone = 'light' }: { tone?: Tone }): ReactElement {
  const color = tone === 'navy' ? COLORS.textOnNavyMuted : COLORS.accentDark;
  return (
    <div style={{ position: 'absolute', bottom: 40, right: 52, display: 'flex', alignItems: 'center', gap: 4, fontSize: 26, fontWeight: 700, color }}>
      {COMMON_TEXT.swipe}
      <ArrowRight size={30} color={color} />
    </div>
  );
}

/** キーワードの下半分にマーカー線を引いたテキスト */
export function MarkedText({ text, fontSize, markerColor, color = COLORS.textDark }: { text: string; fontSize: number; markerColor: string; color?: string }): ReactElement {
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

/** 作品画像（無い場合は淡い水色＋タイトル頭文字のカード）。指定した枠に cover で収める */
export function WorkThumb({ image, width, height, borderRadius = 14, fallbackFontSize = 52 }: { image: CandidateImage; width: number; height: number; borderRadius?: number; fallbackFontSize?: number }): ReactElement {
  if (image.dataUri) {
    return (
      <div style={{ width, height, borderRadius, overflow: 'hidden', display: 'flex', flexShrink: 0, background: COLORS.accentSoft }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.dataUri} width={width} height={height} style={{ objectFit: 'cover' }} />
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
      <span style={{ fontSize: fallbackFontSize, fontWeight: 700, color: COLORS.accentDark, display: 'flex' }}>{fallbackInitial(image.title)}</span>
    </div>
  );
}

/** 横長画像は横長の枠、それ以外（ポスター・不明・画像なし）は縦長の枠のサイズを返す */
export function thumbSize(image: CandidateImage, maxHeight: number, landscapeWidth: number): { width: number; height: number } {
  if (image.dataUri && image.aspect && image.aspect > 1.2) {
    return { width: landscapeWidth, height: Math.min(maxHeight, Math.round(landscapeWidth / image.aspect)) };
  }
  return { width: Math.round(maxHeight * 0.72), height: maxHeight };
}

/** テキストの表示幅の目安（全角=1、半角=0.58） */
export function estimateTextUnits(text: string): number {
  let units = 0;
  for (const ch of Array.from(text)) units += ch.charCodeAt(0) < 0x80 ? 0.58 : 1;
  return units;
}

/** availableWidthに1行で収まる文字サイズ（maxFontSize〜minFontSizeの範囲）を返す */
export function fitFontSize(text: string, availableWidth: number, maxFontSize: number, minFontSize: number): number {
  const units = Math.max(estimateTextUnits(text), 1);
  return Math.max(minFontSize, Math.min(maxFontSize, Math.floor(availableWidth / units)));
}

/** 複数行のうち最も長い行が収まる文字サイズ */
export function fitLines(lines: string[], availableWidth: number, maxFontSize: number, minFontSize: number): number {
  return Math.min(...lines.map((l) => fitFontSize(l, availableWidth, maxFontSize, minFontSize)));
}

/** フォールバックに表示する1文字（タイトル先頭の記号・括弧を飛ばした最初の文字） */
export function fallbackInitial(title: string): string {
  return Array.from(title).find((c) => /[\p{L}\p{N}]/u.test(c)) ?? '';
}
