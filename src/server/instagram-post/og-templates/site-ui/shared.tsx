/**
 * Preview専用テンプレート F〜I 共通の部品。推しサーチの公開サイト（人物ページ）の見た目を再現する。
 * 絵文字はSatoriで別途フォントが必要になるため使わず、アイコンはSVGで描画する。
 * 商品画像は使わない（SNSでの利用可否を確認できないため）。商品はカテゴリのSVGアイコン＋商品名で表す。
 */
import type { ReactElement, ReactNode } from 'react';
import { getVodServiceStyle } from '@/lib/vod-cta';
import { BRAND_LABEL, CANVAS, COLORS, COMMON_TEXT, DOT_BACKGROUND, FONT_FAMILY } from './theme';

export interface SiteUiImage {
  title: string;
  dataUri: string | null;
  aspect: number | null;
}

/** 1080×1080のページ。dark=true で黒背景（締めのページ用） */
export function Page({ dark = false, children, overlay }: { dark?: boolean; children: ReactNode; overlay?: ReactNode }): ReactElement {
  return (
    <div
      style={{
        position: 'relative',
        width: CANVAS.width,
        height: CANVAS.height,
        ...(dark ? { backgroundColor: COLORS.ink } : DOT_BACKGROUND),
        display: 'flex',
        flexDirection: 'column',
        fontFamily: FONT_FAMILY,
        color: dark ? COLORS.white : COLORS.text,
      }}
    >
      {children}
      {overlay}
    </div>
  );
}

/** サイトヘッダーと同じ「● 推しサーチ」ロゴ */
export function SiteLogo({ fontSize = 34, onDark = false }: { fontSize?: number; onDark?: boolean }): ReactElement {
  const dot = Math.round(fontSize * 0.42);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(fontSize * 0.3) }}>
      <div style={{ width: dot, height: dot, borderRadius: '50%', background: COLORS.accent, display: 'flex' }} />
      <span style={{ fontSize, fontWeight: 700, letterSpacing: 1, color: onDark ? COLORS.white : COLORS.ink, display: 'flex' }}>{BRAND_LABEL}</span>
    </div>
  );
}

