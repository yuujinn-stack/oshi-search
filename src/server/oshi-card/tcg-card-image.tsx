// 推し布教カードのトレカ風テンプレート（next/og = Satori 用）。ベーシック（かわいい）／SSR（キラキラ）／レジェンド（クール）。
//
// - 人物写真・イラスト・写真枠は使わない。中央の広い窓は「装飾した推しの名前」と図形の装飾（SVG・CSSグラデーション）だけで埋める。
//   画像ファイル・外部素材に依存しないため、保存画像にも装飾がすべて入る（プレビューもこの画像そのもの）。
// - 既存TCGのロゴ・キャラクター・固有の意匠は使わない（王冠・ハート・星・月桂樹・光線などの一般的なモチーフだけ）。
// - 名前の装飾（いちばん大事な部分）：同じ文字を位置をそろえて重ねる。下から
//     発光（ぼかし）→ 立体の影（下にずらした濃い色）→ 外側の縁取り → 内側の縁取り（推し色）→ グラデーション塗り → 上半分の光沢。
//   Satori の text-stroke は文字の輪郭の中央に描かれるため、太い線を下に・細い線を上に重ねて二重の縁取りにする。
//   長い名前は文字幅から大きさを決め、空白（英語）や文字種の切れ目（漢字→カタカナ等）があれば2行に分ける。
// - サイズ：feed＝カード単体 1260×1760（63:88）、story＝1080×1920 の中央にカード、og＝1200×630 の中央にカード。
//   カードの寸法はすべて基準（幅1260）からの倍率 s で計算する（縮小しても同じ見た目）。
// - Satori の制約：子要素が2つ以上の div は display:flex。✦ など一部の記号はフォントに無いため使わない（♡・★ は可）。
import 'server-only';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { BrandMark, OSHI_VOD_IMAGE_FONT_FAMILY } from '@/server/oshi-vod/result-image';
import { charEm, emWidth, fitTitle, type OshiCardImageWork } from '@/server/oshi-card/card-image';
import { OSHI_CARD_ROUNDED_FONT_FAMILY } from '@/server/oshi-card/fonts/rounded-font';
import { measureRoundedLine, roundedGlyphLine, type RoundedGlyph } from '@/server/oshi-card/fonts/rounded-glyphs';
import { measureShipporiLine, shipporiGlyphLine } from '@/server/oshi-card/fonts/shippori-glyphs';
import { ssrCardAssets } from '@/server/oshi-card/ssr-assets';
import { OSHI_CARD_TCG_CARD_SIZE, OSHI_CARD_IMAGE_SIZES, type OshiCardImageSize } from '@/lib/oshi-card/params';
import {
  OSHI_CARD_TCG_TEMPLATES,
  formatOshiCardPower,
  oshiCardColor,
  type OshiCardColor,
  type OshiCardColorId,
  type OshiCardTcgVariant,
} from '@/lib/oshi-card/tcg';

export interface OshiCardTcgImageData {
  /** 人物名（上部に小さく） */
  person: string;
  group: string;
  /** メインの名前（中央に大きく。初期値は人物名） */
  name: string;
  phrase: string;
  trait: string;
  numa: string;
  /**
   * A（ベーシック）の特性の説明文（任意）。将来ユーザーが編集できるようにするための受け口。
   * 未指定のときは人物に依存しない定型文（BASIC_TRAIT_BODY）を表示する
   */
  traitBody?: string;
  /** A の沼ポイントの数値（任意）。ユーザーが入力した値だけを表示し、未指定なら何も表示しない（勝手に作らない） */
  numaScore?: number | null;
  power: number;
  color: OshiCardColorId | null;
  works: OshiCardImageWork[];
}

const BASE_W = OSHI_CARD_TCG_CARD_SIZE.width; // 1260
const BASE_H = OSHI_CARD_TCG_CARD_SIZE.height; // 1760
const SITE_URL = 'oshi-search.jp/oshi-card';
const TCG_NOTE = '※推し力は演出の数値・作品は投稿者のおすすめです（公式の評価・順位ではありません）';

// ─── 色・テーマ ────────────────────────────────────────────────────────────────

interface Theme {
  variant: OshiCardTcgVariant;
  c: OshiCardColor;
  /** 推し色の縁取り（白は見えないため濃い色にする） */
  ring: string;
}

function makeTheme(variant: OshiCardTcgVariant, colorId: OshiCardColorId | null): Theme {
  const c = oshiCardColor(colorId ?? OSHI_CARD_TCG_TEMPLATES[variant].defaultColor);
  return { variant, c, ring: c.id === 'white' ? c.deep : c.base };
}

const GOLD_METAL = 'linear-gradient(135deg, #7A4E0E 0%, #F7E08A 16%, #B8861F 33%, #FFF4C2 50%, #A8741A 66%, #F3D27A 83%, #6E4510 100%)';
const RAINBOW_FOIL = 'linear-gradient(135deg, #FFE59A 0%, #FFB8E8 18%, #B9A4FF 36%, #92E6FF 54%, #C8FFD8 70%, #FFE59A 86%, #FFB8E8 100%)';

/** rgba（#RRGGBB と不透明度から） */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ─── 名前の行分け・大きさ ────────────────────────────────────────────────────────

type Script = 'latin' | 'kana' | 'katakana' | 'kanji' | 'other';
function scriptOf(ch: string): Script {
  const c = ch.codePointAt(0)!;
  if (/[A-Za-z0-9]/.test(ch)) return 'latin';
  if (c >= 0x3040 && c <= 0x309f) return 'kana';
  if ((c >= 0x30a0 && c <= 0x30ff) || (c >= 0xff66 && c <= 0xff9f)) return 'katakana';
  if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || c === 0x3005) return 'kanji';
  return 'other';
}

/** 縁取りの外側に使う余白（em）。縁取り・影の分だけ実際の文字より広い */
const NAME_PAD_EM = 0.42;

/**
 * 名前を1行または2行に分け、幅 width に収まる文字の大きさを決める（純粋関数・テスト用に export）。
 * 1行で minOneLine 以上の大きさにできなければ、空白 → 文字種の切れ目の順で2行に分ける。
 * どちらも無い名前は1行のまま縮め、minFont でも幅を超える長い名前だけ真ん中で2行に分ける。
 * 文字は幅を超えない（minFont より小さくしてでも収める。名前は最大20文字のため実際には 2行×10文字以内）。
 */
export function layoutTcgName(name: string, width: number, maxFont: number, minFont: number, maxHeight = Infinity): { lines: string[]; font: number } {
  // 高さの上限：行の高さ 1.12em ×行数 ＋ 影・縁取りの分 0.3em
  const fit = (lines: string[]) => Math.min(maxFont, Math.floor(maxHeight / (lines.length * 1.12 + 0.3)), Math.floor(width / (Math.max(...lines.map(emWidth)) + NAME_PAD_EM)));
  const fontFor = (lines: string[]) => Math.max(minFont, fit(lines));
  const one = fontFor([name]);
  const minOneLine = Math.round(maxFont * 0.62);
  if (one >= minOneLine) return { lines: [name], font: one };
  const chars = [...name];
  const candidates: number[] = [];
  chars.forEach((ch, i) => { if (ch === ' ' && i > 0 && i < chars.length - 1) candidates.push(i); });
  if (candidates.length === 0) {
    for (let i = 1; i < chars.length; i++) {
      const a = scriptOf(chars[i - 1]);
      const b = scriptOf(chars[i]);
      if (a !== b && a !== 'other' && b !== 'other') candidates.push(i);
    }
  }
  let best: { lines: string[]; font: number } | null = null;
  for (const i of candidates) {
    const lines = [chars.slice(0, i).join('').trim(), chars.slice(i).join('').trim()];
    if (lines.some((l) => [...l].length < 2)) continue;
    const font = Math.min(fontFor(lines), Math.round(maxFont * 0.86));
    if (!best || font > best.font) best = { lines, font };
  }
  if (best && best.font > one * 1.12) return best;
  if (fit([name]) >= minFont || chars.length < 4) return { lines: [name], font: Math.min(one, Math.max(1, fit([name]))) };
  // 切れ目の無い長い名前：真ん中で2行に（それでも入らなければ minFont より小さくして収める）
  const mid = Math.ceil(chars.length / 2);
  const halves = [chars.slice(0, mid).join(''), chars.slice(mid).join('')];
  return { lines: halves, font: Math.max(1, fit(halves)) };
}

// ─── 名前（重ねた文字） ──────────────────────────────────────────────────────────

interface NameLayer {
  style: CSSProperties;
  /** 下方向へのずらし（em） */
  dy?: number;
  /** 右方向へのずらし（em） */
  dx?: number;
}

/** 同じ縁取りを8方向へ少しずつずらして重ね、外形を丸くふくらませる（ぷっくりした文字に見せる。フォントは角ゴシックのみのため） */
function puffy(style: CSSProperties, r: number, dy = 0): NameLayer[] {
  return Array.from({ length: 8 }, (_, i) => ({ style, dx: Math.cos((i * Math.PI) / 4) * r, dy: dy + Math.sin((i * Math.PI) / 4) * r }));
}

/** 2つの #RRGGBB を混ぜる（t=0 で a、t=1 で b） */
function mixHex(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t).toString(16).padStart(2, '0')).join('')}`;
}

function nameLayers(t: Theme, f: number): NameLayer[] {
  const { c } = t;
  const px = (em: number) => Math.max(1, Math.round(f * em));
  const stroke = (em: number, color: string): CSSProperties => ({ color, WebkitTextStroke: `${px(em)}px ${color}` });
  const fill = (gradient: string): CSSProperties => ({ backgroundImage: gradient, backgroundClip: 'text', color: 'transparent' });
  // 発光：太い縁取りの文字に、ぼかした影を重ねる（filter: blur は文字の外側に四角い跡が出るため使わない）
  // 影は文字の箱の外で切れるため、FancyName で各行の箱を文字より十分大きくしている
  const glow = (color: string, em: number): CSSProperties => ({ ...stroke(0.2, color), textShadow: `0 0 ${px(em)}px ${color}, 0 0 ${px(em * 2)}px ${color}` });
  const gloss = fill('linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.35) 30%, rgba(255,255,255,0) 46%)');
  if (t.variant === 'basic') {
    // 参考デザインAのデコ文字：外側から「濃いピンクの立体の影（2段）→ 淡いピンクのフチ（＋ふんわり発光）→ 白フチ（細め）→ 濃いピンクの細い線 → ピンクのグラデーション → 濡れたようなツヤ」
    // 丸ゴシック（BasicCard で指定）に、8方向に重ねたフチで外形をさらに丸くする。字間を少し空けて文字同士を一体化させない。塗りには影を付けない（色が消えるため）
    const white = c.id === 'white';
    const main = white ? '#E58BB0' : c.base;
    const deep = white ? '#B8577F' : c.deep;
    const light = white ? '#FFD6E6' : c.light;
    // 立体の厚みは薄く（固い板に見せない）、ぼかした影でなじませる。フチは「白（主）＋外側の細いピンク」
    return [
      { style: glow(alpha(deep, 0.32), 0.12), dy: 0.09 },
      { style: glow('rgba(255,255,255,0.9)', 0.1) },
      ...puffy(stroke(0.17, mixHex(main, deep, 0.45)), 0.02, 0.06),
      ...puffy(stroke(0.17, mixHex(main, light, 0.15)), 0.02),
      ...puffy(stroke(0.11, '#FFFFFF'), 0.014),
      { style: stroke(0.04, mixHex(main, deep, 0.3)) },
      // 参考デザインAの濃淡（上 #FB82AC → 中 #FC6BA3 → 下 #EB4484 相当）を推し色から作る。光沢は白で塗りつぶさず、ピンクの濃淡で出す
      { style: fill(`linear-gradient(180deg, ${mixHex(main, light, 0.3)} 0%, ${mixHex(main, light, 0.12)} 30%, ${main} 55%, ${mixHex(main, deep, 0.28)} 82%, ${mixHex(main, deep, 0.4)} 100%)`) },
      // 自然なツヤ：上の縁だけに細く控えめな白い反射、下側にうっすら照り返し
      { style: fill('linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.5) 10%, rgba(255,255,255,0.14) 18%, rgba(255,255,255,0) 28%)') },
      { style: fill('linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 74%, rgba(255,255,255,0.28) 86%, rgba(255,255,255,0) 96%)') },
    ];
  }
  if (t.variant === 'ssr') {
    // 白・シルバー・水色・薄紫（推し色の淡色）・ピンクが斜めに混ざるホログラム。白い推し色のときは銀寄りに
    const lav = c.id === 'white' ? '#D5DAEA' : mixHex(c.light, c.base, 0.45);
    const holo = `linear-gradient(115deg, #FFFFFF 0%, #D9E0EE 10%, #9FE2FF 25%, ${lav} 42%, #FFB3DE 58%, #F3F5FB 71%, #A9E8FF 85%, #EBD2FF 100%)`;
    const navy = '#24145A';
    return [
      // 外側の発光：推し色＋左右にずらしたピンク・水色（虹色ににじむ光）
      { style: glow(alpha(c.id === 'white' ? '#B9A4FF' : c.base, 0.9), 0.26) },
      { style: glow(alpha('#FF7FD0', 0.55), 0.16), dx: -0.03 },
      { style: glow(alpha('#7FDCFF', 0.55), 0.16), dx: 0.03 },
      { style: glow('rgba(255,255,255,0.95)', 0.1) },
      // 影は半透明＋ぼかし（黒い塊に見せない）。濃紺の縁取りは細め
      { style: { ...stroke(0.24, alpha(navy, 0.38)), textShadow: `0 0 ${px(0.05)}px ${alpha(navy, 0.35)}` }, dy: 0.055 },
      ...puffy(stroke(0.24, navy), 0.012),
      // 縁の光沢：白のフチの上に、銀色の細い線と推し色の線
      { style: { ...stroke(0.18, '#FFFFFF'), textShadow: `0 0 ${px(0.035)}px rgba(255,255,255,0.9)` } },
      { style: stroke(0.11, '#E3E8FF') },
      { style: stroke(0.07, t.ring) },
      { style: fill(holo) },
      // 内側の発光（中央が明るく光る）と下側の淡い陰影
      { style: fill('linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,0.32) 50%, rgba(255,255,255,0) 66%)') },
      { style: fill(`linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 58%, ${alpha(c.id === 'white' ? '#8E98B8' : c.deep, 0.3)} 100%)`) },
      // 上半分のくっきりした光沢と、斜めに走るホログラムのきらめき
      { style: fill('linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.4) 16%, rgba(255,255,255,0) 32%)') },
      { style: fill('linear-gradient(115deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 28%, rgba(255,255,255,0.75) 34%, rgba(255,255,255,0) 40%, rgba(255,255,255,0) 66%, rgba(255,255,255,0.55) 71%, rgba(255,255,255,0) 76%, rgba(255,255,255,0) 100%)') },
    ];
  }
  // legend：白〜金の金属的なグラデーション・金の縁取り・黒い立体の影
  return [
    { style: glow(alpha(c.id === 'yellow' || c.id === 'black' ? '#F5C451' : c.base, 0.85), 0.2) },
    { style: stroke(0.28, '#000000'), dy: 0.08 },
    { style: stroke(0.28, '#3B2604') },
    { style: stroke(0.17, '#F4CF63') },
    { style: stroke(0.07, '#6B4508') },
    { style: fill('linear-gradient(180deg, #FFFFFF 0%, #FFF8DE 26%, #FBE08A 48%, #D39A2B 70%, #FFF0B8 88%, #E2AE45 100%)') },
    { style: gloss },
  ];
}

