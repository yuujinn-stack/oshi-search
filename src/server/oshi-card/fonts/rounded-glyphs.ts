import 'server-only';
import opentype from 'opentype.js';
import { getOshiCardRoundedFontData } from '@/server/oshi-card/fonts/rounded-font';

/**
 * 推し布教カード A（ベーシック）の名前を、丸ゴシック（M PLUS Rounded 1c ExtraBold・OFL 1.1）の字形の輪郭（SVG パス）にする。
 *
 * - 文字ごとに輪郭を持つため、1文字ずつ独立したグラデーション・光沢・陰影、丸い縁取り（stroke-linejoin: round）を描ける。
 * - フォントの字形をその場で描くだけで、フォントファイル自体を配布・改変しない（OFL の範囲内）。
 * - 丸ゴシックに無い文字が1つでも含まれる名前は null を返す（呼び出し側は従来の文字の重ね描きで表示する）。
 * - opentype.js（MIT）で読み込む。読み込んだフォントはプロセス内で使い回す。
 */

let cached: opentype.Font | null = null;
function font(): opentype.Font {
  if (!cached) cached = opentype.parse(getOshiCardRoundedFontData());
  return cached;
}

export interface RoundedGlyph {
  /** SVG パス（座標は px。行の左端・ベースラインからの位置で配置済み） */
  d: string;
  /** 字形の外接矩形（px） */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RoundedGlyphLine {
  glyphs: RoundedGlyph[];
  /** 行の幅（px。字間を含む） */
  width: number;
}

/** 行の幅（px）を測る。丸ゴシックに無い文字があれば null */
export function measureRoundedLine(text: string, size: number, spacingEm: number): number | null {
  const f = font();
  const chars = [...text];
  let w = 0;
  for (const ch of chars) {
    const g = f.charToGlyph(ch);
    if (!g || g.index === 0) {
      if (ch.trim() === '') { w += size * 0.3; continue; }
      return null;
    }
    w += ((g.advanceWidth ?? f.unitsPerEm) / f.unitsPerEm) * size;
  }
  return w + Math.max(0, chars.length - 1) * spacingEm * size;
}

/**
 * 1行の文字を輪郭にする。ベースラインは y=baseline、行の左端は x=left。
 * 空白は幅だけ空ける。丸ゴシックに無い文字があれば null。
 */
export function roundedGlyphLine(text: string, size: number, spacingEm: number, left: number, baseline: number): RoundedGlyphLine | null {
  const f = font();
  const glyphs: RoundedGlyph[] = [];
  let x = left;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const g = f.charToGlyph(ch);
    if (!g || g.index === 0) {
      if (ch.trim() === '') { x += size * 0.3 + spacingEm * size; continue; }
      return null;
    }
    const path = g.getPath(x, baseline, size);
    const d = path.toPathData(1);
    if (d) {
      const bb = path.getBoundingBox();
      glyphs.push({ d, x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 });
    }
    x += ((g.advanceWidth ?? f.unitsPerEm) / f.unitsPerEm) * size + (i < chars.length - 1 ? spacingEm * size : 0);
  }
  return { glyphs, width: x - left };
}

/** フォントのアセンダー・ディセンダー（em） */
export function roundedFontMetrics(): { ascender: number; descender: number } {
  const f = font();
  return { ascender: f.ascender / f.unitsPerEm, descender: f.descender / f.unitsPerEm };
}