/** ページ上部の細いヘッダー（サイトの site-header と同じく下に黒線） */
export function TopBar({ right }: { right?: ReactNode }): ReactElement {
  return (
    <div
      style={{
        width: '100%',
        height: 92,
        padding: '0 56px',
        borderBottom: `3px solid ${COLORS.ink}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}
    >
      <SiteLogo fontSize={32} />
      {right}
    </div>
  );
}

/** 「01 — WORKS」形式のラベル（サイトのセクション見出しと同じ表現） */
export function SectionLabel({ num, en, fontSize = 22, color = COLORS.accent }: { num: string; en: string; fontSize?: number; color?: string }): ReactElement {
  return (
    <span style={{ fontSize, fontWeight: 700, letterSpacing: 4, color, display: 'flex' }}>{`${num} — ${en}`}</span>
  );
}

/** サイトの統計ボックス（白地・黒枠）。例: 「配信中 55件」 */
export function StatBox({
  label,
  value,
  unit,
  width,
  height = 128,
  maxNumberSize = 64,
  labelSize = 24,
  icon,
}: {
  label: string;
  value: number;
  unit: string;
  width: number;
  height?: number;
  maxNumberSize?: number;
  labelSize?: number;
  /** ラベルの左に置く小さなアイコン（任意） */
  icon?: ReactNode;
}): ReactElement {
  const numberSize = Math.min(maxNumberSize, Math.floor((width - 40 - unit.length * 26) / (String(value).length * 0.62)));
  return (
    <div
      style={{
        width,
        height,
        background: COLORS.surface,
        border: `3px solid ${COLORS.ink}`,
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <span style={{ fontSize: labelSize, fontWeight: 700, color: COLORS.muted, display: 'flex' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: numberSize, fontWeight: 700, lineHeight: 1.05, color: COLORS.ink, display: 'flex' }}>{value}</span>
        <span style={{ fontSize: 26, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{unit}</span>
      </div>
    </div>
  );
}

/** 配信サービスのバッジ。色はサイトのVODボタンと同じ getVodServiceStyle を使う */
export function ServiceChip({ name, fontSize = 26 }: { name: string; fontSize?: number }): ReactElement {
  const style = getVodServiceStyle(name);
  // Satoriは値がundefinedのstyleキーで例外になるため、グラデーションか単色かで設定するキー自体を分ける
  const background = style.background.startsWith('linear-gradient')
    ? { backgroundImage: style.background }
    : { backgroundColor: style.background };
  return (
    <div
      style={{
        fontSize,
        fontWeight: 700,
        color: style.color,
        ...background,
        border: style.border ? `2px solid ${COLORS.border}` : `2px solid ${COLORS.ink}`,
        borderRadius: 2,
        padding: `${Math.round(fontSize * 0.25)}px ${Math.round(fontSize * 0.6)}px`,
        whiteSpace: 'nowrap',
        display: 'flex',
      }}
    >
      {name}
    </div>
  );
}

/** サイトヘッダーと同じ検索窓（白い入力欄＋黒い「検索」ボタン） */
export function SearchBar({ text, placeholder = false, width = 860, fontSize = 44 }: { text: string; placeholder?: boolean; width?: number; fontSize?: number }): ReactElement {
  const height = Math.round(fontSize * 2.3);
  return (
    <div style={{ width, height, display: 'flex', border: `3px solid ${COLORS.ink}`, borderRadius: 2, background: COLORS.surface }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '0 26px', overflow: 'hidden' }}>
        <span
          style={{
            fontSize,
            fontWeight: 700,
            color: placeholder ? '#A6A59E' : COLORS.ink,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'block',
          }}
        >
          {text}
        </span>
        {!placeholder && <div style={{ width: 4, height: Math.round(fontSize * 1.1), background: COLORS.accent, display: 'flex', flexShrink: 0 }} />}
      </div>
      <div
        style={{
          width: Math.round(height * 1.5),
          background: COLORS.ink,
          color: COLORS.white,
          fontSize: Math.round(fontSize * 0.7),
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        検索
      </div>
    </div>
  );
}

/** 作品画像（無い場合は生成りの枠＋タイトル頭文字）。枠に cover で収める */
export function WorkThumb({ image, width, height }: { image: SiteUiImage; width: number; height: number }): ReactElement {
  const frame = { width, height, border: `2px solid ${COLORS.ink}`, borderRadius: 2, overflow: 'hidden', display: 'flex', flexShrink: 0 } as const;
  if (image.dataUri) {
    return (
      <div style={frame}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.dataUri} width={width} height={height} style={{ objectFit: 'cover' }} />
      </div>
    );
  }
  return (
    <div style={{ ...frame, background: COLORS.inkSoft, alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: Math.round(Math.min(width, height) * 0.45), fontWeight: 700, color: COLORS.accent, display: 'flex' }}>{fallbackInitial(image.title)}</span>
    </div>
  );
}

export type ProductKind = '写真集・書籍' | 'CD' | 'Blu-ray・DVD' | 'グッズ';

/** 商品カテゴリのアイコン（本・CD・ディスクケース・紙袋）。商品画像の代わりに使う */
export function ProductIcon({ kind, size, color = COLORS.ink }: { kind: ProductKind; size: number; color?: string }): ReactElement {
  const sw = 1.8;
  if (kind === '写真集・書籍') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M4 5.5 C7 4.5 10 4.5 12 6 C14 4.5 17 4.5 20 5.5 L20 19 C17 18 14 18 12 19.5 C10 18 7 18 4 19 Z" stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />
        <line x1="12" y1="6" x2="12" y2="19.5" stroke={color} strokeWidth={sw} />
      </svg>
    );
  }
  if (kind === 'CD') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth={sw} fill="none" />
        <circle cx="12" cy="12" r="2.6" stroke={color} strokeWidth={sw} fill="none" />
        <path d="M7.5 9.5 A5 5 0 0 1 9.5 7.5" stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'Blu-ray・DVD') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <rect x="3.5" y="3.5" width="14" height="17" rx="1" stroke={color} strokeWidth={sw} fill="none" />
        <circle cx="10.5" cy="12" r="4.5" stroke={color} strokeWidth={sw} fill="none" />
        <circle cx="10.5" cy="12" r="1.2" fill={color} />
        <line x1="20.5" y1="5" x2="20.5" y2="19" stroke={color} strokeWidth={sw} strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M5 8 L19 8 L18 20.5 L6 20.5 Z" stroke={color} strokeWidth={sw} fill="none" strokeLinejoin="round" />
      <path d="M9 10.5 L9 6.5 A3 3 0 0 1 15 6.5 L15 10.5" stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function ArrowDown({ size, color = COLORS.ink }: { size: number; color?: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <line x1="12" y1="3" x2="12" y2="19" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <polyline points="5,13 12,20 19,13" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClockIcon({ size, color = COLORS.muted }: { size: number; color?: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth="2" fill="none" />
      <polyline points="12,7 12,12 15.5,14" stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 締めのページ用：ロゴ＋「気になる人を名前から検索 →」＋小さな「プロフィールのリンクから推しサーチへ」。
 * 押せるボタンに見えないよう、枠や塗りは付けずに文字と下線だけで表す。
 */
export function ClosingBrand({ onDark = true, marginTop = 70 }: { onDark?: boolean; marginTop?: number }): ReactElement {
  return (
    <div style={{ marginTop, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 18 }}>
      <SiteLogo fontSize={60} onDark={onDark} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 40, fontWeight: 700, color: onDark ? COLORS.white : COLORS.ink, display: 'flex' }}>{COMMON_TEXT.searchCta}</span>
        <div style={{ width: 380, height: 4, background: COLORS.accent, display: 'flex' }} />
      </div>
      <span style={{ fontSize: 26, fontWeight: 700, color: onDark ? COLORS.onInkMuted : COLORS.muted, display: 'flex' }}>{COMMON_TEXT.cta}</span>
    </div>
  );
}

/** 出演作品のアイコン（フィルム） */
export function FilmIcon({ size, color = COLORS.ink }: { size: number; color?: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect x="3" y="5" width="18" height="14" rx="1.5" stroke={color} strokeWidth="1.8" fill="none" />
      <line x1="7.5" y1="5" x2="7.5" y2="19" stroke={color} strokeWidth="1.8" />
      <line x1="16.5" y1="5" x2="16.5" y2="19" stroke={color} strokeWidth="1.8" />
      <line x1="3" y1="12" x2="7.5" y2="12" stroke={color} strokeWidth="1.8" />
      <line x1="16.5" y1="12" x2="21" y2="12" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

/** 配信サービスのアイコン（再生ボタン） */
export function PlayIcon({ size, color = COLORS.ink }: { size: number; color?: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" fill="none" />
      <polygon points="10,8.5 16,12 10,15.5" fill={color} />
    </svg>
  );
}

/** ページ下部の小さな注記 */
export function BottomNote({ text, onDark = false }: { text: string; onDark?: boolean }): ReactElement {
  return (
    <div style={{ position: 'absolute', bottom: 26, left: 56, right: 56, display: 'flex', fontSize: 22, color: onDark ? COLORS.onInkMuted : COLORS.muted }}>
      {text}
    </div>
  );
}

/** テキストの表示幅の目安（全角=1、半角=0.58） */
export function estimateTextUnits(text: string): number {
  let units = 0;
  for (const ch of Array.from(text)) units += ch.charCodeAt(0) < 0x80 ? 0.58 : 1;
  return units;
}

export function fitFontSize(text: string, availableWidth: number, maxFontSize: number, minFontSize: number): number {
  return Math.max(minFontSize, Math.min(maxFontSize, Math.floor(availableWidth / Math.max(estimateTextUnits(text), 1))));
}

export function fallbackInitial(title: string): string {
  return Array.from(title).find((c) => /[\p{L}\p{N}]/u.test(c)) ?? '';
}

/**
 * 商品名の表示用整形。先頭の【楽天ブックス限定特典】のような括弧書きの宣伝タグだけを取り除く
 * （商品名そのものは変えない）。取り除くと空になる場合は元の名前を返す。
 */
export function displayProductTitle(title: string): string {
  const trimmed = title.replace(/^(\s*【[^】]*】\s*)+/, '').trim();
  return trimmed || title;
}
