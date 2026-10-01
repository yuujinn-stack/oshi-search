/**
 * G（search-too-much）・J（real-screen）で共通に使う部品。H（watch-and-buy）は使わない（Hの見た目は変えない）。
 * 配色・ロゴ・検索欄は H と同じもの（theme.ts / shared.tsx）を使う。
 */
import type { ReactElement, ReactNode } from 'react';
import { COLORS, CANVAS, FONT_FAMILY, DOT_BACKGROUND } from './theme';

/** 1080×1080のページ。bg: ink=黒（G）、white=白（J）、dots=生成りのドット（Gの2枚目の右側など） */
export function Canvas({ bg, children }: { bg: 'ink' | 'dots' | 'white'; children: ReactNode }): ReactElement {
  const background = bg === 'ink' ? { backgroundColor: COLORS.ink } : bg === 'dots' ? DOT_BACKGROUND : { backgroundColor: COLORS.white };
  return (
    <div
      style={{
        position: 'relative',
        width: CANVAS.width,
        height: CANVAS.height,
        ...background,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: FONT_FAMILY,
        color: bg === 'ink' ? COLORS.white : COLORS.text,
      }}
    >
      {children}
    </div>
  );
}

export function MagnifierIcon({ size, color }: { size: number; color: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="10.5" cy="10.5" r="6.5" stroke={color} strokeWidth="2.4" fill="none" />
      <line x1="15.5" y1="15.5" x2="21" y2="21" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
