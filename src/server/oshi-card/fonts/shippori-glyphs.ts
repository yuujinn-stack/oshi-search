import 'server-only';
import * as fs from 'fs';
import * as path from 'path';
import opentype from 'opentype.js';
import type { RoundedGlyph, RoundedGlyphLine } from '@/server/oshi-card/fonts/rounded-glyphs';

/**
 * 推し布教カード B（SSR）の中央の名前だけに使う明朝体（Shippori Mincho B1 ExtraBold、約15MB）の字形の輪郭（SVG パス）。
 *
 * - ライセンス：SIL Open Font License 1.1（同じフォルダの OFL-ShipporiMinchoB1.txt）。出典は Google Fonts。
 * - 参考デザインBの、太く縦長で品のある名前に近づけるために使う。B を描くときだけ読み込む（A の丸ゴシックとは別のモジュール）。
 * - フォントの字形をその場で描くだけで、フォントファイル自体を配布・改変しない（OFL の範囲内）。
 * - 明朝体に無い文字が1つでも含まれる名前は null を返す（呼び出し側は従来の文字の重ね描きで表示する）。
 * - Vercel の関数へ確実に含めるため next.config.ts の outputFileTracingIncludes に登録している。
 * - 処理は rounded-glyphs.ts（A）と同じ。A に影響しないようフォントの読み込みだけ分けている。
 */
const FONT_PATH = path.join(process.cwd(), 'src', 'server', 'oshi-card', 'fonts', 'ShipporiMinchoB1-ExtraBold.ttf');

let cached: opentype.Font | null = null;
/** 直近の読み込みにかかった時間（ms）。Preview の計測（server-timing.ts）用。読み出すと 0 に戻る */
let pendingLoadMs = 0;
function font(): opentype.Font {
  if (!cached) {
    const t0 = performance.now();
    const b = fs.readFileSync(FONT_PATH);
    cached = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    pendingLoadMs = performance.now() - t0;
  }
  return cached;
}

/** 明朝体の読み込み時間（ms）を返して 0 に戻す（このリクエストで読み込んでいなければ 0） */
export function takeShipporiFontLoadMs(): number {
  const ms = pendingLoadMs;
  pendingLoadMs = 0;
  return ms;
}

/** 行の幅（px）を測る。明朝体に無い文字があれば null */
export function measureShipporiLine(text: string, size: number, spacingEm: number): number | null {
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

/** 1行の文字を輪郭にする。ベースラインは y=baseline、行の左端は x=left。空白は幅だけ空ける。明朝体に無い文字があれば null */
export function shipporiGlyphLine(text: string, size: number, spacingEm: number, left: number, baseline: number): RoundedGlyphLine | null {
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
    const p = g.getPath(x, baseline, size);
    const d = p.toPathData(1);
    if (d) {
      const bb = p.getBoundingBox();
      glyphs.push({ d, x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 });
    }
    x += ((g.advanceWidth ?? f.unitsPerEm) / f.unitsPerEm) * size + (i < chars.length - 1 ? spacingEm * size : 0);
  }
  return { glyphs, width: x - left };
}