function FancyName({ name, width, maxFont, minFont, maxHeight, t, fontFamily, spacingEm }: { name: string; width: number; maxFont: number; minFont: number; maxHeight: number; t: Theme; fontFamily?: string; spacingEm?: number }) {
  const { lines, font } = layoutTcgName(name, width, maxFont, minFont, maxHeight);
  const lineH = Math.round(font * 1.12);
  const height = lineH * lines.length + Math.round(font * 0.2);
  const top0 = (height - lineH * lines.length) / 2;
  // 各行の箱は文字より上下左右に pad だけ大きくし、その中央に文字を置く（発光・影が箱の端で切れないように）
  const pad = Math.round(font * 0.9);
  const latin = lines.every((l) => [...l].every((ch) => charEm(ch) < 1));
  return (
    <div style={{ display: 'flex', position: 'relative', width, height }}>
      {nameLayers(t, font).flatMap((layer, i) =>
        lines.map((line, j) => (
          <div
            key={`${i}-${j}`}
            style={{
              position: 'absolute', top: Math.round(top0 + j * lineH + (layer.dy ?? 0) * font - pad), left: Math.round(-pad + (layer.dx ?? 0) * font), width: width + pad * 2, height: lineH + pad * 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{ display: 'flex', fontSize: font, lineHeight: `${lineH}px`, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: spacingEm !== undefined ? Math.round(font * spacingEm) : latin ? Math.round(font * 0.01) : Math.round(font * -0.02), ...(fontFamily ? { fontFamily } : {}), ...layer.style }}>{line}</div>
          </div>
        )),
      )}
    </div>
  );
}

// ─── 図形の装飾（SVG） ─────────────────────────────────────────────────────────

function Svg({ w, h, view, style, children }: { w: number; h: number; view: string; style?: CSSProperties; children: ReactNode }) {
  return <svg width={w} height={h} viewBox={view} style={{ position: 'absolute', ...style }}>{children}</svg>;
}

const SPARKLE_D = 'M12 0 C13 7.5 16.5 11 24 12 C16.5 13 13 16.5 12 24 C11 16.5 7.5 13 0 12 C7.5 11 11 7.5 12 0 Z';
const STAR_D = 'M12 1.5 L14.9 8.3 L22.3 8.9 L16.7 13.8 L18.4 21 L12 17.2 L5.6 21 L7.3 13.8 L1.7 8.9 L9.1 8.3 Z';
const HEART_D = 'M12 21 C5 15.5 1.5 12 1.5 7.8 C1.5 4.6 4 2.5 6.8 2.5 C9 2.5 10.8 3.8 12 5.6 C13.2 3.8 15 2.5 17.2 2.5 C20 2.5 22.5 4.6 22.5 7.8 C22.5 12 19 15.5 12 21 Z';

function Sparkle({ x, y, size, color, glow }: { x: number; y: number; size: number; color: string; glow?: string }) {
  return (
    <Svg w={size} h={size} view="0 0 24 24" style={{ left: x - size / 2, top: y - size / 2 }}>
      {glow && <circle cx="12" cy="12" r="5" fill={glow} />}
      <path d={SPARKLE_D} fill={color} />
    </Svg>
  );
}

function StarShape({ x, y, size, fill, stroke, rotate = 0 }: { x: number; y: number; size: number; fill: string; stroke?: string; rotate?: number }) {
  return (
    <Svg w={size} h={size} view="0 0 24 24" style={{ left: x - size / 2, top: y - size / 2, transform: `rotate(${rotate}deg)` }}>
      <path d={STAR_D} fill={fill} stroke={stroke ?? 'none'} strokeWidth={stroke ? 1.4 : 0} strokeLinejoin="round" />
    </Svg>
  );
}

function HeartShape({ x, y, size, fill, stroke, rotate = 0 }: { x: number; y: number; size: number; fill: string; stroke?: string; rotate?: number }) {
  return (
    <Svg w={size} h={size} view="0 0 24 24" style={{ left: x - size / 2, top: y - size / 2, transform: `rotate(${rotate}deg)` }}>
      <path d={HEART_D} fill={fill} stroke={stroke ?? 'none'} strokeWidth={stroke ? 1.6 : 0} strokeLinejoin="round" />
      <ellipse cx="7.5" cy="7.5" rx="2.2" ry="1.4" fill="rgba(255,255,255,0.7)" transform="rotate(-35 7.5 7.5)" />
    </Svg>
  );
}

/** 中心から放射状に伸びる光線（背景） */
function Rays({ w, h, cx, cy, count, color, len }: { w: number; h: number; cx: number; cy: number; count: number; color: string; len: number }) {
  const polys: string[] = [];
  for (let i = 0; i < count; i++) {
    const a0 = (i / count) * Math.PI * 2;
    const a1 = a0 + (Math.PI / count) * 0.9;
    polys.push(`${cx},${cy} ${(cx + Math.cos(a0) * len).toFixed(1)},${(cy + Math.sin(a0) * len).toFixed(1)} ${(cx + Math.cos(a1) * len).toFixed(1)},${(cy + Math.sin(a1) * len).toFixed(1)}`);
  }
  return (
    <Svg w={w} h={h} view={`0 0 ${w} ${h}`} style={{ left: 0, top: 0 }}>
      {polys.map((p, i) => <polygon key={i} points={p} fill={color} />)}
    </Svg>
  );
}

/** 王冠（金の地・宝石は推し色） */
function Crown({ x, y, width, gem, dark = false, outline }: { x: number; y: number; width: number; gem: string; dark?: boolean; outline?: string }) {
  const h = width * 0.72;
  return (
    // 白いフチ付き（A）は、フチが切れないよう表示範囲を周りに6だけ広げる（王冠そのものの大きさ・位置は同じ）
    <Svg w={outline ? width * 1.12 : width} h={outline ? h + width * 0.12 : h} view={outline ? '-6 -6 112 84' : '0 0 100 72'} style={{ left: x - (outline ? width * 0.56 : width / 2), top: outline ? y - width * 0.06 : y }}>
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF6C8" />
          <stop offset="0.45" stopColor="#F6C945" />
          <stop offset="1" stopColor="#B07812" />
        </linearGradient>
      </defs>
      {outline && <path d="M8 58 L4 18 L28 38 L50 6 L72 38 L96 18 L92 58 Z" fill={outline} stroke={outline} strokeWidth="9" strokeLinejoin="round" />}
      {outline && <rect x="8" y="56" width="84" height="12" rx="3" fill={outline} stroke={outline} strokeWidth="9" />}
      <path d="M8 58 L4 18 L28 38 L50 6 L72 38 L96 18 L92 58 Z" fill="url(#cg)" stroke={dark ? '#3B2604' : '#8A5A0A'} strokeWidth="3.2" strokeLinejoin="round" />
      <rect x="8" y="56" width="84" height="12" rx="3" fill="url(#cg)" stroke={dark ? '#3B2604' : '#8A5A0A'} strokeWidth="3.2" />
      <circle cx="4" cy="16" r="4.5" fill="#FFF6C8" stroke="#8A5A0A" strokeWidth="2" />
      <circle cx="50" cy="5" r="5" fill="#FFF6C8" stroke="#8A5A0A" strokeWidth="2" />
      <circle cx="96" cy="16" r="4.5" fill="#FFF6C8" stroke="#8A5A0A" strokeWidth="2" />
      <circle cx="50" cy="42" r="8" fill={gem} stroke="#FFFFFF" strokeWidth="2.4" />
      <circle cx="27" cy="48" r="5" fill={gem} stroke="#FFFFFF" strokeWidth="2" />
      <circle cx="73" cy="48" r="5" fill={gem} stroke="#FFFFFF" strokeWidth="2" />
      <ellipse cx="47" cy="39" rx="2.6" ry="1.6" fill="rgba(255,255,255,0.85)" />
    </Svg>
  );
}

/** リボン（蝶結び） */
function Bow({ x, y, width, color, deep, rotate = 0 }: { x: number; y: number; width: number; color: string; deep: string; rotate?: number }) {
  const h = width * 0.7;
  return (
    <Svg w={width} h={h} view="0 0 100 70" style={{ left: x - width / 2, top: y - h / 2, transform: `rotate(${rotate}deg)` }}>
      <path d="M44 34 L30 66 L40 62 L45 70 L50 38 Z" fill={deep} />
      <path d="M56 34 L70 66 L60 62 L55 70 L50 38 Z" fill={deep} />
      <path d="M50 32 C38 10 10 4 6 20 C3 34 24 44 50 36 Z" fill={color} stroke={deep} strokeWidth="3" strokeLinejoin="round" />
      <path d="M50 32 C62 10 90 4 94 20 C97 34 76 44 50 36 Z" fill={color} stroke={deep} strokeWidth="3" strokeLinejoin="round" />
      <path d="M18 18 C24 14 34 18 40 26" stroke="rgba(255,255,255,0.75)" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M82 18 C76 14 66 18 60 26" stroke="rgba(255,255,255,0.45)" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="50" cy="34" rx="9" ry="10" fill={color} stroke={deep} strokeWidth="3" />
    </Svg>
  );
}

/** 月桂樹の枝（左右対称。side=-1 で左＝「(」の形、1 で右＝「)」の形） */
function Laurel({ x, y, height, side, color, vein }: { x: number; y: number; height: number; side: 1 | -1; color: string; vein: string }) {
  const VW = 150;
  const VH = 220;
  const w = (height * VW) / VH;
  // 枝は円弧（中心 (150,110)・半径105）。下（角度115°）から上（250°）へ。葉は枝の点から外側・内側へ1枚ずつ
  const cxC = 150;
  const cyC = 110;
  const R = 105;
  const at = (deg: number) => [cxC + R * Math.cos((deg * Math.PI) / 180), cyC + R * Math.sin((deg * Math.PI) / 180)];
  const [x0, y0] = at(115);
  const [x1, y1] = at(250);
  const leaves: ReactElement[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const deg = 122 + (i * (244 - 122)) / (n - 1);
    const [px, py] = at(deg);
    const size = 1 - (i / (n - 1)) * 0.3;
    const leaf = (key: string, rot: number) => (
      <path key={key} d={`M0 0 C ${9 * size} ${-9 * size}, ${26 * size} ${-10 * size}, ${38 * size} 0 C ${26 * size} ${10 * size}, ${9 * size} ${9 * size}, 0 0 Z`} fill={color} stroke={vein} strokeWidth="1.4" transform={`translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${rot.toFixed(1)})`} />
    );
    // 枝の進む向き（下→上）は deg+90°。外側の葉は deg+50°、内側の葉は deg+130°
    leaves.push(leaf(`o${i}`, deg + 50), leaf(`i${i}`, deg + 130));
  }
  const [tx, ty] = at(252);
  leaves.push(<path key="tip" d={`M0 0 C 8 -8, 22 -8, 30 0 C 22 8, 8 8, 0 0 Z`} fill={color} stroke={vein} strokeWidth="1.4" transform={`translate(${tx.toFixed(1)} ${ty.toFixed(1)}) rotate(${(252 + 90).toFixed(1)})`} />);
  return (
    <Svg w={w} h={height} view={`0 0 ${VW} ${VH}`} style={{ left: x - w / 2, top: y }}>
      <g transform={side === 1 ? `translate(${VW} 0) scale(-1 1)` : 'translate(0 0)'}>
        <path d={`M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`} stroke={vein} strokeWidth="5" fill="none" strokeLinecap="round" />
        {leaves}
      </g>
    </Svg>
  );
}

/** 宝石（ひし形のカット） */
function Gem({ x, y, size, color, light, deep }: { x: number; y: number; size: number; color: string; light: string; deep: string }) {
  return (
    <Svg w={size} h={size} view="0 0 40 40" style={{ left: x - size / 2, top: y - size / 2 }}>
      <polygon points="20,2 38,16 20,38 2,16" fill={color} stroke={deep} strokeWidth="2" strokeLinejoin="round" />
      <polygon points="20,2 28,16 20,38 12,16" fill={light} opacity="0.75" />
      <polygon points="2,16 38,16 20,38" fill={deep} opacity="0.25" />
      <polygon points="12,8 20,2 16,14" fill="#FFFFFF" opacity="0.9" />
    </Svg>
  );
}

/** 細かな光の粒と小さなきらめき（位置は固定の擬似乱数。毎回同じ配置） */
function LightSpecks({ w, h, count, seed, color, avoid }: { w: number; h: number; count: number; seed: number; color: string; avoid?: { x: number; y: number; rx: number; ry: number } }) {
  let r = seed;
  const rand = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
  const dots: ReactElement[] = [];
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const size = 0.0025 + rand() * 0.005;
    const op = 0.45 + rand() * 0.5;
    // 名前の上には置かない（読みやすさを保つ）
    if (avoid && ((x - avoid.x) / avoid.rx) ** 2 + ((y - avoid.y) / avoid.ry) ** 2 < 1) continue;
    if (i % 6 === 0) {
      const s = w * (size * 3.2);
      dots.push(<path key={i} d={`M ${x} ${y - s} C ${x + s * 0.12} ${y - s * 0.12}, ${x + s * 0.12} ${y - s * 0.12}, ${x + s} ${y} C ${x + s * 0.12} ${y + s * 0.12}, ${x + s * 0.12} ${y + s * 0.12}, ${x} ${y + s} C ${x - s * 0.12} ${y + s * 0.12}, ${x - s * 0.12} ${y + s * 0.12}, ${x - s} ${y} C ${x - s * 0.12} ${y - s * 0.12}, ${x - s * 0.12} ${y - s * 0.12}, ${x} ${y - s} Z`} fill={color} opacity={op} />);
    } else {
      dots.push(<circle key={i} cx={x} cy={y} r={w * size} fill={color} opacity={op * 0.85} />);
    }
  }
  return <Svg w={w} h={h} view={`0 0 ${w} ${h}`} style={{ left: 0, top: 0 }}>{dots}</Svg>;
}

/** ホログラムの面の切り替わり（三角形のカット面。半透明の白・ピンク・水色を交互に） */
function Facets({ w, h }: { w: number; h: number }) {
  const cols = 6;
  const rows = 4;
  const cw = w / cols;
  const rh = h / rows;
  const tints = ['rgba(255,255,255,0.22)', 'rgba(255,170,230,0.16)', 'rgba(150,225,255,0.18)', 'rgba(255,255,255,0.06)', 'rgba(200,170,255,0.16)'];
  const polys: ReactElement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      const x0 = q * cw;
      const y0 = r * rh;
      const flip = (r + q) % 2 === 0;
      const a = flip ? `${x0},${y0} ${x0 + cw},${y0} ${x0},${y0 + rh}` : `${x0},${y0} ${x0 + cw},${y0} ${x0 + cw},${y0 + rh}`;
      const b = flip ? `${x0 + cw},${y0} ${x0 + cw},${y0 + rh} ${x0},${y0 + rh}` : `${x0},${y0} ${x0 + cw},${y0 + rh} ${x0},${y0 + rh}`;
      polys.push(<polygon key={`a${r}-${q}`} points={a} fill={tints[(r * 3 + q) % tints.length]} />);
      polys.push(<polygon key={`b${r}-${q}`} points={b} fill={tints[(r * 3 + q + 2) % tints.length]} />);
    }
  }
  return <Svg w={w} h={h} view={`0 0 ${w} ${h}`} style={{ left: 0, top: 0 }}>{polys}</Svg>;
}

/** 光の軌跡（名前の周りの弧） */
function LightTrails({ w, h, color }: { w: number; h: number; color: string }) {
  return (
    <Svg w={w} h={h} view={`0 0 ${w} ${h}`} style={{ left: 0, top: 0 }}>
      <path d={`M ${w * 0.04} ${h * 0.72} C ${w * 0.25} ${h * 0.98}, ${w * 0.7} ${h * 0.98}, ${w * 0.97} ${h * 0.6}`} stroke={color} strokeWidth={w * 0.012} fill="none" strokeLinecap="round" opacity="0.55" />
      <path d={`M ${w * 0.08} ${h * 0.78} C ${w * 0.3} ${h * 1.0}, ${w * 0.72} ${h * 0.96}, ${w * 0.93} ${h * 0.7}`} stroke="#FFFFFF" strokeWidth={w * 0.004} fill="none" strokeLinecap="round" opacity="0.9" />
      <path d={`M ${w * 0.96} ${h * 0.3} C ${w * 0.75} ${h * 0.02}, ${w * 0.3} ${h * 0.02}, ${w * 0.03} ${h * 0.4}`} stroke={color} strokeWidth={w * 0.009} fill="none" strokeLinecap="round" opacity="0.45" />
      <path d={`M ${w * 0.9} ${h * 0.24} C ${w * 0.7} ${h * 0.06}, ${w * 0.32} ${h * 0.06}, ${w * 0.1} ${h * 0.3}`} stroke="#FFFFFF" strokeWidth={w * 0.0035} fill="none" strokeLinecap="round" opacity="0.85" />
    </Svg>
  );
}

// ─── テンプレートごとの見た目 ──────────────────────────────────────────────────────

interface Skin {
  frame: string;
  frameEdge: string;
  /** フレームの内側の細い縁 */
  bevel: string;
  panel: CSSProperties;
  window: CSSProperties;
  windowBorder: string;
  headText: string;
  headSub: string;
  powerBox: CSSProperties;
  powerText: string;
  infoBox: CSSProperties;
  infoLabel: CSSProperties;
  infoText: string;
  infoSub: string;
  badge: CSSProperties;
  footText: string;
  ribbon: CSSProperties;
  ribbonText: string;
  rarity: string;
  emblem: string;
  /** 下部の見出しラベルの装飾（cute＝A のデコカプセル、foil＝B の虹色フチ。未指定は従来の丸いラベル） */
  labelDeco?: { kind: 'cute' | 'foil'; bg: string; edge: string; shadow: string; accent: string };
}

function skinOf(t: Theme): Skin {
  const { c } = t;
  if (t.variant === 'basic') {
    const frame = c.id === 'white'
      ? 'linear-gradient(150deg, #FFFFFF 0%, #E9EDF5 35%, #FFFFFF 55%, #C9D0DE 100%)'
      : `linear-gradient(150deg, ${c.light} 0%, ${c.base} 30%, ${c.light} 50%, ${c.base} 72%, ${c.deep} 100%)`;
    return {
      frame,
      frameEdge: c.deep,
      bevel: 'rgba(255,255,255,0.9)',
      panel: { backgroundImage: `linear-gradient(180deg, #FFFFFF 0%, ${alpha(c.light, 0.9)} 55%, #FFFFFF 100%)` },
      window: { backgroundImage: `radial-gradient(circle at 50% 46%, #FFFFFF 0%, #FFFFFF 18%, ${c.light} 58%, ${c.id === 'white' ? '#E6EAF3' : c.base} 100%)` },
      windowBorder: t.ring,
      headText: '#3B1530',
      headSub: alpha('#3B1530', 0.7),
      powerBox: { backgroundColor: '#FFFFFF', border: `4px solid ${t.ring}` },
      powerText: c.id === 'white' || c.id === 'yellow' ? c.deep : c.base,
      infoBox: { backgroundColor: 'rgba(255,255,255,0.94)', border: `4px solid ${t.ring}`, boxShadow: `0 5px 0 ${alpha(c.id === 'white' ? '#C9D0DE' : c.light, 0.95)}` },
      infoLabel: { backgroundColor: t.ring, color: c.id === 'yellow' ? '#3B1530' : '#FFFFFF' },
      infoText: '#3B1530',
      infoSub: alpha('#3B1530', 0.62),
      badge: { backgroundColor: t.ring, color: c.id === 'yellow' ? '#3B1530' : '#FFFFFF', border: '4px solid #FFFFFF' },
      footText: '#3B1530',
      ribbon: { backgroundImage: `linear-gradient(180deg, ${c.id === 'white' ? '#B8C1D3' : c.base} 0%, ${c.deep} 100%)`, border: '4px solid #FFFFFF' },
      ribbonText: '#FFFFFF',
      rarity: 'CUTE',
      emblem: '♡',
      labelDeco: {
        kind: 'cute',
        bg: c.id === 'white'
          ? 'linear-gradient(180deg, #E3E7F0 0%, #B8C1D3 55%, #9AA4B8 100%)'
          : `linear-gradient(180deg, ${mixHex(c.light, c.base, 0.35)} 0%, ${c.base} 52%, ${c.deep} 100%)`,
        edge: '#FFFFFF',
        shadow: c.id === 'white' ? '#8C95AA' : c.deep,
        accent: c.id === 'white' ? '#FF8FB8' : c.base,
      },
    };
  }
  if (t.variant === 'ssr') {
    return {
      frame: RAINBOW_FOIL,
      frameEdge: '#6A4BC8',
      bevel: 'rgba(255,255,255,0.95)',
      panel: { backgroundImage: 'linear-gradient(160deg, #EFE7FF 0%, #E3F4FF 35%, #FFE6F6 65%, #EDE4FF 100%)' },
      window: { backgroundImage: `linear-gradient(135deg, #8FC8FF 0%, #C7A8FF 22%, #FFB6E6 44%, #A6F0FF 64%, #D6BCFF 82%, ${c.light} 100%)` },
      windowBorder: '#FFFFFF',
      headText: '#26164F',
      headSub: alpha('#26164F', 0.7),
      powerBox: { backgroundImage: 'linear-gradient(135deg, #FFFFFF 0%, #F1E9FF 100%)', border: '4px solid #8E6BFF' },
      powerText: '#5B34D6',
      infoBox: { backgroundColor: 'rgba(255,255,255,0.86)', border: '3px solid rgba(142,107,255,0.75)' },
      infoLabel: { backgroundImage: `linear-gradient(90deg, #7B5CFF 0%, ${c.id === 'white' ? '#9AA4B8' : c.base} 100%)`, color: '#FFFFFF' },
      infoText: '#26164F',
      infoSub: alpha('#26164F', 0.6),
      badge: { backgroundImage: 'linear-gradient(135deg, #7B5CFF 0%, #FF6FC8 100%)', color: '#FFFFFF', border: '4px solid #FFFFFF' },
      footText: '#26164F',
      ribbon: { backgroundImage: 'linear-gradient(90deg, #6B4BFF 0%, #B04BFF 50%, #FF5FB8 100%)', border: '4px solid #FFFFFF' },
      ribbonText: '#FFFFFF',
      rarity: 'SSR',
      emblem: '★',
      labelDeco: {
        kind: 'foil',
        bg: `linear-gradient(90deg, #4A23C8 0%, ${c.id === 'white' ? '#8E7BFF' : mixHex(c.base, '#7B5CFF', 0.4)} 52%, #FF4FAE 100%)`,
        edge: RAINBOW_FOIL,
        shadow: '#2A1470',
        accent: '#FFF3A6',
      },
    };
  }
  return {
    frame: GOLD_METAL,
    frameEdge: '#2A1A02',
    bevel: '#FFE9A6',
    panel: { backgroundImage: 'radial-gradient(ellipse at 50% 22%, #2B2363 0%, #15123A 48%, #08070F 100%)' },
    window: { backgroundImage: `radial-gradient(ellipse at 50% 48%, ${alpha(c.base, 0.35)} 0%, #241C55 34%, #120E2C 72%, #07060E 100%)` },
    windowBorder: '#E7C25A',
    headText: '#FFF3CF',
    headSub: alpha('#FFE7A3', 0.75),
    powerBox: { backgroundImage: 'linear-gradient(180deg, #2A2148 0%, #0E0B1E 100%)', border: '4px solid #E7C25A' },
    powerText: '#FFD978',
    infoBox: { backgroundColor: 'rgba(16,13,36,0.82)', border: '3px solid #C99A36' },
    infoLabel: { backgroundImage: GOLD_METAL, color: '#2A1A02' },
    infoText: '#FFF6DC',
    infoSub: alpha('#FFE7A3', 0.7),
    badge: { backgroundImage: GOLD_METAL, color: '#2A1A02', border: '4px solid #2A1A02' },
    footText: '#FFE7A3',
    ribbon: { backgroundImage: `linear-gradient(180deg, ${c.id === 'black' ? '#3A3A48' : c.base} 0%, ${c.deep} 100%)`, border: '4px solid #E7C25A' },
    ribbonText: c.id === 'white' || c.id === 'yellow' ? '#2A1A02' : '#FFFFFF',
    rarity: 'LEGEND',
    emblem: '★',
  };
}

// ─── 中央の窓（名前と装飾） ───────────────────────────────────────────────────────

function WindowArt({ t, k, w, h, name, phrase }: { t: Theme; k: (n: number) => number; w: number; h: number; name: string; phrase: string }) {
  const { c } = t;
  const sk = skinOf(t);
  const cx = w / 2;
  const nameTop = t.variant === 'ssr' ? h * 0.2 : h * 0.24;
  const deco: ReactElement[] = [];
  if (t.variant === 'basic') {
    const heart = c.id === 'white' ? '#FF8FB8' : c.base;
    const soft = c.id === 'white' ? '#FFC6DF' : c.light;
    deco.push(
      // 放射状の光（白）とピンクの水玉＋白の細かいドット
      <Rays key="r" w={w} h={h} cx={cx} cy={h * 0.52} count={22} color="rgba(255,255,255,0.55)" len={w} />,
      <div key="polka" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, display: 'flex', backgroundImage: `radial-gradient(circle, ${alpha(heart, 0.16)} 0%, ${alpha(heart, 0.16)} 30%, rgba(255,255,255,0) 32%)`, backgroundSize: `${k(84)}px ${k(84)}px`, backgroundPosition: '0px 0px' }} />,
      <div key="dots" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, display: 'flex', backgroundImage: `radial-gradient(circle, ${alpha('#FFFFFF', 0.85)} 0%, ${alpha('#FFFFFF', 0.85)} 22%, rgba(255,255,255,0) 24%)`, backgroundSize: `${k(42)}px ${k(42)}px`, opacity: 0.6 }} />,
      // 名前の後ろのやわらかい光
      <div key="halo" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, display: 'flex', backgroundImage: 'radial-gradient(ellipse at 50% 54%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.5) 28%, rgba(255,255,255,0) 54%)' }} />,
      <LightSpecks key="sp" w={w} h={h} count={130} seed={7} color="#FFFFFF" avoid={{ x: cx, y: h * 0.54, rx: w * 0.38, ry: h * 0.21 }} />,
      <LightSpecks key="sp2" w={w} h={h} count={40} seed={23} color={soft} avoid={{ x: cx, y: h * 0.54, rx: w * 0.38, ry: h * 0.21 }} />,
      // リボン（左右の上）
      <Bow key="b1" x={k(118)} y={k(100)} width={k(196)} color={heart} deep={c.deep} rotate={-14} />,
      <Bow key="b2" x={w - k(118)} y={k(100)} width={k(196)} color={heart} deep={c.deep} rotate={14} />,
      // ハート（大小・塗り／白抜きを混ぜる）
      <HeartShape key="h1" x={k(76)} y={h * 0.5} size={k(96)} fill={heart} stroke="#FFFFFF" rotate={-16} />,
      <HeartShape key="h2" x={w - k(74)} y={h * 0.48} size={k(84)} fill="#FFFFFF" stroke={heart} rotate={14} />,
      <HeartShape key="h3" x={k(168)} y={h * 0.85} size={k(62)} fill="#FFFFFF" stroke={heart} rotate={10} />,
      <HeartShape key="h4" x={w - k(170)} y={h * 0.86} size={k(70)} fill={heart} stroke="#FFFFFF" rotate={-12} />,
      <HeartShape key="h5" x={w * 0.27} y={h * 0.1} size={k(46)} fill={heart} stroke="#FFFFFF" rotate={-8} />,
      <HeartShape key="h6" x={w * 0.74} y={h * 0.09} size={k(40)} fill="#FFFFFF" stroke={heart} rotate={12} />,
      <HeartShape key="h7" x={w * 0.36} y={h * 0.2} size={k(30)} fill={soft} stroke="#FFFFFF" rotate={-14} />,
      <HeartShape key="h8" x={w * 0.66} y={h * 0.21} size={k(34)} fill={heart} rotate={10} />,
      <HeartShape key="h9" x={k(46)} y={h * 0.7} size={k(40)} fill={soft} stroke="#FFFFFF" rotate={-6} />,
      <HeartShape key="h10" x={w - k(48)} y={h * 0.68} size={k(36)} fill={heart} rotate={8} />,
      // 星とキラキラ
      <StarShape key="s1" x={k(58)} y={h * 0.31} size={k(54)} fill="#FFE36E" stroke="#FFFFFF" rotate={-10} />,
      <StarShape key="s2" x={w - k(54)} y={h * 0.76} size={k(56)} fill="#FFE36E" stroke="#FFFFFF" rotate={12} />,
      <StarShape key="s3" x={w * 0.17} y={h * 0.24} size={k(30)} fill="#FFFFFF" stroke={heart} rotate={6} />,
      <StarShape key="s4" x={w * 0.84} y={h * 0.25} size={k(30)} fill="#FFE36E" stroke="#FFFFFF" rotate={-6} />,
      <StarShape key="s5" x={w * 0.3} y={h * 0.9} size={k(28)} fill="#FFE36E" stroke="#FFFFFF" />,
      <StarShape key="s6" x={w * 0.7} y={h * 0.92} size={k(26)} fill="#FFFFFF" stroke={heart} />,
      <Sparkle key="k1" x={w - k(66)} y={h * 0.31} size={k(64)} color="#FFFFFF" glow="rgba(255,255,255,0.6)" />,
      <Sparkle key="k2" x={k(66)} y={h * 0.76} size={k(56)} color="#FFFFFF" glow="rgba(255,255,255,0.6)" />,
      <Sparkle key="k3" x={w * 0.5} y={h * 0.94} size={k(40)} color="#FFFFFF" />,
      <Sparkle key="k4" x={w * 0.2} y={h * 0.14} size={k(36)} color="#FFFFFF" />,
      <Sparkle key="k5" x={w * 0.81} y={h * 0.15} size={k(40)} color="#FFFFFF" />,
    );
  } else if (t.variant === 'ssr') {
    deco.push(
      <div key="stripes" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, display: 'flex', backgroundImage: 'repeating-linear-gradient(115deg, rgba(255,255,255,0) 0px, rgba(255,255,255,0.32) 26px, rgba(255,255,255,0) 52px, rgba(255,255,255,0) 110px)' }} />,
      // ホログラム：面の切り替わり・虹色の反射の帯
      <Facets key="fc" w={w} h={h} />,
      <div key="rainbow" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, display: 'flex', backgroundImage: 'linear-gradient(105deg, rgba(255,255,255,0) 8%, rgba(255,120,200,0.26) 18%, rgba(255,226,120,0.26) 25%, rgba(130,235,255,0.28) 32%, rgba(180,140,255,0.22) 39%, rgba(255,255,255,0) 48%, rgba(255,255,255,0) 62%, rgba(130,235,255,0.22) 72%, rgba(255,140,220,0.22) 80%, rgba(255,255,255,0) 90%)' }} />,
      <div key="burst" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, display: 'flex', backgroundImage: 'radial-gradient(ellipse at 50% 46%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.55) 22%, rgba(255,255,255,0) 58%)' }} />,
      <LightSpecks key="sp" w={w} h={h} count={150} seed={11} color="#FFFFFF" avoid={{ x: cx, y: h * 0.5, rx: w * 0.4, ry: h * 0.2 }} />,
      <LightSpecks key="sp2" w={w} h={h} count={50} seed={31} color="#FFF3A6" avoid={{ x: cx, y: h * 0.5, rx: w * 0.4, ry: h * 0.2 }} />,
      <LightSpecks key="sp3" w={w} h={h} count={40} seed={47} color="#C9F1FF" avoid={{ x: cx, y: h * 0.5, rx: w * 0.4, ry: h * 0.2 }} />,
      <Rays key="r" w={w} h={h} cx={cx} cy={h * 0.46} count={28} color="rgba(255,255,255,0.3)" len={w} />,
      <LightTrails key="lt" w={w} h={h} color={c.id === 'white' ? '#B9A4FF' : c.base} />,
      <Gem key="g0" x={cx} y={h * 0.11} size={k(96)} color={c.id === 'white' ? '#E7ECF7' : c.base} light={c.light} deep={c.id === 'white' ? c.deep : c.deep} />,
      <Sparkle key="k0" x={cx + k(62)} y={h * 0.07} size={k(46)} color="#FFFFFF" />,
      <Sparkle key="k1" x={k(92)} y={h * 0.16} size={k(84)} color="#FFFFFF" glow="rgba(255,255,255,0.6)" />,
      <Sparkle key="k2" x={w - k(120)} y={h * 0.2} size={k(62)} color="#FFFFFF" />,
      <Sparkle key="k3" x={k(70)} y={h * 0.62} size={k(50)} color="#FFF7C2" />,
      <Sparkle key="k4" x={w - k(70)} y={h * 0.58} size={k(92)} color="#FFFFFF" glow="rgba(255,255,255,0.6)" />,
      <Sparkle key="k5" x={k(200)} y={h * 0.9} size={k(44)} color="#FFFFFF" />,
      <Sparkle key="k6" x={w - k(220)} y={h * 0.9} size={k(56)} color="#FFF7C2" />,
      <StarShape key="s1" x={k(170)} y={h * 0.08} size={k(40)} fill="#FFF3A6" rotate={12} />,
      <StarShape key="s2" x={w - k(190)} y={h * 0.1} size={k(34)} fill="#FFFFFF" rotate={-8} />,
      <StarShape key="s3" x={k(54)} y={h * 0.42} size={k(30)} fill="#FFFFFF" />,
      <StarShape key="s4" x={w - k(44)} y={h * 0.84} size={k(36)} fill="#FFF3A6" />,
      <Gem key="g1" x={k(110)} y={h * 0.78} size={k(58)} color="#9EE7FF" light="#FFFFFF" deep="#3A7BD5" />,
      // 名前と重ならない右上の角へ
      <Gem key="g2" x={w - k(64)} y={h * 0.085} size={k(52)} color="#FFB6E6" light="#FFFFFF" deep="#C2368F" />,
    );
  } else {
    const accentGlow = c.id === 'black' ? 'rgba(255,215,120,0.18)' : alpha(c.base, 0.32);
    deco.push(
      <Rays key="r" w={w} h={h} cx={cx} cy={h * 0.5} count={32} color="rgba(255,214,120,0.1)" len={w} />,
      <div key="glow" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, display: 'flex', backgroundImage: `radial-gradient(ellipse at 50% 52%, ${accentGlow} 0%, rgba(0,0,0,0) 55%)` }} />,
      <Laurel key="l1" x={cx - w * 0.36} y={h * 0.2} height={h * 0.72} side={-1} color="#E3B848" vein="#7A5410" />,
      <Laurel key="l2" x={cx + w * 0.36} y={h * 0.2} height={h * 0.72} side={1} color="#E3B848" vein="#7A5410" />,
      <StarShape key="s1" x={k(80)} y={h * 0.12} size={k(48)} fill="#F4CF63" rotate={-8} />,
      <StarShape key="s2" x={w - k(80)} y={h * 0.12} size={k(48)} fill="#F4CF63" rotate={8} />,
      <StarShape key="s3" x={k(150)} y={h * 0.06} size={k(26)} fill="#FFF0B8" />,
      <StarShape key="s4" x={w - k(150)} y={h * 0.06} size={k(26)} fill="#FFF0B8" />,
      <Sparkle key="k1" x={w - k(150)} y={h * 0.86} size={k(64)} color="#FFE7A3" />,
      <Sparkle key="k2" x={k(140)} y={h * 0.88} size={k(48)} color="#FFE7A3" />,
      <Sparkle key="k3" x={w * 0.5 + k(250)} y={h * 0.18} size={k(36)} color="#FFFFFF" />,
      <Sparkle key="k4" x={w * 0.5 - k(260)} y={h * 0.2} size={k(30)} color="#FFFFFF" />,
      <Gem key="g1" x={k(56)} y={h * 0.5} size={k(48)} color={c.id === 'yellow' ? '#E04A6A' : c.base} light={c.light} deep={c.deep} />,
      <Gem key="g2" x={w - k(56)} y={h * 0.5} size={k(48)} color={c.id === 'yellow' ? '#E04A6A' : c.base} light={c.light} deep={c.deep} />,
    );
  }

  const crownW = t.variant === 'legend' ? k(190) : k(t.variant === 'basic' ? 168 : 130);
  const nameW = w - k(t.variant === 'legend' ? 230 : t.variant === 'basic' ? 210 : 120);
  // A（ベーシック）：名前を約1割小さくして余白を取り、名前の実際の高さに合わせて王冠を名前のすぐ上に置く
  const basic = t.variant === 'basic';
  const nameMax = k(t.variant === 'legend' ? 250 : basic ? 250 : 290);
  const nameMaxH = basic ? h * 0.52 : h * 0.6;
  const nameLayout = layoutTcgName(name, nameW, nameMax, k(78), nameMaxH);
  const nameH = Math.round(nameLayout.font * 1.12) * nameLayout.lines.length + Math.round(nameLayout.font * 0.2);
  const boxTop = basic ? Math.round(h * 0.54 - nameH / 2) : nameTop;
  const boxH = basic ? nameH : h * 0.6;
  // 縁取りを含めた文字の上端 ≒ 箱の上端＋0.1em。王冠の下端をそこへ少し重ねる
  const crownY = basic ? boxTop + nameLayout.font * 0.08 + k(14) - crownW * 0.72 : nameTop - crownW * 0.78;
  // B（SSR）：名前のまわりの控えめな光の反射（横に伸びる光の帯・文字の外側の角のキラッ）
  const ssrGlints: ReactElement[] = [];
  if (t.variant === 'ssr') {
    const lineH = Math.round(nameLayout.font * 1.12);
    const textHalfW = Math.min(w / 2 - k(30), (Math.max(...nameLayout.lines.map((l) => emWidth(l))) * nameLayout.font) / 2 + nameLayout.font * 0.12);
    const ny = nameTop + (h * 0.6) / 2;
    const textHalfH = (lineH * nameLayout.lines.length) / 2;
    ssrGlints.push(
      <div key="streak" style={{ position: 'absolute', left: 0, top: ny - k(70), width: w, height: k(140), display: 'flex', backgroundImage: 'radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.28) 30%, rgba(255,255,255,0) 62%)' }} />,
      <Sparkle key="gl1" x={Math.max(k(36), cx - textHalfW - k(4))} y={ny - textHalfH + k(6)} size={k(58)} color="#FFFFFF" glow="rgba(255,255,255,0.55)" />,
      <Sparkle key="gl2" x={Math.min(w - k(36), cx + textHalfW + k(6))} y={ny + textHalfH - k(4)} size={k(50)} color="#FFFFFF" glow="rgba(255,255,255,0.55)" />,
      <Sparkle key="gl3" x={Math.min(w - k(30), cx + textHalfW - k(4))} y={ny - textHalfH - k(4)} size={k(30)} color="#E9F8FF" />,
      <Sparkle key="gl4" x={Math.max(k(30), cx - textHalfW + k(20))} y={ny + textHalfH + k(8)} size={k(34)} color="#FFF7C2" />,
      <StarShape key="gl5" x={cx - textHalfW * 0.45} y={ny - textHalfH - k(22)} size={k(26)} fill="#FFFFFF" />,
      <StarShape key="gl6" x={cx + textHalfW * 0.5} y={ny + textHalfH + k(22)} size={k(24)} fill="#FFF3A6" />,
      <Sparkle key="gl7" x={cx + textHalfW * 0.15} y={ny - textHalfH - k(26)} size={k(28)} color="#FFFFFF" />,
    );
  }
  const phraseFont = Math.min(k(40), Math.floor((w * 0.62) / Math.max(1, emWidth(phrase))));
  return (
    <div style={{ position: 'relative', display: 'flex', width: w, height: h, overflow: 'hidden', ...sk.window }}>
      {deco}
      {ssrGlints}
      {basic && <Sparkle x={cx - crownW * 0.72} y={crownY + crownW * 0.22} size={k(46)} color="#FFFFFF" glow="rgba(255,255,255,0.7)" />}
      {basic && <Sparkle x={cx + crownW * 0.7} y={crownY + crownW * 0.1} size={k(36)} color="#FFF7C2" />}
      {t.variant !== 'ssr' && <Crown x={cx} y={crownY} width={crownW} gem={t.variant === 'legend' ? (c.id === 'yellow' ? '#E04A6A' : c.base) : (c.id === 'white' ? '#FF8FB8' : c.base)} dark={t.variant === 'legend'} {...(basic ? { outline: '#FFFFFF' } : {})} />}
      <div style={{ position: 'absolute', left: (w - nameW) / 2, top: boxTop, width: nameW, height: boxH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FancyName name={name} width={nameW} maxFont={nameMax} minFont={k(78)} maxHeight={nameMaxH} t={t} />
      </div>
      {/* ひとこと（既存の定型フレーズ）をリボンの帯に */}
      <div style={{ position: 'absolute', left: 0, bottom: k(28), width: w, display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: `${k(10)}px ${k(40)}px`, borderRadius: k(999), fontSize: phraseFont, fontWeight: 700, color: sk.ribbonText, boxShadow: `0 ${k(6)}px 0 ${alpha('#000000', 0.18)}`, ...sk.ribbon }}>{`${t.variant === 'legend' ? '★' : '♡'} ${phrase} ${t.variant === 'legend' ? '★' : '♡'}`}</div>
      </div>
    </div>
  );
}

// ─── カード本体 ───────────────────────────────────────────────────────────────

/** 下部の見出しラベル。A＝ぷっくりしたデコカプセル（白フチ・ツヤ・ハート）、B＝虹色フチの豪華なラベル（ツヤ・星）。C は従来どおり */
function SectionLabel({ k, sk, text, width, padX = 26 }: { k: (n: number) => number; sk: Skin; text: string; width?: number; padX?: number }) {
  const d = sk.labelDeco;
  if (!d) {
    return width !== undefined
      ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width, height: k(62), borderRadius: k(999), fontSize: k(30), fontWeight: 700, letterSpacing: k(2), ...sk.infoLabel }}>{text}</div>
      : <div style={{ display: 'flex', alignItems: 'center', padding: `${k(6)}px ${k(26)}px`, borderRadius: k(999), fontSize: k(30), fontWeight: 700, letterSpacing: k(2), ...sk.infoLabel }}>{text}</div>;
  }
  const H = k(64);
  const edge = k(d.kind === 'foil' ? 4 : 4);
  const inner = (
    <div style={{ display: 'flex', position: 'relative', alignItems: 'center', justifyContent: 'center', ...(width !== undefined ? { width: width - edge * 2 } : { padding: `0 ${k(padX)}px` }), height: H - edge * 2, borderRadius: k(999), backgroundImage: d.bg, overflow: 'hidden' }}>
      {/* ツヤ（上半分の白い光） */}
      <div style={{ position: 'absolute', left: k(12), right: k(12), top: k(3), height: Math.round((H - edge * 2) * 0.42), display: 'flex', borderRadius: k(999), backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.15) 100%)' }} />
      <div style={{ display: 'flex', fontSize: k(30), fontWeight: 700, letterSpacing: k(2), color: '#FFFFFF', textShadow: `0 ${k(2)}px 0 ${d.shadow}` }}>{text}</div>
    </div>
  );
  const iconSize = k(d.kind === 'foil' ? 34 : 32);
  return (
    <div style={{ display: 'flex', position: 'relative', flexShrink: 0 }}>
      <div style={{ display: 'flex', padding: edge, borderRadius: k(999), ...(d.kind === 'foil' ? { backgroundImage: d.edge, boxShadow: `0 ${k(4)}px 0 ${d.shadow}, 0 0 ${k(12)}px rgba(255,140,230,0.55)` } : { backgroundColor: d.edge, boxShadow: `0 ${k(4)}px 0 ${d.shadow}` }) }}>{inner}</div>
      {/* 右上の小さなハート（A）／キラキラ（B） */}
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" style={{ position: 'absolute', right: -k(8), top: -k(10) }}>
        {d.kind === 'cute'
          ? <path d={HEART_D} fill={d.accent} stroke="#FFFFFF" strokeWidth="2.2" strokeLinejoin="round" />
          : <path d={SPARKLE_D} fill={d.accent} stroke="#FFFFFF" strokeWidth="1.2" />}
      </svg>
    </div>
  );
}

function InfoRow({ k, sk, label, text, width }: { k: (n: number) => number; sk: Skin; label: string; text: string; width: number }) {
  const labelW = k(210);
  const textW = width - labelW - k(56);
  const font = Math.max(k(30), Math.min(k(46), Math.floor(textW / Math.max(1, emWidth(text) + 0.2))));
  return (
    <div style={{ display: 'flex', alignItems: 'center', width, height: k(96), padding: `0 ${k(16)}px`, borderRadius: k(22), ...sk.infoBox }}>
      <SectionLabel k={k} sk={sk} text={label} width={labelW} />
      <div style={{ display: 'flex', flex: 1, justifyContent: 'center', fontSize: font, fontWeight: 700, color: sk.infoText, whiteSpace: 'nowrap' }}>{text}</div>
    </div>
  );
}

function WorksBox({ k, sk, works, width, height }: { k: (n: number) => number; sk: Skin; works: OshiCardImageWork[]; width: number; height: number }) {
  const n = works.length;
  const headH = k(58);
  const rowsH = height - headH - k(36);
  const badge = k(n === 3 ? 52 : 60);
  const textW = width - k(40) - badge - k(20);
  const titleMax = n === 1 ? k(48) : n === 2 ? k(40) : k(36);
  const lines = n === 3 ? 1 : 2;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width, height, padding: `${k(16)}px ${k(20)}px ${k(20)}px`, borderRadius: k(22), ...sk.infoBox }}>
      <div style={{ display: 'flex', alignItems: 'center', height: headH, gap: k(14) }}>
        <SectionLabel k={k} sk={sk} text="おすすめ出演作品" />
        {n > 0 && <div style={{ display: 'flex', fontSize: k(24), fontWeight: 700, color: sk.infoSub }}>{`投稿者のおすすめ ${n}作品`}</div>}
      </div>
      {n === 0 ? (
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', fontSize: k(34), fontWeight: 700, color: sk.infoSub }}>出演作品は推しサーチでチェック！</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', height: rowsH, marginTop: k(8) }}>
          {works.map((w, i) => {
            // 1行に収まる作品名は分類・公開年も添える。2行になる作品名（2作品のとき）は作品名だけ
            const oneLine = fitTitle(w.title, textW, titleMax, Math.round(titleMax * 0.78), 1);
            const fitsOne = oneLine.text === w.title;
            const showMeta = n === 1 || (n === 2 && fitsOne);
            const { text, font } = n === 2 && fitsOne ? oneLine : fitTitle(w.title, textW, titleMax, Math.round(titleMax * 0.62), lines);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: k(20) }}>
                <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', width: badge, height: badge, borderRadius: badge / 2, fontSize: Math.round(badge * 0.5), fontWeight: 700, ...sk.badge }}>{i + 1}</div>
                <div style={{ display: 'flex', flexDirection: 'column', width: textW }}>
                  <div style={{ display: 'flex', fontSize: font, fontWeight: 700, lineHeight: 1.2, color: sk.infoText }}>{text}</div>
                  {showMeta && <div style={{ display: 'flex', fontSize: k(24), fontWeight: 700, color: sk.infoSub }}>{w.year ? `${w.typeLabel}・${w.year}` : w.typeLabel}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Rarity({ t, k, label }: { t: Theme; k: (n: number) => number; label: string }) {
  if (t.variant === 'ssr') {
    // B：虹色のフチ・発光・ツヤ・キラキラで目立たせる（幅は従来とほぼ同じ）
    return (
      <div style={{ display: 'flex', position: 'relative', flexShrink: 0 }}>
        <div style={{ display: 'flex', padding: k(5), borderRadius: k(28), backgroundImage: RAINBOW_FOIL, boxShadow: `0 0 ${k(18)}px rgba(255,120,220,0.75), 0 ${k(5)}px 0 #2A1470` }}>
          <div style={{ display: 'flex', position: 'relative', alignItems: 'center', justifyContent: 'center', height: k(96), padding: `0 ${k(18)}px`, borderRadius: k(23), backgroundImage: 'linear-gradient(135deg, #3A1AA8 0%, #8A3BE8 45%, #FF4FA8 100%)', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'flex', backgroundImage: 'linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.35) 42%, rgba(255,255,255,0) 54%)' }} />
            <div style={{ position: 'absolute', left: k(8), right: k(8), top: k(4), height: k(36), display: 'flex', borderRadius: k(18), backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.05) 100%)' }} />
            <div style={{ display: 'flex', fontSize: k(66), fontWeight: 700, letterSpacing: k(1), color: '#FFFFFF', textShadow: `0 ${k(4)}px 0 #2A0E6B, 0 0 ${k(14)}px rgba(255,236,150,0.95)` }}>{label}</div>
          </div>
        </div>
        <svg width={k(46)} height={k(46)} viewBox="0 0 24 24" style={{ position: 'absolute', right: -k(14), top: -k(16) }}><path d={SPARKLE_D} fill="#FFF7C2" stroke="#FFFFFF" strokeWidth="1" /></svg>
        <svg width={k(28)} height={k(28)} viewBox="0 0 24 24" style={{ position: 'absolute', left: -k(10), bottom: -k(8) }}><path d={SPARKLE_D} fill="#FFFFFF" /></svg>
      </div>
    );
  }
  // A・C（従来どおり）
  const bg = t.variant === 'legend' ? GOLD_METAL : `linear-gradient(135deg, ${t.c.id === 'white' ? '#B8C1D3' : t.c.base} 0%, ${t.c.deep} 100%)`;
  return (
    <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', height: k(96), padding: `0 ${k(18)}px`, borderRadius: k(24), backgroundImage: bg, border: `${k(5)}px solid ${t.variant === 'legend' ? '#2A1A02' : '#FFFFFF'}`, boxShadow: `0 ${k(4)}px 0 ${alpha('#000000', 0.2)}` }}>
      <div style={{ display: 'flex', fontSize: k(t.variant === 'legend' ? 36 : 40), fontWeight: 700, letterSpacing: k(2), color: t.variant === 'legend' ? '#2A1A02' : '#FFFFFF' }}>{label}</div>
    </div>
  );
}

/**
 * 白いレース（角を丸く覆う雲形）。中心 (cx, cy) から半径 r の扇形を、ふちに波（スカラップ）・小さな穴（アイレット）・
 * 内側の刺しゅうの点の列で飾る。from〜to は角度（度、0＝右・90＝下）
 */
function LaceArc({ w, h, cx, cy, r, from, to, hole }: { w: number; h: number; cx: number; cy: number; r: number; from: number; to: number; hole: string }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const at = (deg: number, rr: number) => [cx + rr * Math.cos(rad(deg)), cy + rr * Math.sin(rad(deg))];
  const items: ReactElement[] = [];
  const [sx, sy] = at(from, r);
  const [ex, ey] = at(to, r);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const span = Math.abs(to - from);
  // 細かな波（小さなスカラップ）。外側に淡いピンクの細い輪郭を出して、白い本体を重ねる
  const scallops = Math.max(10, Math.round(((span / 180) * Math.PI * r) / (r * 0.07)));
  const sr = (Math.abs(rad(to - from)) * r) / scallops / 2;
  const sw = Math.max(1, r * 0.006);
  for (let i = 0; i <= scallops; i++) {
    const [px, py] = at(from + ((to - from) * i) / scallops, r);
    items.push(<circle key={`e${i}`} cx={px} cy={py} r={sr * 1.08 + sw * 1.4} fill={hole} />);
  }
  items.push(<path key="body" d={`M ${cx} ${cy} L ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey} Z`} fill="rgba(255,255,255,0.92)" />);
  for (let i = 0; i <= scallops; i++) {
    const deg = from + ((to - from) * i) / scallops;
    const [px, py] = at(deg, r);
    items.push(<circle key={`s${i}`} cx={px} cy={py} r={sr * 1.08} fill="rgba(255,255,255,0.95)" />);
    // 波ごとの小さな穴（アイレット）
    items.push(<circle key={`h${i}`} cx={px} cy={py} r={sr * 0.3} fill={hole} />);
  }
  // 細い線の輪（2本）と、その間の細かな穴の列
  const arc = (rr: number) => {
    const [ax, ay] = at(from, rr);
    const [bx, by] = at(to, rr);
    return `M ${ax} ${ay} A ${rr} ${rr} 0 ${large} 1 ${bx} ${by}`;
  };
  items.push(<path key="l1" d={arc(r * 0.84)} stroke={hole} strokeWidth={sw} fill="none" />);
  items.push(<path key="l2" d={arc(r * 0.72)} stroke={hole} strokeWidth={sw} fill="none" />);
  const dots = Math.round(scallops * 1.6);
  for (let i = 0; i <= dots; i++) {
    const [qx, qy] = at(from + ((to - from) * i) / dots, r * 0.78);
    items.push(<circle key={`q${i}`} cx={qx} cy={qy} r={sr * 0.16} fill={hole} />);
  }
  // 花びら形の透かし（放射状の細長い穴）と、内側の網目（細かな点の格子）
  const petals = Math.round(scallops * 0.7);
  for (let i = 0; i < petals; i++) {
    const deg = from + ((to - from) * (i + 0.5)) / petals;
    const [px, py] = at(deg, r * 0.6);
    items.push(<ellipse key={`p${i}`} cx={px} cy={py} rx={r * 0.075} ry={r * 0.022} fill="none" stroke={hole} strokeWidth={sw} transform={`rotate(${deg} ${px} ${py})`} />);
  }
  for (const ring of [0.46, 0.38, 0.3, 0.22]) {
    const nDots = Math.max(4, Math.round((span / 180) * Math.PI * ring / 0.06));
    for (let i = 0; i <= nDots; i++) {
      const [mx, my] = at(from + ((to - from) * i) / nDots, r * ring);
      items.push(<circle key={`m${ring}-${i}`} cx={mx} cy={my} r={r * 0.008} fill={hole} />);
    }
  }
  return <Svg w={w} h={h} view={`0 0 ${w} ${h}`} style={{ left: 0, top: 0 }}>{items}</Svg>;
}

/** サテンのリボン（ふくらんだ輪・折り目の影・結び目・切り込みのある垂れ・ツヤ） */
function SatinBow({ x, y, width, main, light, deep }: { x: number; y: number; width: number; main: string; light: string; deep: string }) {
  // 参考デザインAの淡いピンクのサテン：ふっくらした丸い輪・やわらかな折り目・短い垂れ
  const h = width * 0.62;
  const hi = mixHex(light, '#FFFFFF', 0.6);
  const mid = mixHex(light, '#FFFFFF', 0.15);
  const shade = mixHex(light, main, 0.45);
  const line = alpha(mixHex(main, deep, 0.3), 0.6);
  return (
    <Svg w={width} h={h} view="0 0 200 124" style={{ left: x - width / 2, top: y - h * 0.4 }}>
      <defs>
        <linearGradient id="sbl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={hi} />
          <stop offset="0.5" stopColor={mid} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
        <linearGradient id="sbt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mid} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
      </defs>
      {/* 短い垂れ（先に V 字の切り込み） */}
      <path d="M93 60 C86 78 76 96 62 116 L74 111 L80 121 C92 102 100 82 104 62 Z" fill="url(#sbt)" stroke={line} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M107 60 C114 78 124 96 138 116 L126 111 L120 121 C108 102 100 82 96 62 Z" fill="url(#sbt)" stroke={line} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M92 70 C88 84 80 98 72 108" stroke="rgba(255,255,255,0.75)" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      {/* 左右のふっくらした輪 */}
      <path d="M95 48 C78 14 30 4 12 24 C-2 42 10 74 44 76 C64 77 84 66 95 58 Z" fill="url(#sbl)" stroke={line} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M105 48 C122 14 170 4 188 24 C202 42 190 74 156 76 C136 77 116 66 105 58 Z" fill="url(#sbl)" stroke={line} strokeWidth="1.6" strokeLinejoin="round" />
      {/* 輪の内側の折り目（やわらかい影） */}
      <path d="M92 50 C76 36 52 32 34 40 C52 40 72 46 90 58 Z" fill={alpha(main, 0.22)} />
      <path d="M108 50 C124 36 148 32 166 40 C148 40 128 46 110 58 Z" fill={alpha(main, 0.22)} />
      <path d="M92 56 C76 62 56 66 38 64" stroke={alpha(main, 0.3)} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M108 56 C124 62 144 66 162 64" stroke={alpha(main, 0.3)} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* サテンのツヤ */}
      <path d="M18 28 C30 12 58 12 78 26" stroke="rgba(255,255,255,0.95)" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M182 28 C170 12 142 12 122 26" stroke="rgba(255,255,255,0.9)" strokeWidth="4.4" fill="none" strokeLinecap="round" />
      <ellipse cx="22" cy="46" rx="6" ry="3.4" fill="rgba(255,255,255,0.8)" transform="rotate(-50 22 46)" />
      <ellipse cx="178" cy="46" rx="5" ry="3" fill="rgba(255,255,255,0.7)" transform="rotate(50 178 46)" />
      {/* 結び目 */}
      <rect x="87" y="40" width="26" height="26" rx="10" fill="url(#sbl)" stroke={line} strokeWidth="1.6" />
      <path d="M91 46 C96 43 104 43 109 46" stroke="rgba(255,255,255,0.95)" strokeWidth="2.8" fill="none" strokeLinecap="round" />
    </Svg>
  );
}

/** 作品欄の見出しのカチンコ */
function Clapper({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect x="2" y="9" width="20" height="13" rx="2" fill="#FFFFFF" />
      <path d="M2 4.5 L21 2 L21.6 6.6 L2.6 9 Z" fill="#FFFFFF" />
      <path d="M6 4 L8.5 8.4 M11 3.3 L13.5 7.7 M16 2.6 L18.5 7" stroke={color} strokeWidth="1.8" />
      <rect x="5" y="13" width="14" height="2" rx="1" fill={color} />
      <rect x="5" y="17" width="9" height="2" rx="1" fill={color} />
    </svg>
  );
}

/** つやのあるサテンのハートの輪（名前の後ろ）。下の先はリボンで隠れる */
const BASIC_HEART_RING_D = 'M100 136 C44 106 8 76 8 44 C8 19 27 6 51 6 C73 6 90 18 100 34 C110 18 127 6 149 6 C173 6 192 19 192 44 C192 76 156 106 100 136 Z';
function SatinHeartRing({ x, y, w, h, main, light, deep }: { x: number; y: number; w: number; h: number; main: string; light: string; deep: string }) {
  // 幅はそのままに高さだけ合わせる（縦につぶした横長のハート）
  const f = h / w / 0.71;
  return (
    <Svg w={w} h={h} view={`0 0 200 ${142 * f}`} style={{ left: x, top: y }}>
      <defs>
        <linearGradient id="bhr" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mixHex(light, '#FFFFFF', 0.3)} />
          <stop offset="0.5" stopColor={mixHex(light, main, 0.4)} />
          <stop offset="1" stopColor={mixHex(main, light, 0.2)} />
        </linearGradient>
      </defs>
      <g transform={`scale(1 ${f.toFixed(4)})`}>
        <path d={BASIC_HEART_RING_D} fill="none" stroke={alpha(deep, 0.25)} strokeWidth="11" strokeLinejoin="round" transform="translate(0 2)" />
        <path d={BASIC_HEART_RING_D} fill="none" stroke="url(#bhr)" strokeWidth="9" strokeLinejoin="round" />
        <path d={BASIC_HEART_RING_D} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.2" strokeLinejoin="round" transform="translate(0 -2.2)" />
      </g>
    </Svg>
  );
}

// ─── A（ベーシック）：参考デザインA（~/Desktop/oshi-card-exact-reference-A.png）に合わせた専用レイアウト ─────────
// トレカの構造：上＝主役の名前を見せる「名前面」（枠付きの窓）、下＝特性・沼ポイント・作品欄の「情報面」（枠付きの説明欄）。
// 上：「推し」タグ・人物名・推し力（HP風）とハートの1本のヘッダーバー
// 名前面：サテンのハートの輪・王冠・丸ゴシックのぷっくりした名前・大きな淡いピンクのリボン・レース・斜めのチェック柄・ハート・きらめき・光沢
// 情報面：特性（カプセルの見出し）→ 区切り線 → 沼ポイント（ハート3つ）→ 作品欄（リボンの見出し＋箇条書き）
// ─── A の多層 SVG パーツ（参考デザインAの質感：ガラスのような光沢の枠・やわらかな光・淡いチェック柄） ─────────

/** 角の丸い長方形のパス */
function rrPath(x: number, y: number, w: number, h: number, r: number): string {
  return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}

/**
 * カードの外枠（ピンクの帯）。外側の濃い線・帯のグラデーション・ガラスのような斜めの反射（ぼかし）・左上の白い光の縁・内側の線。
 * 帯の内側（本体）は描かない（本体の div を上に重ねる）
 */
function GlossFrame({ w, h, r, band, main, light }: { w: number; h: number; r: number; band: number; main: string; light: string }) {
  const outer = rrPath(0, 0, w, h, r);
  const inner = rrPath(band, band, w - band * 2, h - band * 2, Math.max(1, r - band * 0.8));
  const ring = `${outer} ${inner}`;
  const base = mixHex(light, main, 0.28);
  const edge = mixHex(main, light, 0.35);
  const blur = Math.max(1, Math.round(band * 0.25));
  return (
    <Svg w={w} h={h} view={`0 0 ${w} ${h}`} style={{ left: 0, top: 0 }}>
      <defs>
        <linearGradient id="gfb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={mixHex(base, '#FFFFFF', 0.45)} />
          <stop offset="0.22" stopColor={base} />
          <stop offset="0.45" stopColor={mixHex(base, '#FFFFFF', 0.35)} />
          <stop offset="0.7" stopColor={base} />
          <stop offset="1" stopColor={mixHex(base, main, 0.25)} />
        </linearGradient>
        <filter id="gfx" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation={blur} /></filter>
        <clipPath id="gfc"><path d={ring} fillRule="evenodd" /></clipPath>
      </defs>
      <path d={ring} fillRule="evenodd" fill="url(#gfb)" />
      <g clipPath="url(#gfc)">
        {/* ガラスのような斜めの反射（幅の広い光の帯をぼかす） */}
        <g filter="url(#gfx)">
          <path d={`M ${w * 0.18} 0 L ${w * 0.34} 0 L ${w * 0.02} ${h * 0.42} L ${-w * 0.14} ${h * 0.42} Z`} fill="rgba(255,255,255,0.6)" />
          <path d={`M ${w * 1.02} ${h * 0.5} L ${w * 1.12} ${h * 0.5} L ${w * 0.72} ${h} L ${w * 0.62} ${h} Z`} fill="rgba(255,255,255,0.45)" />
          {/* 左上の白い光の縁・右下のわずかな陰り（帯のふくらみ） */}
          <path d={rrPath(band * 0.3, band * 0.3, w - band * 0.6, h - band * 0.6, r - band * 0.3)} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={band * 0.22} transform={`translate(${-band * 0.12} ${-band * 0.12})`} />
          <path d={rrPath(band * 0.7, band * 0.7, w - band * 1.4, h - band * 1.4, r - band * 0.7)} fill="none" stroke={alpha(main, 0.3)} strokeWidth={band * 0.2} transform={`translate(${band * 0.12} ${band * 0.12})`} />
        </g>
      </g>
      {/* 帯のふくらみ：上側のくっきりした白い光の線と、内側の段差の濃い線（立体感） */}
      <path d={rrPath(band * 0.38, band * 0.38, w - band * 0.76, h - band * 0.76, r - band * 0.35)} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={Math.max(1, band * 0.07)} />
      <path d={rrPath(band * 0.92, band * 0.92, w - band * 1.84, h - band * 1.84, Math.max(1, r - band * 0.8))} fill="none" stroke={alpha(mixHex(main, '#8A1446', 0.2), 0.55)} strokeWidth={Math.max(1, band * 0.09)} />
      <path d={rrPath(1, 1, w - 2, h - 2, r)} fill="none" stroke={edge} strokeWidth={Math.max(1, band * 0.1)} />
      <path d={rrPath(band * 0.18, band * 0.18, w - band * 0.36, h - band * 0.36, r - band * 0.15)} fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth={Math.max(1, band * 0.06)} />
    </Svg>
  );
}

/** 本体の内側の縁：濃いピンクの細線・白い細線と、内側へにじむ影（奥行き）。本体の上に重ねる */
function InnerBevel({ w, h, r, main }: { w: number; h: number; r: number; main: string }) {
  const sw = Math.max(1, Math.round(w * 0.0028));
  return (
    <Svg w={w} h={h} view={`0 0 ${w} ${h}`} style={{ left: 0, top: 0 }}>
      <defs>
        <filter id="ibx" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation={Math.round(w * 0.006)} /></filter>
        <clipPath id="ibc"><path d={rrPath(0, 0, w, h, r)} /></clipPath>
      </defs>
      <g clipPath="url(#ibc)">
        <path d={rrPath(0, 0, w, h, r)} fill="none" stroke={alpha(main, 0.35)} strokeWidth={w * 0.014} filter="url(#ibx)" />
      </g>
      <path d={rrPath(sw / 2, sw / 2, w - sw, h - sw, r)} fill="none" stroke={mixHex(main, '#FFFFFF', 0.3)} strokeWidth={sw} />
      <path d={rrPath(sw * 1.5, sw * 1.5, w - sw * 3, h - sw * 3, Math.max(1, r - sw))} fill="none" stroke="rgba(255,255,255,0.95)" strokeWidth={sw} />
    </Svg>
  );
}

/** やわらかな光：名前の後ろの白い光のにじみ・ぼけた光の玉・面全体の斜めのガラスの反射（すべてぼかし） */
function SoftLights({ w, h, bloom, spots }: { w: number; h: number; bloom: { x: number; y: number; rx: number; ry: number }; spots: [number, number, number, number][] }) {
  return (
    <Svg w={w} h={h} view={`0 0 ${w} ${h}`} style={{ left: 0, top: 0 }}>
      <defs>
        <filter id="slb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={Math.round(w * 0.035)} /></filter>
        <filter id="sls" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={Math.round(w * 0.006)} /></filter>
        <filter id="slr" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={Math.round(w * 0.018)} /></filter>
      </defs>
      <ellipse cx={bloom.x} cy={bloom.y} rx={bloom.rx} ry={bloom.ry} fill="#FFFFFF" opacity="0.85" filter="url(#slb)" />
      <g filter="url(#sls)">
        {spots.map(([x, y, r, o], i) => <circle key={i} cx={x} cy={y} r={r} fill="#FFFFFF" opacity={o} />)}
      </g>
      <g filter="url(#slr)">
        <path d={`M ${w * 0.04} 0 L ${w * 0.2} 0 L ${-w * 0.06} ${h} L ${-w * 0.22} ${h} Z`} fill="rgba(255,255,255,0.32)" />
        <path d={`M ${w * 0.86} 0 L ${w * 0.93} 0 L ${w * 0.72} ${h} L ${w * 0.65} ${h} Z`} fill="rgba(255,255,255,0.22)" />
      </g>
    </Svg>
  );
}

/**
 * 淡いピンクのチェック柄（45度に傾けたタータン）。(fx, fy)（0〜1）の位置がいちばん濃く、離れるほど透明になる
 */
function TartanPatch({ id, x, y, w, h, unit, main, light, fx, fy }: { id: string; x: number; y: number; w: number; h: number; unit: number; main: string; light: string; fx: number; fy: number }) {
  const u = unit;
  return (
    <Svg w={w} h={h} view={`0 0 ${w} ${h}`} style={{ left: x, top: y }}>
      <defs>
        <pattern id={`tp${id}`} width={u} height={u} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect x={0} y={0} width={u} height={u} fill={alpha(light, 0.55)} />
          <rect x={0} y={0} width={u * 0.32} height={u} fill={alpha(main, 0.22)} />
          <rect x={0} y={0} width={u} height={u * 0.32} fill={alpha(main, 0.22)} />
          <rect x={u * 0.5} y={0} width={u * 0.07} height={u} fill="rgba(255,255,255,0.75)" />
          <rect x={0} y={u * 0.5} width={u} height={u * 0.07} fill="rgba(255,255,255,0.75)" />
          <rect x={u * 0.78} y={0} width={u * 0.025} height={u} fill={alpha(main, 0.4)} />
          <rect x={0} y={u * 0.78} width={u} height={u * 0.025} fill={alpha(main, 0.4)} />
        </pattern>
        <radialGradient id={`tg${id}`} cx={fx} cy={fy} r="0.95">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.75" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <mask id={`tm${id}`}><rect x={0} y={0} width={w} height={h} fill={`url(#tg${id})`} /></mask>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill={`url(#tp${id})`} mask={`url(#tm${id})`} />
    </Svg>
  );
}

/**
 * A の名前：丸ゴシックの字形を SVG の輪郭として描くデコ文字（参考デザインAの、丸くぷっくりした立体文字）。
 * 文字ごとに独立したグラデーション（objectBoundingBox）・上のツヤ・内側の陰影・下の照り返しを付け、
 * 縁取りは角の丸い線（stroke-linejoin: round）を重ねる：下から「ぼかした影 → 白い光のにじみ → 立体の厚み → 外側のピンクの線 → 白フチ → 内側の細い線 → 塗り」。
 * 名前が変わっても字形から自動で描く。丸ゴシックに無い文字を含む名前は null（呼び出し側で従来の重ね描きを使う）。
 * 返す要素は幅 width・高さ height の箱の中に描く（縁取り・影は箱の外へ pad だけはみ出す）。
 */
function svgDecoName({ name, width, maxFont, minFont, maxHeight, main, light, deep }: { name: string; width: number; maxFont: number; minFont: number; maxHeight: number; main: string; light: string; deep: string }): { el: ReactElement; height: number; font: number } | null {
  // 字間を広めに取り、隣の文字と白フチがつながりすぎないようにする
  const sp = 0.12;
  const lay = layoutTcgName(name, width, maxFont, minFont, maxHeight);
  let maxEm = 0;
  for (const line of lay.lines) {
    const em = measureRoundedLine(line, 1, sp);
    if (em === null) return null;
    maxEm = Math.max(maxEm, em);
  }
  const u = Math.max(1, Math.min(lay.font, Math.floor(width / (maxEm + 0.42))));
  const lineH = Math.round(u * 1.12);
  const height = lineH * lay.lines.length + Math.round(u * 0.2);
  const pad = Math.round(u * 0.5);
  const W = width + pad * 2;
  const H = height + pad * 2;
  const top0 = (height - lineH * lay.lines.length) / 2;
  const glyphs: RoundedGlyph[] = [];
  for (let j = 0; j < lay.lines.length; j++) {
    const probe = roundedGlyphLine(lay.lines[j], u, sp, 0, 0);
    if (!probe) return null;
    const y1 = Math.min(...probe.glyphs.map((g) => g.y1), 0);
    const y2 = Math.max(...probe.glyphs.map((g) => g.y2), 0);
    const cy = pad + top0 + j * lineH + lineH / 2;
    const line = roundedGlyphLine(lay.lines[j], u, sp, pad + (width - probe.width) / 2, cy - (y1 + y2) / 2);
    if (!line) return null;
    glyphs.push(...line.glyphs);
  }
  const r = (n: number) => Math.round(n * 10) / 10;
  const paths = (props: Record<string, string | number>, key: string) => glyphs.map((g, i) => <path key={`${key}${i}`} d={g.d} {...props} />);
  const rim = mixHex(main, light, 0.08);
  const body = mixHex(main, deep, 0.35);
  const el = (
    // 元の文字列は aria-label（属性）にだけ残す。SVG の中に文字（<title>・<text> 等）を置くと、Satori が普通の文字として描いてしまう
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label={name} style={{ position: 'absolute', left: -pad, top: -pad }}>
      <defs>
        <filter id="dnbl" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={r(u * 0.06)} /></filter>
        <filter id="dnbs" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={r(u * 0.045)} /></filter>
        <filter id="dnbx" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={r(u * 0.012)} /></filter>
        <linearGradient id="dnf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={mixHex(main, light, 0.42)} />
          <stop offset="0.38" stopColor={mixHex(main, light, 0.16)} />
          <stop offset="0.66" stopColor={main} />
          <stop offset="1" stopColor={mixHex(main, deep, 0.3)} />
        </linearGradient>
        <radialGradient id="dnh" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="0.6" stopColor="#FFFFFF" stopOpacity="0.45" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <clipPath id="dnc">{paths({}, 'c')}</clipPath>
      </defs>
      {/* やわらかい影と、白い光のにじみ */}
      <g filter="url(#dnbl)" opacity="0.4" transform={`translate(0 ${r(u * 0.08)})`}>{paths({ fill: deep, stroke: deep, strokeWidth: r(u * 0.22), strokeLinejoin: 'round' }, 'a')}</g>
      <g filter="url(#dnbl)" opacity="0.75">{paths({ fill: '#FFFFFF', stroke: '#FFFFFF', strokeWidth: r(u * 0.26), strokeLinejoin: 'round' }, 'w')}</g>
      {/* 立体の厚み（下にずらした濃いピンク。薄めにして固い板に見せない） */}
      <g transform={`translate(0 ${r(u * 0.038)})`}>{paths({ fill: body, stroke: body, strokeWidth: r(u * 0.2), strokeLinejoin: 'round' }, 'b')}</g>
      {/* 外側のピンクの線 → 白フチ（細め） */}
      {paths({ fill: rim, stroke: rim, strokeWidth: r(u * 0.2), strokeLinejoin: 'round' }, 'r')}
      {paths({ fill: '#FFFFFF', stroke: '#FFFFFF', strokeWidth: r(u * 0.15), strokeLinejoin: 'round' }, 'e')}
      {/* 塗り（文字ごとのグラデーション） */}
      {paths({ fill: 'url(#dnf)' }, 'f')}
      <g clipPath="url(#dnc)">
        {/* 上の縁の濡れたツヤ：白の上に、少し下へずらした塗りを重ねて、各画の上側にだけ白い縁を残す */}
        {paths({ fill: '#FFFFFF', opacity: 0.6 }, 'h')}
        <g transform={`translate(0 ${r(u * 0.022)})`}>{paths({ fill: 'url(#dnf)' }, 'g')}</g>
        {/* 内側の陰影（ふちを少し濃くして丸みを出す） */}
        <g filter="url(#dnbs)" opacity="0.3">{paths({ fill: 'none', stroke: mixHex(main, deep, 0.55), strokeWidth: r(u * 0.09), strokeLinejoin: 'round' }, 's')}</g>
        {/* 文字ごとの上のツヤ（ふんわりした楕円）と下の照り返し */}
        {glyphs.map((g, i) => {
          const w = g.x2 - g.x1;
          const h = g.y2 - g.y1;
          return <ellipse key={`t${i}`} cx={r(g.x1 + w * 0.5)} cy={r(g.y1 + h * 0.2)} rx={r(w * 0.46)} ry={r(h * 0.2)} fill="url(#dnh)" opacity="0.55" />;
        })}
        <g filter="url(#dnbx)">
          {glyphs.map((g, i) => {
            const w = g.x2 - g.x1;
            const h = g.y2 - g.y1;
            return <ellipse key={`l${i}`} cx={r(g.x1 + w * 0.5)} cy={r(g.y2 - h * 0.08)} rx={r(w * 0.3)} ry={r(h * 0.04)} fill="#FFFFFF" opacity="0.18" />;
          })}
        </g>
      </g>
      {/* 輪郭のやわらかな縁：塗りと白フチの境に淡いピンクの細い線（文字を少し細く、角を柔らかく見せる） */}
      {paths({ fill: 'none', stroke: mixHex(main, light, 0.6), strokeWidth: r(u * 0.035), strokeLinejoin: 'round', opacity: 0.9 }, 'v')}
    </svg>
  );
  return { el, height, font: u };
}

/** A の特性の本文（参考デザインAと同じ、説明欄の1行。人物ごとのデータではない定型文） */
const BASIC_TRAIT_BODY = '見たら沼る！この魅力で一瞬で好きになる。';

function BasicCard({ d, t, s }: { d: OshiCardTcgImageData; t: Theme; s: number }) {
  const k = (n: number) => Math.round(n * s);
  const { c } = t;
  const white = c.id === 'white';
  const main = white ? '#E58BB0' : c.base;
  const deep = white ? '#B8577F' : c.deep;
  const light = white ? '#FFD6E6' : c.light;
  const pale = mixHex(light, '#FFFFFF', 0.45);
  const ink = '#4A2236';
  const W = k(BASE_W);
  const H = k(BASE_H);
  const frame = k(30);
  const innerW = W - frame * 2;
  const innerH = H - frame * 2;
  const gut = k(22);
  const secW = innerW - gut * 2;
  const headH = k(108);
  // 名前面・情報面の高さ（参考デザインAの測定値：名前面の下端 ≒ カードの 48%、作品欄の下端 ≒ 94〜96%）
  const artH = k(680);
  const infoH = k(814);
  const artW = secW;
  const cx = artW / 2;
  // 名前（名前面の中央）。王冠はハートの輪の上のくぼみ、リボンは名前のすぐ下
  const nameW = artW - k(200);
  const nameMax = k(240);
  const nameMaxH = k(355);
  // 名前は丸ゴシックの字形を SVG で描く（丸ゴシックに無い文字を含むときだけ従来の重ね描き）
  const deco = svgDecoName({ name: d.name, width: nameW, maxFont: nameMax, minFont: k(70), maxHeight: nameMaxH, main, light, deep });
  const nameLayout = layoutTcgName(d.name, nameW, nameMax, k(70), nameMaxH);
  const nameFont = deco ? deco.font : nameLayout.font;
  const nameH = deco ? deco.height : Math.round(nameLayout.font * 1.12) * nameLayout.lines.length + Math.round(nameLayout.font * 0.2);
  const nameCY = artH * 0.56;
  const nameSpacing = 0.1;
  const nameTop = Math.round(nameCY - nameH / 2);
  // 文字（字形）の上端・下端の目安：行の高さ 1.12em の中央に高さ約 0.9em の字形
  const nameLines = deco ? Math.max(1, Math.round((nameH - nameFont * 0.2) / (nameFont * 1.12))) : nameLayout.lines.length;
  const glyphTop = nameTop + nameFont * 0.1 + nameFont * 0.56 - nameFont * 0.45;
  const glyphBottom = nameTop + nameFont * 0.1 + (nameLines - 0.5) * nameFont * 1.12 + nameFont * 0.45;
  // 王冠：参考デザインAの比率（幅 ≒ カードの 17〜19%、字形の上端との間 ≒ カードの高さの 3%）
  const crownW = k(210);
  const crownY = glyphTop - k(50) - crownW * 0.75;
  // リボン：名前の直下（輪の上端を字形の下端にそろえる）
  const bowW = k(290);
  const bowY = glyphBottom - k(6) + bowW * 0.62 * 0.4;
  // 背景のハート：横に広く（カードの幅の約 82%）、上端は王冠より少し上
  const ringTop = crownY - k(20);
  const ringW = artW * 0.9;
  const ringH = Math.min(ringW * 0.71, (bowY + bowW * 0.12 - ringTop) / (136 / 142));
  const personFont = Math.max(k(30), Math.min(k(50), Math.floor((secW - k(600) - (d.group ? k(24) * (emWidth(d.group) + 0.6) : 0)) / Math.max(1, emWidth(d.person) + 0.1))));
  const traitFont = Math.max(k(30), Math.min(k(48), Math.floor((secW - k(330)) / Math.max(1, emWidth(d.trait) + 0.1))));
  // 説明文はユーザー入力（traitBody）があればそれを、無ければ定型文。長い文は1行に収まるよう小さくする
  const traitBody = d.traitBody?.trim() || BASIC_TRAIT_BODY;
  const traitBodyFont = Math.max(k(24), Math.min(k(36), Math.floor((secW - k(120)) / Math.max(1, emWidth(traitBody) + 0.1))));
  const numaFont = Math.max(k(24), Math.min(k(36), Math.floor((secW - k(120)) / Math.max(1, emWidth(d.numa) + 0.1))));
  const numaScore = typeof d.numaScore === 'number' && Number.isFinite(d.numaScore) ? Math.round(d.numaScore) : null;
  // 区画の枠（濃いめのピンクの線＋内側の白い線＋下の影）。名前面と情報面を別の区画として見せる
  const section = (h: number): CSSProperties => ({ display: 'flex', position: 'relative', width: secW, height: h, borderRadius: k(30), border: `${k(3)}px solid rgba(255,255,255,0.95)`, boxShadow: `0 0 0 ${k(2)}px ${alpha(main, 0.3)}, 0 ${k(3)}px ${k(8)}px ${alpha(deep, 0.15)}`, overflow: 'hidden' });
  const n = d.works.length;
  const workFont = n === 1 ? k(46) : k(42);
  const workTextW = secW - k(300);
  return (
    <div style={{ display: 'flex', position: 'relative', width: W, height: H, borderRadius: k(64), padding: frame }}>
      {/* 外枠：ガラスのような光沢のピンクの帯（多層 SVG） */}
      <GlossFrame w={W} h={H} r={k(64)} band={frame} main={main} light={light} />

      {/* 本体（淡いピンクの地） */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', width: innerW, height: innerH, borderRadius: k(40), overflow: 'hidden', backgroundImage: `linear-gradient(180deg, ${mixHex(light, '#FFFFFF', 0.3)} 0%, ${mixHex(light, main, 0.12)} 50%, ${mixHex(light, '#FFFFFF', 0.2)} 100%)` }}>

        {/* ヘッダー：「推し」タグ・人物名｜斜めの区切り｜推し力（HP風）とハート */}
        <div style={{ display: 'flex', position: 'relative', alignItems: 'center', width: secW, height: headH, marginTop: k(14) }}>
          <Svg w={secW} h={headH} view={`0 0 ${secW} ${headH}`} style={{ left: 0, top: 0 }}>
            <defs>
              <linearGradient id="bhd" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#FFFFFF" />
                <stop offset="1" stopColor={pale} />
              </linearGradient>
            </defs>
            <rect x={k(3)} y={k(6)} width={secW - k(6)} height={headH - k(12)} rx={k(28)} fill="url(#bhd)" stroke={alpha(main, 0.55)} strokeWidth={k(4)} />
            <rect x={k(14)} y={k(13)} width={secW - k(28)} height={k(10)} rx={k(5)} fill="rgba(255,255,255,0.9)" />
            <path d={`M ${secW * 0.66} ${k(8)} L ${secW * 0.62} ${headH - k(8)}`} stroke={alpha(main, 0.45)} strokeWidth={k(4)} />
          </Svg>
          <div style={{ display: 'flex', position: 'relative', alignItems: 'center', justifyContent: 'center', width: k(150), height: k(68), flexShrink: 0, marginLeft: k(16) }}>
            <Svg w={k(150)} h={k(68)} view="0 0 150 68" style={{ left: 0, top: 0 }}>
              <path d="M28 4 L124 4 L146 34 L124 64 L28 64 C13 64 4 52 4 34 C4 16 13 4 28 4 Z" fill={mixHex(light, '#FFFFFF', 0.15)} stroke={alpha(main, 0.8)} strokeWidth="3.5" strokeLinejoin="round" />
              <path d="M28 10 L120 10 L126 18 L28 18 C20 18 12 20 12 26 C12 16 18 10 28 10 Z" fill="rgba(255,255,255,0.8)" />
            </Svg>
            <div style={{ display: 'flex', fontSize: k(32), fontWeight: 700, color: deep, letterSpacing: k(2), marginRight: k(12) }}>推し</div>
          </div>
          <div style={{ display: 'flex', flex: 1, minWidth: 0, alignItems: 'flex-end', gap: k(14), marginLeft: k(18), whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', fontSize: personFont, fontWeight: 700, color: ink, lineHeight: 1.15 }}>{d.person}</div>
            {d.group && <div style={{ display: 'flex', fontSize: k(24), fontWeight: 700, color: alpha(ink, 0.6), marginBottom: k(8) }}>{d.group}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: k(8), flexShrink: 0 }}>
            <div style={{ display: 'flex', fontSize: k(26), fontWeight: 700, color: ink, marginBottom: k(10) }}>推し力</div>
            <div style={{ display: 'flex', fontSize: k(58), fontWeight: 700, color: ink, letterSpacing: k(-1), lineHeight: 1.1 }}>{formatOshiCardPower(d.power)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: k(78), height: k(78), marginLeft: k(12), marginRight: k(14), borderRadius: k(39), backgroundImage: `linear-gradient(180deg, ${mixHex(main, '#FFFFFF', 0.3)} 0%, ${main} 55%, ${deep} 100%)`, border: `${k(4)}px solid #FFFFFF`, boxShadow: `0 ${k(3)}px 0 ${alpha(deep, 0.45)}` }}>
            <svg width={k(44)} height={k(44)} viewBox="0 0 24 24"><path d={HEART_D} fill="#FFFFFF" /><ellipse cx="8" cy="7.5" rx="2.4" ry="1.4" fill={alpha(main, 0.5)} transform="rotate(-35 8 7.5)" /></svg>
          </div>
        </div>

        {/* ── 名前面（トレカの表面） ── */}
        <div style={{ ...section(artH), marginTop: k(10), backgroundImage: `radial-gradient(ellipse at 50% 46%, #FFFFFF 0%, ${mixHex(light, '#FFFFFF', 0.6)} 28%, ${mixHex(light, '#FFFFFF', 0.15)} 60%, ${mixHex(light, main, 0.3)} 100%)` }}>
          {/* 淡いピンクのチェック柄（左下・右下から薄れる）とレース（左上・左下・右下） */}
          <TartanPatch id="a1" x={0} y={artH * 0.5} w={artW * 0.42} h={artH * 0.5} unit={k(64)} main={main} light={light} fx={0} fy={1} />
          <TartanPatch id="a2" x={artW * 0.58} y={artH * 0.5} w={artW * 0.42} h={artH * 0.5} unit={k(64)} main={main} light={light} fx={1} fy={1} />
          <LaceArc w={artW} h={artH} cx={-k(20)} cy={-k(20)} r={k(170)} from={0} to={90} hole={alpha(main, 0.42)} />
          <LaceArc w={artW} h={artH} cx={-k(30)} cy={artH + k(30)} r={k(230)} from={-90} to={0} hole={alpha(main, 0.42)} />
          <LaceArc w={artW} h={artH} cx={artW + k(30)} cy={artH + k(30)} r={k(250)} from={180} to={270} hole={alpha(main, 0.42)} />
          {/* やわらかな光：名前の後ろのにじむ光・ぼけた光の玉・斜めのガラスの反射 */}
          <SoftLights w={artW} h={artH} bloom={{ x: cx, y: nameCY, rx: artW * 0.36, ry: artH * 0.3 }} spots={[[artW * 0.2, artH * 0.16, artW * 0.06, 0.45], [artW * 0.84, artH * 0.34, artW * 0.05, 0.4], [artW * 0.08, artH * 0.5, artW * 0.04, 0.35], [artW * 0.9, artH * 0.08, artW * 0.045, 0.4], [artW * 0.64, artH * 0.1, artW * 0.035, 0.35], [artW * 0.3, artH * 0.88, artW * 0.045, 0.3], [artW * 0.74, artH * 0.9, artW * 0.04, 0.3]]} />
          <LightSpecks w={artW} h={artH} count={60} seed={5} color="#FFFFFF" avoid={{ x: cx, y: nameCY, rx: artW * 0.37, ry: artH * 0.2 }} />
          <SatinHeartRing x={cx - ringW / 2} y={ringTop} w={ringW} h={ringH} main={main} light={light} deep={deep} />
          {/* ハートときらめき（参考デザインの位置：左に大きなハート、右上に白いハート、左上に金のきらめき） */}
          <HeartShape x={k(76)} y={artH * 0.56} size={k(78)} fill={mixHex(main, light, 0.15)} stroke="#FFFFFF" rotate={-14} />
          <HeartShape x={k(200)} y={artH * 0.7} size={k(38)} fill="#FFFFFF" rotate={-8} />
          <HeartShape x={artW - k(150)} y={artH * 0.13} size={k(64)} fill="#FFFFFF" stroke={alpha(main, 0.35)} rotate={-10} />
          <HeartShape x={artW - k(70)} y={artH * 0.22} size={k(44)} fill="#FFFFFF" stroke={alpha(main, 0.35)} rotate={14} />
          <HeartShape x={artW - k(110)} y={artH * 0.68} size={k(40)} fill="#FFFFFF" rotate={10} />
          <HeartShape x={k(310)} y={artH * 0.12} size={k(30)} fill="#FFFFFF" rotate={-6} />
          <Sparkle x={k(130)} y={artH * 0.3} size={k(96)} color="#FFE9A8" glow="rgba(255,255,255,0.8)" />
          <Sparkle x={k(84)} y={artH * 0.4} size={k(50)} color="#FFF4CF" />
          <Sparkle x={k(250)} y={artH * 0.2} size={k(40)} color="#FFFFFF" />
          <Sparkle x={artW - k(240)} y={artH * 0.32} size={k(44)} color="#FFFFFF" glow="rgba(255,255,255,0.7)" />
          <Sparkle x={artW - k(80)} y={artH * 0.5} size={k(54)} color="#FFFFFF" glow="rgba(255,255,255,0.7)" />
          <Crown x={cx} y={crownY} width={crownW} gem={white ? '#FF8FB8' : main} outline="#FFFFFF" />
          <div style={{ position: 'absolute', left: (artW - nameW) / 2, top: nameTop, width: nameW, height: nameH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {deco ? <div style={{ display: 'flex', position: 'relative', width: nameW, height: nameH }}>{deco.el}</div> : <FancyName name={d.name} width={nameW} maxFont={nameMax} minFont={k(70)} maxHeight={nameMaxH} t={t} fontFamily={`${OSHI_CARD_ROUNDED_FONT_FAMILY}, ${OSHI_VOD_IMAGE_FONT_FAMILY}`} spacingEm={nameSpacing} />}
          </div>
          {/* 名前の下の大きな淡いピンクのリボン */}
          <SatinBow x={cx} y={bowY} width={bowW} main={main} light={light} deep={deep} />
          {/* 奥行き：四隅がわずかに濃くなるピンクの陰影 */}
          <div style={{ position: 'absolute', left: 0, top: 0, width: artW, height: artH, display: 'flex', backgroundImage: `radial-gradient(ellipse at 50% 48%, rgba(255,255,255,0) 58%, ${alpha(main, 0.1)} 100%)` }} />
        </div>

        {/* ── 情報面（トレカの説明欄） ── */}
        {/* 情報面の地：参考デザインAと同じく、中央は白く左右へピンクが濃くなる。右下に淡いチェック柄 */}
        <div style={{ ...section(infoH), flexDirection: 'column', marginTop: k(16), padding: `${k(22)}px ${k(34)}px ${k(24)}px`, backgroundImage: `radial-gradient(ellipse at 50% 30%, #FFFFFF 0%, ${alpha(mixHex(light, '#FFFFFF', 0.7), 0.95)} 40%, ${mixHex(light, '#FFFFFF', 0.15)} 78%, ${mixHex(light, main, 0.3)} 100%)` }}>
          <TartanPatch id="i1" x={secW * 0.5} y={infoH * 0.5} w={secW * 0.5} h={infoH * 0.5} unit={k(64)} main={main} light={light} fx={1} fy={1} />
          <SoftLights w={secW} h={infoH} bloom={{ x: secW * 0.5, y: infoH * 0.3, rx: secW * 0.3, ry: infoH * 0.18 }} spots={[]} />
          {/* 説明欄の飾り：左下のレース */}
          <LaceArc w={secW} h={infoH} cx={-k(30)} cy={infoH + k(30)} r={k(210)} from={-90} to={0} hole={alpha(main, 0.36)} />
          {/* 特性：見出し（カプセル＋太字）と本文1行。大きさ・余白は参考デザインAの比率（幅 484px → 1260px で約2.6倍）に合わせる */}
          <div style={{ display: 'flex', alignItems: 'center', height: k(66), marginTop: k(10) }}>
            <div style={{ display: 'flex', position: 'relative', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: k(214), height: k(62), borderRadius: k(31), backgroundImage: `linear-gradient(180deg, ${mixHex(main, '#FFFFFF', 0.45)} 0%, ${mixHex(main, '#FFFFFF', 0.2)} 60%, ${mixHex(main, '#FFFFFF', 0.05)} 100%)`, border: `${k(3)}px solid #FFFFFF`, boxShadow: `0 ${k(2)}px ${k(4)}px ${alpha(deep, 0.25)}` }}>
              <div style={{ position: 'absolute', left: k(16), right: k(16), top: k(4), height: k(16), display: 'flex', borderRadius: k(8), backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.1) 100%)' }} />
              <div style={{ display: 'flex', fontSize: k(36), fontWeight: 700, color: '#FFFFFF', letterSpacing: k(4), textShadow: `0 ${k(1)}px ${k(2)}px ${alpha(deep, 0.5)}` }}>特性</div>
            </div>
            <div style={{ display: 'flex', marginLeft: k(34), fontSize: traitFont, fontWeight: 700, color: mixHex(deep, '#5A0A30', 0.2), whiteSpace: 'nowrap' }}>{d.trait}</div>
          </div>
          <div style={{ display: 'flex', marginTop: k(22), paddingLeft: k(24), fontSize: traitBodyFont, fontWeight: 700, color: ink, whiteSpace: 'nowrap' }}>{traitBody}</div>
          {/* 区切り線（細く淡い） */}
          <div style={{ display: 'flex', marginTop: k(37), height: k(2), backgroundImage: `linear-gradient(90deg, ${alpha(main, 0)} 0%, ${alpha(main, 0.38)} 6%, ${alpha(main, 0.38)} 94%, ${alpha(main, 0)} 100%)` }} />
          {/* 沼ポイント：ハート3つ＋見出し（右に数値：入力がある場合だけ）、下に本文1行 */}
          <div style={{ display: 'flex', alignItems: 'center', height: k(72), marginTop: k(40) }}>
            <div style={{ display: 'flex', gap: k(2) }}>
              {[0, 1, 2].map((i) => (
                <svg key={i} width={k(66)} height={k(66)} viewBox="0 0 24 24">
                  <path d={HEART_D} fill={mixHex(light, main, 0.55)} stroke="#FFFFFF" strokeWidth="1" strokeLinejoin="round" />
                  <path d={HEART_D} fill="#FFFFFF" transform="translate(3.6 3.9) scale(0.7)" />
                  <ellipse cx="7.4" cy="7.4" rx="1.8" ry="1.1" fill={alpha(light, 0.9)} transform="rotate(-35 7.4 7.4)" />
                </svg>
              ))}
            </div>
            <div style={{ display: 'flex', flex: 1, marginLeft: k(68), fontSize: k(46), fontWeight: 700, color: ink }}>沼ポイント</div>
            {numaScore !== null && <div style={{ display: 'flex', marginRight: k(30), fontSize: k(48), fontWeight: 700, color: ink }}>{numaScore}</div>}
          </div>
          <div style={{ display: 'flex', marginTop: k(26), paddingLeft: k(24), fontSize: numaFont, fontWeight: 700, color: ink, whiteSpace: 'nowrap' }}>{d.numa}</div>

          {/* おすすめ出演作品：説明欄の中の1区画（薄い枠＋リボンの見出し＋箇条書き） */}
          <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', marginTop: k(46), flex: 1, borderRadius: k(26), padding: `${k(14)}px ${k(18)}px`, backgroundColor: 'rgba(255,255,255,0.62)', border: `${k(3)}px solid ${alpha(main, 0.35)}`, boxShadow: `0 ${k(2)}px ${k(6)}px ${alpha(deep, 0.12)}` }}>
            <div style={{ display: 'flex', position: 'relative', alignItems: 'center', width: k(500), height: k(70), flexShrink: 0 }}>
              <Svg w={k(500)} h={k(70)} view="0 0 500 70" style={{ left: 0, top: 0 }}>
                <defs>
                  <linearGradient id="bwr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={mixHex(main, '#FFFFFF', 0.3)} />
                    <stop offset="0.6" stopColor={mixHex(main, '#FFFFFF', 0.05)} />
                    <stop offset="1" stopColor={main} />
                  </linearGradient>
                </defs>
                <path d="M16 6 L496 6 L470 35 L496 64 L16 64 C9 64 4 59 4 52 L4 18 C4 11 9 6 16 6 Z" fill="url(#bwr)" stroke="#FFFFFF" strokeWidth="3" strokeLinejoin="round" />
                <path d="M16 11 L480 11 L476 16 L16 16 C12 16 9 14 9 13 Z" fill="rgba(255,255,255,0.55)" />
              </Svg>
              <div style={{ display: 'flex', alignItems: 'center', gap: k(12), marginLeft: k(18) }}>
                <Clapper size={k(42)} color={deep} />
                <div style={{ display: 'flex', fontSize: k(34), fontWeight: 700, color: '#FFFFFF', letterSpacing: k(2), textShadow: `0 ${k(2)}px ${k(2)}px ${alpha(deep, 0.55)}` }}>おすすめ出演作品</div>
              </div>
            </div>
            {n === 0 ? (
              <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', fontSize: k(34), fontWeight: 700, color: alpha(ink, 0.7) }}>出演作品は推しサーチでチェック！</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, gap: k(14), paddingLeft: k(120) }}>
                {d.works.map((w, i) => {
                  // 作品名＋分類・公開年（作品名を優先して1行に収める）
                  const meta = w.year ? `（${w.typeLabel}・${w.year}）` : `（${w.typeLabel}）`;
                  const metaW = Math.round(k(26) * (emWidth(meta) + 0.4));
                  const { text, font } = fitTitle(w.title, workTextW - metaW, workFont, Math.round(workFont * 0.66), 1);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: k(14), whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', width: k(12), height: k(12), borderRadius: k(6), backgroundColor: ink }} />
                      <div style={{ display: 'flex', fontSize: font, fontWeight: 700, color: ink }}>{text}</div>
                      <div style={{ display: 'flex', fontSize: k(26), fontWeight: 700, color: alpha(ink, 0.6) }}>{meta}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* フッター：推しサーチ・注記（小さく） */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: secW, marginTop: k(12), padding: `0 ${k(8)}px` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: k(10) }}>
            <BrandMark size={k(36)} radius={k(8)} />
            <div style={{ display: 'flex', fontSize: k(22), fontWeight: 700, color: ink }}>{`推しサーチ  ${SITE_URL}`}</div>
          </div>
          <div style={{ display: 'flex', fontSize: k(16), fontWeight: 700, color: alpha(ink, 0.75) }}>{TCG_NOTE}</div>
        </div>
      </div>
      {/* 本体の縁：細い線と内側の影（本体の上に重ねる） */}
      <div style={{ position: 'absolute', left: frame, top: frame, width: innerW, height: innerH, display: 'flex' }}>
        <InnerBevel w={innerW} h={innerH} r={k(40)} main={main} />
      </div>
    </div>
  );
}

// ─── B（SSR）：参考デザインB（~/Desktop/oshi-card-exact-reference-B.png）に合わせた専用レイアウト ─────────
// 構造：金の装飾フレーム ＞ 上「推し」タグ・人物名・推し力の帯と右上の金の SSR バッジ ＞ 名前面（青・紫・ピンクのホログラム、
// 宝石の王冠・細身で斜めの発光文字・名前を囲む楕円の光の軌跡・クリスタルの星）＞ 金の区切り線 ＞ 情報面（特性・沼ポイント・
// 金のリボンの見出しの作品欄）＞ フッター。名前・作品はすべて動的。

const SSR_INK = '#27245A';
const SSR_GOLD_STOPS: [number, string][] = [[0, '#8A5A12'], [0.18, '#F7E08A'], [0.36, '#C08A22'], [0.52, '#FFF4C2'], [0.7, '#B07A1A'], [0.86, '#F3D27A'], [1, '#7A4E0E']];

function goldStops(): ReactElement[] {
  return SSR_GOLD_STOPS.map(([o, c2], i) => <stop key={i} offset={o} stopColor={c2} />);
}

/**
 * B の名前：丸ゴシックの字形の輪郭を「内側へ削って細く」（SVG の mask）し、横を詰めて斜めに傾けた、細身で優雅な発光文字。
 * 下から：紫・ピンク・水色の発光（ぼかし）→ 白い光の縁 → 紫の細い輪郭 → 白〜淡い紫〜水色のグラデーションの細い文字 → 上のツヤ。
 * 文字は aria-label にだけ残す（SVG 内に文字を置くと Satori が描いてしまうため）。丸ゴシックに無い文字を含む名前は null。
 */
/** B（SSR）：3文字程度の短い名前を大きく見せる倍率（名前の最大の大きさ・高さに掛ける。長い名前は従来どおり縮小・改行） */
const SSR_NAME_BOOST = 1.18;
/** B（SSR）：フッターの左端（1260 基準の x）。カード素材の左下の金の唐草の右側 */
const SSR_FOOTER_LEFT = 290;

export function svgSsrName({ name, width, maxFont, minFont, maxHeight, boost = 1 }: { name: string; width: number; maxFont: number; minFont: number; maxHeight: number; boost?: number }): { el: ReactElement; height: number; font: number } | null {
  const sp = 0.02;
  const cond = 0.95; // 横幅の比率（縦長の細身に）
  const skew = -11; // 斜体の角度
  // 横を詰める分、測る幅を広げて大きさを決める
  const vw = width / cond;
  const lay = layoutTcgName(name, vw, maxFont, minFont, maxHeight);
  let maxEm = 0;
  for (const line of lay.lines) {
    const em = measureShipporiLine(line, 1, sp);
    if (em === null) return null;
    maxEm = Math.max(maxEm, em);
  }
  const u = Math.max(1, Math.min(lay.font, Math.floor(vw / (maxEm + (boost > 1 ? 0.22 : 0.5)))));
  const lineH = Math.round(u * 1.12);
  const height = lineH * lay.lines.length + Math.round(u * 0.2);
  const pad = Math.round(u * 0.6);
  const W = width + pad * 2;
  const H = height + pad * 2;
  const top0 = (height - lineH * lay.lines.length) / 2;
  const cx = W / 2;
  const glyphs: RoundedGlyph[] = [];
  for (let j = 0; j < lay.lines.length; j++) {
    const probe = shipporiGlyphLine(lay.lines[j], u, sp, 0, 0);
    if (!probe) return null;
    const y1 = Math.min(...probe.glyphs.map((g) => g.y1), 0);
    const y2 = Math.max(...probe.glyphs.map((g) => g.y2), 0);
    const cy = pad + top0 + j * lineH + lineH / 2;
    const line = shipporiGlyphLine(lay.lines[j], u, sp, cx - probe.width / 2, cy - (y1 + y2) / 2);
    if (!line) return null;
    glyphs.push(...line.glyphs);
  }
  const r = (n: number) => Math.round(n * 10) / 10;
  const cyAll = pad + height / 2;
  const tf = `translate(${r(cx)} ${r(cyAll)}) skewX(${skew}) scale(${cond} 1) translate(${r(-cx)} ${r(-cyAll)})`;
  const paths = (props: Record<string, string | number>, key: string) => glyphs.map((g, i) => <path key={`${key}${i}`} d={g.d} {...props} />);
  // 字形は丸ゴシックの輪郭そのまま（形を崩す加工はしない）。
  // 輪郭＝元の字形（紫）、表面＝元の字形を内側へ少し削った形（ホログラムの塗り）。削った幅が細い紫の外周として見える。
  // ※v3 では字形を上下にずらした重なりだけを描いて横画を細くしたが、横画が途切れ・分断し、側面の層が横線として透けたため廃止
  const ef = r(u * 0.008);
  const tk = r(u * 0.02); // 字形を外側へ太らせる幅
  const nx = Math.min(...glyphs.map((g) => g.x1));
  const nx2 = Math.max(...glyphs.map((g) => g.x2));
  const ny = Math.min(...glyphs.map((g) => g.y1));
  const ny2 = Math.max(...glyphs.map((g) => g.y2));
  const nw = Math.max(1, nx2 - nx);
  const nh = Math.max(1, ny2 - ny);
  const face = (children: (key: string) => ReactNode, key: string) => <g key={key} mask="url(#snx)">{children(key)}</g>;
  const el = (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label={name} style={{ position: 'absolute', left: -pad, top: -pad }}>
      <defs>
        <filter id="snbl" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={r(u * 0.07)} /></filter>
        <filter id="snbs" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={r(u * 0.02)} /></filter>
        <filter id="snbi" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation={r(u * 0.03)} /></filter>
        <filter id="snbx" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation={Math.max(0.6, r(u * 0.005))} /></filter>
        <mask id="snx" maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
          <rect x="0" y="0" width={W} height={H} fill="#000000" />
          {paths({ fill: '#FFFFFF', stroke: '#FFFFFF', strokeWidth: r((tk - ef) * 2), strokeLinejoin: 'round' }, 'x')}
        </mask>
        {/* 真珠のような白〜シルバーの地（文字ごと） */}
        <linearGradient id="snf" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.4" stopColor="#F3F0FC" />
          <stop offset="0.72" stopColor="#DFE2F6" />
          <stop offset="1" stopColor="#CDD1F0" />
        </linearGradient>
        {/* 名前全体にまたがる虹色のにじみ（ピンク・水色・黄・ラベンダーが文字ごとに違う位置に出る） */}
        {([['snp', 0.12, 0.35, '#FF9AD6'], ['snc', 0.38, 0.7, '#7FD9FF'], ['sny', 0.6, 0.3, '#FFE08E'], ['snl', 0.86, 0.6, '#B497FF'], ['snq', 0.25, 0.85, '#8FC8FF']] as const).map(([id, fx, fy, col]) => (
          <radialGradient key={id} id={id} gradientUnits="userSpaceOnUse" cx={r(nx + nw * fx)} cy={r(ny + nh * fy)} r={r(nh * 0.6)}>
            <stop offset="0" stopColor={col} stopOpacity="1" />
            <stop offset="0.55" stopColor={col} stopOpacity="0.62" />
            <stop offset="1" stopColor={col} stopOpacity="0" />
          </radialGradient>
        ))}
        {/* 名前全体を斜めに横切る虹色の縞（真珠のマーブルのような色の移り変わり：ピンク・淡い金・水色・ラベンダー） */}
        <linearGradient id="snh" gradientUnits="userSpaceOnUse" x1={r(nx)} y1={r(ny)} x2={r(nx + nw * 0.55)} y2={r(ny2)} spreadMethod="repeat">
          <stop offset="0" stopColor="#FF9AD6" stopOpacity="0.55" />
          <stop offset="0.16" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.3" stopColor="#FFDC8A" stopOpacity="0.5" />
          <stop offset="0.45" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.6" stopColor="#7FD6FF" stopOpacity="0.55" />
          <stop offset="0.75" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.88" stopColor="#B394FF" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FF9AD6" stopOpacity="0.55" />
        </linearGradient>
        {/* 文字ごとの虹色（左上から右下へ：ピンク→白→水色→白→ラベンダー） */}
        <linearGradient id="sng" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF8ED2" stopOpacity="0.62" />
          <stop offset="0.22" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.4" stopColor="#FFD86E" stopOpacity="0.5" />
          <stop offset="0.56" stopColor="#6FD0FF" stopOpacity="0.6" />
          <stop offset="0.76" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="1" stopColor="#9C7CFF" stopOpacity="0.65" />
        </linearGradient>
        {/* 斜めに走る細かな虹色の反射（文字ごと） */}
        <linearGradient id="snr" x1="0" y1="0" x2="1" y2="0.7">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.22" stopColor="#FFB0E2" stopOpacity="0.75" />
          <stop offset="0.3" stopColor="#FFFFFF" stopOpacity="0.1" />
          <stop offset="0.5" stopColor="#9EE4FF" stopOpacity="0.75" />
          <stop offset="0.58" stopColor="#FFFFFF" stopOpacity="0.1" />
          <stop offset="0.76" stopColor="#FFF3B8" stopOpacity="0.5" />
          <stop offset="1" stopColor="#BFA6FF" stopOpacity="0.68" />
        </linearGradient>
        {/* 下側・右側の陰り（文字の内側の明暗差） */}
        <linearGradient id="snd" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#7E78E8" stopOpacity="0" />
          <stop offset="0.55" stopColor="#7E78E8" stopOpacity="0" />
          <stop offset="1" stopColor="#7E78E8" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="sne" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6F7EEE" />
          <stop offset="0.5" stopColor="#5D50DA" />
          <stop offset="1" stopColor="#7C50D4" />
        </linearGradient>
      </defs>
      <g transform={tf}>
        {/* 発光：青紫（中央）・ピンク（左）・水色（右）と、白い光のにじみ */}
        <g filter="url(#snbl)" opacity="0.8">{paths({ fill: '#B4A8FF', stroke: '#B4A8FF', strokeWidth: r(u * 0.14), strokeLinejoin: 'round' }, 'g')}</g>
        <g filter="url(#snbl)" opacity="0.34" transform={`translate(${r(-u * 0.04)} 0)`}>{paths({ fill: '#FF9BDD', stroke: '#FF9BDD', strokeWidth: r(u * 0.08), strokeLinejoin: 'round' }, 'p')}</g>
        <g filter="url(#snbl)" opacity="0.38" transform={`translate(${r(u * 0.04)} 0)`}>{paths({ fill: '#7FD8FF', stroke: '#7FD8FF', strokeWidth: r(u * 0.08), strokeLinejoin: 'round' }, 'c')}</g>
        <g filter="url(#snbs)">{paths({ fill: '#FFFFFF', stroke: '#FFFFFF', strokeWidth: r(u * 0.06 + tk * 2), strokeLinejoin: 'round' }, 'w')}</g>
        {/* 立体の影：文字の背後にだけ（右下へずらした1枚の青紫＋やわらかなぼかし）。層を重ねないので横線は出ない */}
        <g filter="url(#snbs)" opacity="0.7" transform={`translate(${r(u * 0.027)} ${r(u * 0.039)})`}>{paths({ fill: '#3E3AA8', stroke: '#3E3AA8', strokeWidth: r(tk * 2), strokeLinejoin: 'round' }, 'sb')}</g>
        <g filter="url(#snbx)">{[0.2, 0.4, 0.6, 0.8, 1].map((f) => <g key={`sd${f}`} transform={`translate(${r(u * 0.023 * f)} ${r(u * 0.033 * f)})`}>{paths({ fill: 'url(#sne)', stroke: 'url(#sne)', strokeWidth: r(tk * 2), strokeLinejoin: 'round' }, `sd${f}`)}</g>)}</g>
        {/* 細い紫の外周（元の字形） */}
        {paths({ fill: '#6A60E6', stroke: '#6A60E6', strokeWidth: r(tk * 2), strokeLinejoin: 'round' }, 'ol')}
        {/* 表面：真珠の地 → 虹色のにじみ → 斜めの反射 → 下の陰り → 左上の白いツヤ */}
        {face((key) => (
          <g key={`${key}g`}>
            {paths({ fill: 'url(#snf)', stroke: 'url(#snf)', strokeWidth: r(tk * 2), strokeLinejoin: 'round' }, `${key}a`)}
            {(['snp', 'snc', 'sny', 'snl', 'snq'] as const).map((id) => <g key={`${key}${id}`}>{paths({ fill: `url(#${id})`, stroke: `url(#${id})`, strokeWidth: r(tk * 2), strokeLinejoin: 'round' }, `${key}${id}`)}</g>)}
            {paths({ fill: 'url(#sng)', stroke: 'url(#sng)', strokeWidth: r(tk * 2), strokeLinejoin: 'round' }, `${key}g2`)}
            {paths({ fill: 'url(#snh)', stroke: 'url(#snh)', strokeWidth: r(tk * 2), strokeLinejoin: 'round' }, `${key}h2`)}
            {paths({ fill: 'url(#snr)', stroke: 'url(#snr)', strokeWidth: r(tk * 2), strokeLinejoin: 'round' }, `${key}r`)}
            {paths({ fill: 'url(#snd)', stroke: 'url(#snd)', strokeWidth: r(tk * 2), strokeLinejoin: 'round' }, `${key}d`)}
            {glyphs.map((g, i) => {
              const w = g.x2 - g.x1;
              const h = g.y2 - g.y1;
              return <ellipse key={`${key}t${i}`} cx={r(g.x1 + w * 0.38)} cy={r(g.y1 + h * 0.18)} rx={r(w * 0.42)} ry={r(h * 0.13)} fill="#FFFFFF" opacity="0.58" />;
            })}
          </g>
        ), 'face')}
        {/* 表面のふちの細い白い光（左上側） */}
        <g opacity="0.8">{face((key) => <g key={`${key}g`} transform={`translate(${r(u * 0.008)} ${r(u * 0.01)})`}>{paths({ fill: 'none', stroke: '#FFFFFF', strokeWidth: r(u * 0.014), strokeLinejoin: 'round' }, `${key}h`)}</g>, 'hl')}</g>
      </g>
    </svg>
  );
  return { el, height, font: u };
}

/** 宝石の王冠（クリスタル風：半透明の白〜淡い紫のカット面・紫の細い輪郭・白い光・中央のピンクの宝石・青とピンクの小さな宝石） */
function CrystalCrown({ x, y, width, gem }: { x: number; y: number; width: number; gem: string }) {
  const h = width * 0.66;
  const line = '#7C68E0';
  return (
    <Svg w={width} h={h} view="0 0 160 106" style={{ left: x - width / 2, top: y }}>
      <defs>
        <linearGradient id="ccf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#E6DDFF" stopOpacity="0.9" />
          <stop offset="1" stopColor="#B8A6F6" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="ccg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.4" stopColor={gem} />
          <stop offset="1" stopColor="#9B3E8E" />
        </linearGradient>
        <filter id="ccb" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      <path d="M22 86 L10 32 L50 60 L80 14 L110 60 L150 32 L138 86 Z" fill="#FFFFFF" opacity="0.9" filter="url(#ccb)" />
      <path d="M22 86 L10 32 L50 60 L80 14 L110 60 L150 32 L138 86 Z" fill="url(#ccf)" stroke={line} strokeWidth="2.6" strokeLinejoin="round" />
      {/* カット面（光の当たる面と影の面） */}
      <polygon points="80,14 80,86 50,60" fill="#FFFFFF" opacity="0.55" />
      <polygon points="80,14 110,60 80,86" fill="#C9B9FF" opacity="0.45" />
      <polygon points="10,32 22,86 50,60" fill="#DCEBFF" opacity="0.6" />
      <polygon points="150,32 138,86 110,60" fill="#F3D9FF" opacity="0.55" />
      <path d="M26 80 L18 42 L50 66 L80 26 L110 66 L142 42 L134 80" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinejoin="round" opacity="0.95" />
      <rect x="20" y="82" width="120" height="16" rx="6" fill="url(#ccf)" stroke={line} strokeWidth="2.6" />
      <rect x="26" y="85" width="108" height="4" rx="2" fill="#FFFFFF" opacity="0.85" />
      {[[10, 30], [150, 30], [80, 11]].map(([cx2, cy2], i) => (
        <g key={i}>
          <circle cx={cx2} cy={cy2} r="7" fill="#DCEBFF" stroke={line} strokeWidth="2.2" />
          <circle cx={cx2 - 2} cy={cy2 - 2} r="2.4" fill="#FFFFFF" />
        </g>
      ))}
      <polygon points="80,46 94,62 80,80 66,62" fill="url(#ccg)" stroke="#FFFFFF" strokeWidth="2.4" strokeLinejoin="round" />
      <polygon points="80,46 87,62 80,58 73,62" fill="#FFFFFF" opacity="0.8" />
      <circle cx="46" cy="90" r="4.4" fill="#8FD3FF" stroke="#FFFFFF" strokeWidth="1.6" />
      <circle cx="114" cy="90" r="4.4" fill="#8FD3FF" stroke="#FFFFFF" strokeWidth="1.6" />
      <circle cx="80" cy="90" r="5" fill="#FF9FD8" stroke="#FFFFFF" strokeWidth="1.6" />
      <path d="M120 18 L122 12 L124 18 L130 20 L124 22 L122 28 L120 22 L114 20 Z" fill="#FFFFFF" />
    </Svg>
  );
}

/** クリスタルの星（5つの角を光の当たる面と影の面に分けた立体の星） */
function CrystalStar({ x, y, size, rotate = 0 }: { x: number; y: number; size: number; rotate?: number }) {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? 48 : 21;
    pts.push([50 + Math.cos(a) * rr, 50 + Math.sin(a) * rr]);
  }
  const fills = ['#FFFFFF', '#BFE6FF', '#E9D9FF', '#9FC7FF', '#FFE3F6', '#C8B8FF', '#F2FBFF', '#A9D8FF', '#FFD0EE', '#D9CCFF'];
  return (
    <Svg w={size} h={size} view="0 0 100 100" style={{ left: x - size / 2, top: y - size / 2, transform: `rotate(${rotate}deg)` }}>
      <defs><filter id="csb" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5" /></filter></defs>
      <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="#FFFFFF" opacity="0.85" filter="url(#csb)" />
      {pts.map((p, i) => {
        const q = pts[(i + 1) % 10];
        return <polygon key={i} points={`50,50 ${p[0]},${p[1]} ${q[0]},${q[1]}`} fill={fills[i]} />;
      })}
      <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinejoin="round" />
      <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#8C9BE8" strokeWidth="0.8" strokeLinejoin="round" opacity="0.8" />
    </Svg>
  );
}

/** 名前を囲む楕円の光の軌跡。back＝名前の後ろ側（上半分）、front＝手前側（下半分） */
function LightOrbit({ w, h, cx, cy, rx, ry, rotate, part }: { w: number; h: number; cx: number; cy: number; rx: number; ry: number; rotate: number; part: 'back' | 'front' }) {
  const id = part === 'back' ? 'lob' : 'lof';
  // 楕円の半分（上半分＝左端→右端を上回り、下半分＝右端→左端を下回り）
  const d = part === 'back' ? `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}` : `M ${cx + rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy}`;
  return (
    <Svg w={w} h={h} view={`0 0 ${w} ${h}`} style={{ left: 0, top: 0 }}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity={part === 'back' ? 0.2 : 0.95} />
          <stop offset="0.5" stopColor="#FFF4D2" stopOpacity="0.9" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity={part === 'back' ? 0.95 : 0.15} />
        </linearGradient>
        <filter id={`${id}b`} x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation={Math.max(1, ry * 0.05)} /></filter>
      </defs>
      <g transform={`rotate(${rotate} ${cx} ${cy})`}>
        {/* 金・紫・水色の反射（少しずらして重ねた光）と白い芯 */}
        <g filter={`url(#${id}b)`}>
          <path d={d} fill="none" stroke="#FFE3A0" strokeWidth={Math.max(2, ry * 0.06)} opacity="0.75" transform={`translate(0 ${-ry * 0.03})`} />
          <path d={d} fill="none" stroke="#C6A6FF" strokeWidth={Math.max(2, ry * 0.07)} opacity="0.6" transform={`translate(0 ${ry * 0.04})`} />
          <path d={d} fill="none" stroke="#A6E8FF" strokeWidth={Math.max(2, ry * 0.05)} opacity="0.55" transform={`translate(0 ${ry * 0.07})`} />
          <path d={d} fill="none" stroke="#FFFFFF" strokeWidth={Math.max(2, ry * 0.08)} opacity="0.7" />
        </g>
        <path d={d} fill="none" stroke={`url(#${id}g)`} strokeWidth={Math.max(1, ry * 0.024)} strokeLinecap="round" />
      </g>
    </Svg>
  );
}

/** SSR バッジ（金の文字・金の縁・左右の月桂樹） */
function SsrBadge({ k, x, y }: { k: (n: number) => number; x: number; y: number }) {
  const bw = k(250);
  const bh = k(116);
  const font = k(92);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: bw + k(90), height: bh + k(40), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Laurel x={k(40)} y={k(4)} height={bh + k(30)} side={-1} color="#E9C25A" vein="#9A6A14" />
      <Laurel x={bw + k(50)} y={k(4)} height={bh + k(30)} side={1} color="#E9C25A" vein="#9A6A14" />
      <div style={{ display: 'flex', position: 'relative', alignItems: 'center', justifyContent: 'center', width: bw, height: bh, borderRadius: k(26), backgroundImage: 'linear-gradient(160deg, #FFFFFF 0%, #EDE6FF 45%, #D7E4FF 100%)', border: `${k(5)}px solid #D9A93A`, boxShadow: `0 0 0 ${k(2)}px #FFF4C2, 0 ${k(4)}px ${k(10)}px rgba(60,40,120,0.35)` }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: bw - k(10), height: bh - k(10), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: font, fontWeight: 700, letterSpacing: k(2), color: '#5A3608', WebkitTextStroke: `${k(10)}px #5A3608` }}>SSR</div>
        <div style={{ position: 'absolute', left: 0, top: 0, width: bw - k(10), height: bh - k(10), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: font, fontWeight: 700, letterSpacing: k(2), color: '#FFF4C2', WebkitTextStroke: `${k(4)}px #FFF4C2` }}>SSR</div>
        <div style={{ position: 'absolute', left: 0, top: 0, width: bw - k(10), height: bh - k(10), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: font, fontWeight: 700, letterSpacing: k(2), backgroundImage: GOLD_METAL, backgroundClip: 'text', color: 'transparent' }}>SSR</div>
      </div>
    </div>
  );
}

/** 沼ポイントの宝石の丸（水色のカット） */
function GemDot({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="18" fill="#EEF2FF" stroke="#9AA6E8" strokeWidth="2.4" />
      <circle cx="20" cy="20" r="14" fill="#FFFFFF" />
      <polygon points="20,8 30,18 20,32 10,18" fill="#9FD0FF" stroke="#6F8FE6" strokeWidth="1.6" strokeLinejoin="round" />
      <polygon points="20,8 25,18 20,32 15,18" fill="#D6EEFF" opacity="0.9" />
      <polygon points="10,18 30,18 20,32" fill="#7FB2F5" opacity="0.35" />
    </svg>
  );
}

function SsrCard({ d, t, s }: { d: OshiCardTcgImageData; t: Theme; s: number }) {
  const k = (n: number) => Math.round(n * s);
  const assets = ssrCardAssets();
  const { c } = t;
  const W = k(BASE_W);
  const H = k(BASE_H);
  const band = k(36);
  const innerW = W - band * 2;
  const innerH = H - band * 2;
  const gem = c.id === 'white' ? '#FF9FD8' : c.base;
  // 参考デザインBの測定値（カードに対する比率）から：ヘッダー 3〜9%、名前面 〜48%、特性 52%、沼ポイント 64%、作品欄 75〜95%
  const headTop = k(14);
  const headH = k(110);
  const artTop = headTop + headH + k(8);
  const artH = k(845) - band - artTop;
  const artW = innerW;
  const cx = artW / 2;
  // 名前：字形の高さ ≒ カードの 13%、幅は最大でカードの 76%
  const nameW = Math.round(artW * 0.82);
  const nameMaxH = k(Math.round(385 * SSR_NAME_BOOST));
  const deco = svgSsrName({ name: d.name, width: nameW, maxFont: k(Math.round(300 * SSR_NAME_BOOST)), minFont: k(70), maxHeight: nameMaxH, boost: SSR_NAME_BOOST });
  const nameLayout = layoutTcgName(d.name, nameW, k(260), k(70), nameMaxH);
  const nameH = deco ? deco.height : Math.round(nameLayout.font * 1.12) * nameLayout.lines.length + Math.round(nameLayout.font * 0.2);
  const nameCY = artH * 0.6;
  const nameTop = Math.round(nameCY - nameH / 2);
  const nameFont = deco ? deco.font : nameLayout.font;
  const nameLines = deco ? Math.max(1, Math.round((nameH - nameFont * 0.2) / (nameFont * 1.12))) : nameLayout.lines.length;
  const glyphTop = nameTop + nameFont * 0.1 + nameFont * 0.56 - nameFont * 0.45;
  const crownW = k(230);
  const crownY = glyphTop - k(22) - crownW * 0.62;
  // 光の軌跡：名前を斜めに囲む楕円
  const orbit = { cx, cy: nameCY + (nameLines - 1) * 0, rx: artW * 0.47, ry: Math.max(nameH * 0.62, k(170)), rotate: -9 };
  const infoTop = artTop + artH + k(14);
  const infoH = innerH - infoTop - k(46);
  const secW = innerW - k(60);
  const traitFont = Math.max(k(30), Math.min(k(48), Math.floor((secW - k(330)) / Math.max(1, emWidth(d.trait) + 0.1))));
  const traitBody = d.traitBody?.trim() || BASIC_TRAIT_BODY;
  const bodyFont = (text: string) => Math.max(k(24), Math.min(k(36), Math.floor((secW - k(80)) / Math.max(1, emWidth(text) + 0.1))));
  const numaScore = typeof d.numaScore === 'number' && Number.isFinite(d.numaScore) ? Math.round(d.numaScore) : null;
  const n = d.works.length;
  const workFont = n === 1 ? k(44) : k(40);
  const workTextW = secW - k(360);
  const goldLine = `linear-gradient(90deg, rgba(217,169,58,0) 0%, #D9A93A 12%, #FFF1B8 50%, #D9A93A 88%, rgba(217,169,58,0) 100%)`;
  return (
    <div style={{ display: 'flex', position: 'relative', width: W, height: H, borderRadius: k(56) }}>
      {/* カード素材（src/server/oshi-card/ssr-assets.ts）：ホログラムの背景 → 金の装飾フレーム。文字・UI はこの上にコードで描く */}
      <img src={assets.bg} width={W} height={H} style={{ position: 'absolute', left: 0, top: 0 }} />
      <img src={assets.frame} width={W} height={H} style={{ position: 'absolute', left: 0, top: 0 }} />
      <div style={{ position: 'absolute', left: band, top: band, width: innerW, height: innerH, display: 'flex', borderRadius: k(26), overflow: 'hidden' }}>

        {/* ヘッダー：「推し」タグ・人物名・推し力（白い帯・金の縁・右端は斜め） */}
        <Svg w={innerW} h={headTop + headH} view={`0 0 ${innerW} ${headTop + headH}`} style={{ left: 0, top: 0 }}>
          <defs><linearGradient id="shg" x1="0" y1="0" x2="1" y2="1">{goldStops()}</linearGradient><linearGradient id="shtg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFF6CF" /><stop offset="0.45" stopColor="#F2CF6A" /><stop offset="1" stopColor="#C8932A" /></linearGradient></defs>
          <path d={`M ${k(30)} ${headTop + k(10)} L ${innerW - k(390)} ${headTop + k(10)} L ${innerW - k(440)} ${headTop + headH - k(8)} L ${k(30)} ${headTop + headH - k(8)} Q ${k(14)} ${headTop + headH - k(8)} ${k(14)} ${headTop + headH - k(26)} L ${k(14)} ${headTop + k(28)} Q ${k(14)} ${headTop + k(10)} ${k(30)} ${headTop + k(10)} Z`} fill="rgba(255,255,255,0.9)" stroke="url(#shg)" strokeWidth={k(5)} strokeLinejoin="round" />
          <path d={`M ${k(30)} ${headTop + k(18)} L ${innerW - k(400)} ${headTop + k(18)}`} stroke="rgba(255,255,255,0.95)" strokeWidth={k(6)} strokeLinecap="round" />
          <path d={`M ${k(24)} ${headTop + k(22)} L ${k(178)} ${headTop + k(22)} L ${k(196)} ${headTop + headH / 2 + k(1)} L ${k(178)} ${headTop + headH - k(20)} L ${k(24)} ${headTop + headH - k(20)} Z`} fill="url(#shtg)" stroke="#9A6A14" strokeWidth={k(3)} strokeLinejoin="round" />
        </Svg>
        <div style={{ position: 'absolute', left: k(24), top: headTop + k(22), width: k(160), height: headH - k(42), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: k(34), fontWeight: 700, color: SSR_INK, letterSpacing: k(2) }}>推し</div>
        <div style={{ position: 'absolute', left: k(220), top: headTop + k(10), width: innerW - k(220) - k(460), height: headH - k(18), display: 'flex', alignItems: 'center', gap: k(14), whiteSpace: 'nowrap' }}>
          <div style={{ display: 'flex', fontSize: Math.max(k(30), Math.min(k(50), Math.floor((innerW - k(1000)) / Math.max(1, emWidth(d.person) + 0.1)))), fontWeight: 700, color: SSR_INK }}>{d.person}</div>
          {d.group && <div style={{ display: 'flex', fontSize: k(22), fontWeight: 700, color: alpha(SSR_INK, 0.6), marginTop: k(10) }}>{d.group}</div>}
          <div style={{ display: 'flex', flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: k(6) }}>
            <div style={{ display: 'flex', fontSize: k(22), fontWeight: 700, color: alpha(SSR_INK, 0.75), marginBottom: k(6) }}>推し力</div>
            <div style={{ display: 'flex', fontSize: k(40), fontWeight: 700, color: SSR_INK }}>{formatOshiCardPower(d.power)}</div>
          </div>
        </div>
        <SsrBadge k={k} x={innerW - k(372)} y={headTop - k(12)} />

        {/* ── 名前面 ── */}
        <div style={{ position: 'absolute', left: 0, top: artTop, width: artW, height: artH, display: 'flex' }}>
          <LightOrbit w={artW} h={artH} cx={orbit.cx} cy={orbit.cy} rx={orbit.rx} ry={orbit.ry} rotate={orbit.rotate} part="back" />
          <CrystalCrown x={cx} y={crownY} width={crownW} gem={gem} />
          <div style={{ position: 'absolute', left: (artW - nameW) / 2, top: nameTop, width: nameW, height: nameH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {deco ? <div style={{ display: 'flex', position: 'relative', width: nameW, height: nameH }}>{deco.el}</div> : <FancyName name={d.name} width={nameW} maxFont={k(260)} minFont={k(70)} maxHeight={nameMaxH} t={t} />}
          </div>
          <LightOrbit w={artW} h={artH} cx={orbit.cx} cy={orbit.cy} rx={orbit.rx} ry={orbit.ry} rotate={orbit.rotate} part="front" />
          <Sparkle x={artW * 0.2} y={artH * 0.86} size={k(96)} color="#FFF3C8" glow="rgba(255,214,130,0.85)" />
          <CrystalStar x={artW * 0.8} y={artH * 0.88} size={k(150)} rotate={-8} />
          <Sparkle x={artW * 0.73} y={artH * 0.8} size={k(44)} color="#FFFFFF" glow="rgba(255,255,255,0.9)" />
        </div>

        {/* 名前面と情報面の区切り：金の細い2本線 */}
        <div style={{ position: 'absolute', left: k(20), top: infoTop - k(10), width: innerW - k(40), height: k(4), display: 'flex', backgroundImage: goldLine }} />
        <div style={{ position: 'absolute', left: k(60), top: infoTop - k(2), width: innerW - k(120), height: k(2), display: 'flex', backgroundImage: goldLine, opacity: 0.7 }} />
        <Sparkle x={innerW / 2} y={infoTop - k(8)} size={k(34)} color="#FFF6D0" glow="rgba(255,255,255,0.9)" />
        <Sparkle x={innerW * 0.2} y={infoTop - k(8)} size={k(22)} color="#FFFFFF" />
        <Sparkle x={innerW * 0.8} y={infoTop - k(8)} size={k(22)} color="#FFFFFF" />

        {/* ── 情報面（淡い白を重ねたホログラムの上） ── */}
        <div style={{ position: 'absolute', left: 0, top: infoTop, width: innerW, height: innerH - infoTop, display: 'flex', backgroundImage: 'radial-gradient(ellipse at 50% 35%, rgba(255,255,255,0.42) 0%, rgba(252,250,255,0.3) 50%, rgba(245,240,255,0.08) 100%)' }} />
        <div style={{ position: 'absolute', left: k(30), top: infoTop, width: secW, height: infoH, display: 'flex', flexDirection: 'column', padding: `${k(26)}px ${k(14)}px 0` }}>
          {/* 特性：紫のカプセル（金の縁）＋濃いピンクの太字＋金のきらめき、下に本文1行 */}
          <div style={{ display: 'flex', alignItems: 'center', height: k(70) }}>
            <div style={{ display: 'flex', position: 'relative', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: k(220), height: k(66), borderRadius: k(33), backgroundImage: 'linear-gradient(180deg, #A68BF2 0%, #7C5BE0 55%, #5B3FC4 100%)', border: `${k(3)}px solid #E2B64A`, boxShadow: `0 0 0 ${k(2)}px rgba(255,255,255,0.9), 0 ${k(3)}px ${k(6)}px rgba(60,40,140,0.35)` }}>
              <div style={{ position: 'absolute', left: k(16), right: k(16), top: k(4), height: k(18), display: 'flex', borderRadius: k(9), backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.05) 100%)' }} />
              <div style={{ display: 'flex', fontSize: k(36), fontWeight: 700, color: '#FFFFFF', letterSpacing: k(4) }}>特性</div>
            </div>
            <div style={{ display: 'flex', marginLeft: k(34), fontSize: traitFont, fontWeight: 700, color: '#B0145A', whiteSpace: 'nowrap' }}>{d.trait}</div>
            <svg width={k(40)} height={k(40)} viewBox="0 0 24 24" style={{ marginLeft: k(12) }}><path d={SPARKLE_D} fill="#F2C24E" /></svg>
          </div>
          <div style={{ display: 'flex', marginTop: k(22), paddingLeft: k(20), fontSize: bodyFont(traitBody), fontWeight: 700, color: SSR_INK, whiteSpace: 'nowrap' }}>{traitBody}</div>
          <div style={{ display: 'flex', marginTop: k(30), height: k(2), backgroundImage: goldLine, opacity: 0.8 }} />
          {/* 沼ポイント：宝石の丸3つ＋見出し（右に数値：入力がある場合だけ）、下に本文1行 */}
          <div style={{ display: 'flex', alignItems: 'center', height: k(72), marginTop: k(32) }}>
            <div style={{ display: 'flex', gap: k(4) }}>{[0, 1, 2].map((i) => <GemDot key={i} size={k(62)} />)}</div>
            <div style={{ display: 'flex', flex: 1, marginLeft: k(46), fontSize: k(46), fontWeight: 700, color: SSR_INK }}>沼ポイント</div>
            {numaScore !== null && <div style={{ display: 'flex', marginRight: k(30), fontSize: k(48), fontWeight: 700, color: SSR_INK }}>{numaScore}</div>}
          </div>
          <div style={{ display: 'flex', marginTop: k(24), paddingLeft: k(20), fontSize: bodyFont(d.numa), fontWeight: 700, color: SSR_INK, whiteSpace: 'nowrap' }}>{d.numa}</div>
          {/* おすすめ出演作品：淡い白の枠（金の細い縁）＋金のリボンの見出し＋箇条書き。右下にクリスタル、左下に金の唐草 */}
          <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', marginTop: k(40), flex: 1, marginBottom: k(4), borderRadius: k(24), padding: `${k(16)}px ${k(20)}px`, backgroundColor: 'rgba(255,255,255,0.4)', border: `${k(3)}px solid #E2C46E`, boxShadow: `0 0 0 ${k(2)}px rgba(255,255,255,0.8), 0 ${k(3)}px ${k(8)}px rgba(80,60,160,0.15)` }}>
            <div style={{ display: 'flex', position: 'relative', alignItems: 'center', width: k(600), height: k(80), flexShrink: 0 }}>
              <Svg w={k(600)} h={k(80)} view="0 0 600 80" style={{ left: 0, top: 0 }}>
                <defs><linearGradient id="swr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFF4C2" /><stop offset="0.45" stopColor="#F2CF6A" /><stop offset="1" stopColor="#C8932A" /></linearGradient></defs>
                <path d="M14 6 L596 6 L566 40 L596 74 L14 74 C8 74 4 70 4 64 L4 16 C4 10 8 6 14 6 Z" fill="url(#swr)" stroke="#9A6A14" strokeWidth="2.4" strokeLinejoin="round" />
                <path d="M14 11 L580 11 L576 17 L14 17 C11 17 9 15 9 14 Z" fill="rgba(255,255,255,0.65)" />
              </Svg>
              <div style={{ display: 'flex', alignItems: 'center', gap: k(14), marginLeft: k(20) }}>
                <Clapper size={k(46)} color="#3E5BD8" />
                <div style={{ display: 'flex', fontSize: k(36), fontWeight: 700, color: SSR_INK, letterSpacing: k(2) }}>おすすめ出演作品</div>
              </div>
            </div>
            {n === 0 ? (
              <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', fontSize: k(34), fontWeight: 700, color: alpha(SSR_INK, 0.7) }}>出演作品は推しサーチでチェック！</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, gap: k(14), paddingLeft: k(120) }}>
                {d.works.map((w, i) => {
                  const meta = w.year ? `（${w.typeLabel}・${w.year}）` : `（${w.typeLabel}）`;
                  const metaW = Math.round(k(26) * (emWidth(meta) + 0.4));
                  const { text, font } = fitTitle(w.title, workTextW - metaW, workFont, Math.round(workFont * 0.66), 1);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: k(14), whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', width: k(12), height: k(12), borderRadius: k(6), backgroundColor: SSR_INK }} />
                      <div style={{ display: 'flex', fontSize: font, fontWeight: 700, color: SSR_INK }}>{text}</div>
                      <div style={{ display: 'flex', fontSize: k(26), fontWeight: 700, color: alpha(SSR_INK, 0.6) }}>{meta}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
      {/* フッター（最前面）：フレームの下帯が太いため、左下の金の唐草を避けて唐草の右に2行で置く（1行目 推しサーチ・2行目 注記） */}
      {(
        <div style={{ position: 'absolute', left: k(SSR_FOOTER_LEFT), top: H - k(82), width: W - k(SSR_FOOTER_LEFT) - k(50), display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: k(4) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: k(8), padding: `${k(2)}px ${k(12)}px ${k(2)}px ${k(4)}px`, borderRadius: k(14), backgroundColor: 'rgba(255,255,255,0.82)' }}>
            <BrandMark size={k(26)} radius={k(6)} />
            <div style={{ display: 'flex', fontSize: k(20), fontWeight: 700, color: SSR_INK }}>{`推しサーチ  ${SITE_URL}`}</div>
          </div>
          <div style={{ display: 'flex', fontSize: k(15), fontWeight: 700, color: alpha(SSR_INK, 0.85), padding: `${k(2)}px ${k(10)}px`, borderRadius: k(12), backgroundColor: 'rgba(255,255,255,0.82)' }}>{TCG_NOTE}</div>
        </div>
      )}
    </div>
  );
}

/** B（SSR）は参考デザインBの専用レイアウト（SsrCard）で描く。下の従来の SSR の描画は使わない（型の絞り込みを避けるため関数で判定） */
function usesSsrReferenceLayout(v: OshiCardTcgVariant): boolean {
  return v === 'ssr';
}

/** カード1枚（幅 1260×s・高さ 1760×s） */
function TcgCard({ d, t, s }: { d: OshiCardTcgImageData; t: Theme; s: number }) {
  if (t.variant === 'basic') return <BasicCard d={d} t={t} s={s} />;
  if (usesSsrReferenceLayout(t.variant)) return <SsrCard d={d} t={t} s={s} />;
  const k = (n: number) => Math.round(n * s);
  const sk = skinOf(t);
  const W = k(BASE_W);
  const H = k(BASE_H);
  const frame = k(34);
  const innerW = W - frame * 2;
  const pad = k(26);
  const contentW = innerW - pad * 2;
  const headH = k(128);
  const windowH = k(820);
  const personFont = Math.max(k(28), Math.min(k(50), Math.floor((contentW - k(720)) / Math.max(1, emWidth(d.person) + 0.1))));
  return (
    <div style={{ display: 'flex', position: 'relative', width: W, height: H, borderRadius: k(64), backgroundImage: sk.frame, padding: frame, boxShadow: `inset 0 0 0 ${k(5)}px ${sk.frameEdge}` }}>
      {/* フレームの光沢（斜めの光） */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'flex', borderRadius: k(64), backgroundImage: 'linear-gradient(125deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.55) 42%, rgba(255,255,255,0) 52%)' }} />
      {/* B：虹色のフチに細かな光沢の縞と、白・紫の装飾ライン */}
      {t.variant === 'ssr' && <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'flex', borderRadius: k(64), backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0) 0px, rgba(255,255,255,0.45) 6px, rgba(255,255,255,0) 12px, rgba(255,255,255,0) 26px)' }} />}
      {t.variant === 'ssr' && <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'flex', borderRadius: k(64), backgroundImage: 'linear-gradient(125deg, rgba(255,255,255,0) 58%, rgba(255,255,255,0.5) 64%, rgba(255,255,255,0) 70%)' }} />}
      {t.variant === 'ssr' && <div style={{ position: 'absolute', left: k(9), top: k(9), width: W - k(18), height: H - k(18), display: 'flex', borderRadius: k(56), border: `${Math.max(1, k(3))}px solid rgba(255,255,255,0.95)` }} />}
      {t.variant === 'ssr' && <div style={{ position: 'absolute', left: k(17), top: k(17), width: W - k(34), height: H - k(34), display: 'flex', borderRadius: k(49), border: `${Math.max(1, k(2))}px solid rgba(106,75,200,0.7)` }} />}
      <div style={{ display: 'flex', flexDirection: 'column', position: 'relative', width: innerW, height: H - frame * 2, borderRadius: k(36), padding: pad, border: `${k(5)}px solid ${sk.bevel}`, ...sk.panel }}>
        {t.variant === 'ssr' && <div style={{ position: 'absolute', left: 0, top: 0, width: innerW - k(10), height: H - frame * 2 - k(10), display: 'flex', borderRadius: k(32), backgroundImage: 'repeating-linear-gradient(120deg, rgba(255,255,255,0) 0px, rgba(255,214,250,0.35) 40px, rgba(190,240,255,0.35) 80px, rgba(255,255,255,0) 120px, rgba(255,255,255,0) 220px)' }} />}
        {/* 上部：紋章・人物名・グループ・推し力 */}
        <div style={{ display: 'flex', alignItems: 'center', height: headH, gap: k(18) }}>
          <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center', width: k(92), height: k(92), borderRadius: k(46), fontSize: k(50), fontWeight: 700, ...sk.badge }}>{sk.emblem}</div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', fontSize: personFont, fontWeight: 700, lineHeight: 1.15, color: sk.headText, whiteSpace: 'nowrap' }}>{d.person}</div>
            <div style={{ display: 'flex', fontSize: k(26), fontWeight: 700, color: sk.headSub, whiteSpace: 'nowrap' }}>{d.group ? `${d.group} ・ 推し布教カード` : '推し布教カード'}</div>
          </div>
          <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', gap: k(10), height: k(96), padding: `0 ${k(24)}px`, borderRadius: k(24), ...sk.powerBox }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', fontSize: k(26), fontWeight: 700, color: sk.headSub, lineHeight: 1.1 }}>推し力</div>
              <div style={{ display: 'flex', fontSize: k(18), fontWeight: 700, color: sk.headSub }}>OSHI POWER</div>
            </div>
            <div style={{ display: 'flex', fontSize: k(62), fontWeight: 700, color: sk.powerText, letterSpacing: k(-1) }}>{formatOshiCardPower(d.power)}</div>
          </div>
          {/* レアリティ（右上） */}
          <Rarity t={t} k={k} label={sk.rarity} />
        </div>

        {/* 中央：装飾した名前（写真枠は置かない） */}
        <div style={{ display: 'flex', position: 'relative', marginTop: k(10), borderRadius: k(26), border: `${k(6)}px solid ${sk.windowBorder}`, boxShadow: `0 0 0 ${k(3)}px ${alpha('#000000', t.variant === 'legend' ? 0.6 : 0.12)}`, overflow: 'hidden' }}>
          <WindowArt t={t} k={k} w={contentW - k(12)} h={windowH} name={d.name} phrase={d.phrase} />
        </div>
        {/* 下部：特性・沼ポイント・おすすめ出演作品 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: k(14), marginTop: k(20) }}>
          <InfoRow k={k} sk={sk} label="特性" text={d.trait} width={contentW} />
          <InfoRow k={k} sk={sk} label="沼ポイント" text={d.numa} width={contentW} />
          <WorksBox k={k} sk={sk} works={d.works} width={contentW} height={k(300)} />
        </div>

        {/* フッター：推しサーチ・注記 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: k(14) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: k(12) }}>
            <BrandMark size={k(44)} radius={k(10)} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: k(26), fontWeight: 700, lineHeight: 1.1, color: sk.footText }}>推しサーチ</div>
              <div style={{ display: 'flex', fontSize: k(18), fontWeight: 700, color: sk.footText, opacity: 0.8 }}>{SITE_URL}</div>
            </div>
          </div>
          <div style={{ display: 'flex', width: contentW - k(330), justifyContent: 'flex-end', fontSize: k(16), lineHeight: 1.35, color: sk.footText, opacity: 0.8, textAlign: 'right' }}>{TCG_NOTE}</div>
        </div>
      </div>
      {/* B：四隅のキラキラ。フレームの角に重ねる（A は BasicCard で描く） */}
      {t.variant === 'ssr' && ([[k(52), k(52)], [W - k(52), k(52)], [k(52), H - k(52)], [W - k(52), H - k(52)]] as const).map(([x, y], i) => (
        <Sparkle key={`cn${i}`} x={x} y={y} size={k(58)} color="#FFFFFF" glow="rgba(255,255,255,0.7)" />
      ))}
    </div>
  );
}

// ─── サイズごとの組み立て ──────────────────────────────────────────────────────────

function backdropOf(t: Theme): CSSProperties {
  if (t.variant === 'basic') return { backgroundImage: `linear-gradient(180deg, ${t.c.light} 0%, #FFFFFF 50%, ${t.c.light} 100%)` };
  if (t.variant === 'ssr') return { backgroundImage: 'linear-gradient(160deg, #2A1B6B 0%, #5B3FC4 40%, #C35CC9 75%, #3B87D9 100%)' };
  return { backgroundImage: 'radial-gradient(ellipse at 50% 40%, #241C55 0%, #0C0A1C 60%, #040309 100%)' };
}

export function buildTcgCardImageElement(d: OshiCardTcgImageData, size: OshiCardImageSize, variant: OshiCardTcgVariant): ReactElement {
  const t = makeTheme(variant, d.color);
  const font = { fontFamily: OSHI_VOD_IMAGE_FONT_FAMILY };
  if (size === 'feed') {
    return <div style={{ display: 'flex', width: BASE_W, height: BASE_H, ...font }}><TcgCard d={d} t={t} s={1} /></div>;
  }
  const dark = variant !== 'basic';
  const textColor = dark ? '#FFFFFF' : '#3B1530';
  if (size === 'story') {
    const { width, height } = OSHI_CARD_IMAGE_SIZES.story;
    const s = 0.8;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width, height, padding: '86px 0 0', ...backdropOf(t), ...font }}>
        <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, color: textColor, letterSpacing: 4 }}>{`${variant === 'legend' ? '★' : '♡'} 推し布教カード ${variant === 'legend' ? '★' : '♡'}`}</div>
        <div style={{ display: 'flex', marginTop: 34 }}><TcgCard d={d} t={t} s={s} /></div>
        <div style={{ display: 'flex', marginTop: 40, padding: '16px 40px', borderRadius: 999, fontSize: 36, fontWeight: 700, color: dark ? '#1C0F45' : '#FFFFFF', backgroundColor: dark ? '#FFFFFF' : t.ring }}>あなたの推しでも作ってみて →</div>
        <div style={{ display: 'flex', marginTop: 18, fontSize: 30, fontWeight: 700, color: textColor, letterSpacing: 1 }}>{SITE_URL}</div>
      </div>
    );
  }
  // og：1200×630。カードは中央（LINE の正方形切り抜き x=285〜915 の内側）
  const s = 0.33;
  const cardW = Math.round(BASE_W * s);
  const cardH = Math.round(BASE_H * s);
  const side = (1200 - cardW) / 2;
  const deco = variant === 'legend' ? '#F4CF63' : '#FFFFFF';
  return (
    <div style={{ display: 'flex', position: 'relative', width: 1200, height: 630, ...backdropOf(t), ...font }}>
      <Rays w={1200} h={630} cx={600} cy={315} count={36} color={variant === 'legend' ? 'rgba(255,214,120,0.08)' : 'rgba(255,255,255,0.22)'} len={1300} />
      <Sparkle x={150} y={150} size={90} color={deco} />
      <Sparkle x={1060} y={470} size={100} color={deco} />
      <Sparkle x={240} y={490} size={50} color={deco} />
      <Sparkle x={960} y={130} size={56} color={deco} />
      <div style={{ position: 'absolute', left: side, top: (630 - cardH) / 2, display: 'flex' }}><TcgCard d={d} t={t} s={s} /></div>
      <div style={{ position: 'absolute', left: 40, bottom: 26, display: 'flex', alignItems: 'center', gap: 10 }}>
        <BrandMark size={34} radius={7} />
        <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, color: textColor }}>推しサーチ</div>
      </div>
    </div>
  );
}
