'use client';

/**
 * ストーリーズ1枚（1080×1920）の描画。座標はすべて 1080 基準の px。
 * プレビューは StoryScaled で縮小表示し、PNG はこのコンポーネントを等倍のまま描く（png-export.ts）。
 *
 * - Instagram の上部UI（〜250px）と下部の返信欄（1650px〜）には文字・画像を置かない。
 * - スタンプ（リンク・質問）の場所は空けておくだけ。本物のスタンプは Instagram アプリで置くため、
 *   ボタン風の図形・偽のスタンプ・枠は描かない（ガイドは showGuide のときだけ、保存画像には入らない）。
 * - 実画面の画像が必要なページで画像が未設定のときは、プレビューにだけ「未設定」の枠を出す（保存は管理画面側で止める）。
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  FONT_STACKS,
  type Decoration,
  type SlideDef,
  type SlideText,
  type StoryDesign,
  type StoryTemplateId,
} from '@/lib/story-maker/templates';
import { STORY_H, STORY_W } from './png-export';

export const SAFE_TOP = 250;
export const SAFE_BOTTOM = 1650;
const SIDE = 84;
const INNER_W = STORY_W - SIDE * 2;
const BRAND_H = 60;

export type ImageFit = 'top' | 'contain';
export interface SlideImage { src: string; fit: ImageFit }

export interface StorySlideProps {
  decoration: Decoration;
  def: SlideDef;
  /** 置き換え済みの文言 */
  text: SlideText;
  design: StoryDesign;
  index: number;
  total: number;
  image: SlideImage | null;
  showGuide: boolean;
  /** 質問スタンプに入れる質問文（ガイド表示用） */
  questionText?: string;
  /** テンプレート（A=vod だけ見出しの1行化・実画面の拡大レイアウトを使う。他は従来どおり） */
  templateId?: StoryTemplateId;
}

// ── 文字サイズの自動調整 ─────────────────────────────────────────

/** 1行の見た目の幅（全角=1、半角=0.58） */
export function visualWidth(line: string): number {
  let w = 0;
  for (const ch of line) w += /[ -~｡-ﾟ]/.test(ch) ? 0.58 : 1;
  return w;
}

/**
 * 最も長い行が maxWidth に収まる文字サイズ（base×倍率 を上限、min を下限）。
 * 人物名・グループ名が長いときは自動で小さくなる。下限でも収まらない行はブラウザが折り返す。
 */
export function fitFontSize(text: string, maxWidth: number, base: number, min: number, scale = 1): number {
  const lines = text.split('\n').filter((l) => l.trim());
  const widest = Math.max(1, ...lines.map(visualWidth));
  // 字間（0.02em）と句読点のぶら下がり分の余裕
  const fit = Math.floor(maxWidth / (widest * 1.04));
  return Math.max(min, Math.min(Math.round(base * scale), fit));
}

/**
 * 1行の見た目の幅（全角=1。半角は文字ごとに近い値：大文字・小文字・数字・空白・記号）に字間（0.02em×文字数）を足したもの。
 * visualWidth（半角=一律0.58）より英字の多い名前（Snow Man 等）で実際の幅に近い。テンプレートAの見出しで使う。
 */
export function headingLineWidth(line: string): number {
  let w = 0;
  let n = 0;
  for (const ch of line) {
    n++;
    if (/[MW@%]/.test(ch)) w += 0.86;
    else if (/[A-Z]/.test(ch)) w += 0.7;
    else if (/[mw]/.test(ch)) w += 0.82;
    else if (/[a-z]/.test(ch)) w += 0.56;
    else if (/[0-9]/.test(ch)) w += 0.6;
    else if (ch === ' ') w += 0.32;
    else if (/[!-/:-?[-`{-~]/.test(ch)) w += 0.4;
    else if (/[｡-ﾟ]/.test(ch)) w += 0.55;
    else w += 1;
  }
  return w + n * 0.02;
}

/**
 * テンプレートAの見出し：できるだけ1行（改行を詰めて）で表示し、1行だと小さすぎるときだけ改行する。
 * 改行は書かれた改行を優先し、それでも長い行は「推し」の前で分ける（「長いグループ名／推しの人！」）。
 * 返す lines はそのまま1行ずつ描く（fits=true なら折り返し不要）。
 */
export function fitStoryHeading(text: string, maxWidth: number, base: number, minOneLine: number, min: number, scale = 1): { lines: string[]; size: number; fits: boolean } {
  const cap = Math.round(base * scale);
  const sizeFor = (lines: string[]) => Math.floor(maxWidth / (Math.max(1, ...lines.map(headingLineWidth)) * 1.06));
  const authored = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (authored.length === 0) return { lines: [], size: cap, fits: true };
  const joined = [authored.join('')];
  const oneLine = sizeFor(joined);
  if (oneLine >= Math.min(minOneLine, cap)) return { lines: joined, size: Math.min(cap, oneLine), fits: true };
  const split = authored.flatMap((l) => {
    if (sizeFor([l]) >= Math.min(minOneLine, cap)) return [l];
    const at = l.lastIndexOf('推し');
    return at > 0 ? [l.slice(0, at), l.slice(at)] : [l];
  });
  const size = sizeFor(split);
  return { lines: split, size: Math.max(min, Math.min(cap, size)), fits: size >= min };
}

// ── 部品 ────────────────────────────────────────────────────────

function Lines({ text }: { text: string }) {
  const lines = text.split('\n');
  return <>{lines.map((l, i) => <span key={i} style={{ display: 'block' }}>{l || ' '}</span>)}</>;
}

const textBase: CSSProperties = {
  margin: 0,
  letterSpacing: '0.02em',
  overflowWrap: 'anywhere',
  lineBreak: 'strict',
  textAlign: 'center',
};

function Heading({ text, size, color, marker, noWrap }: { text: string; size: number; color: string; marker?: string; noWrap?: boolean }) {
  if (!text.trim()) return null;
  return (
    <h2 data-fit="heading" style={{ ...textBase, fontSize: size, lineHeight: 1.32, fontWeight: 800, color }}>
      {text.split('\n').map((l, i) => (
        <span key={i} style={{ display: 'block', ...(noWrap ? { whiteSpace: 'nowrap' } : {}) }}>
          <span style={marker ? { backgroundImage: `linear-gradient(transparent 62%, ${marker} 62%, ${marker} 92%, transparent 92%)`, padding: '0 0.08em' } : undefined}>{l || ' '}</span>
        </span>
      ))}
    </h2>
  );
}

function Sub({ text, size, color, background }: { text: string; size: number; color: string; background?: string }) {
  if (!text.trim()) return null;
  return (
    <p style={{ ...textBase, fontSize: size, lineHeight: 1.5, fontWeight: 700, color, ...(background ? { background, borderRadius: 999, padding: '10px 36px', alignSelf: 'center' } : {}) }}>
      <Lines text={text} />
    </p>
  );
}

/** 推しサーチの表記（上部UIの直下）。ロゴ画像は使わず文字だけ */
function Brand({ color, bg }: { color: string; bg: string }) {
  return (
    <div style={{ position: 'absolute', top: SAFE_TOP, left: 0, right: 0, height: BRAND_H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, background: bg, borderRadius: 999, padding: '8px 28px', fontSize: 30, fontWeight: 800, color, letterSpacing: '0.06em' }}>
        <span style={{ fontSize: 26 }}>★</span>推しサーチ
      </span>
    </div>
  );
}

function PageDots({ index, total, color }: { index: number; total: number; color: string }) {
  if (total < 2) return null;
  return (
    <div style={{ position: 'absolute', top: SAFE_TOP + BRAND_H + 6, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 12 }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} style={{ width: i === index ? 40 : 14, height: 14, borderRadius: 7, background: color, opacity: i === index ? 0.9 : 0.3 }} />
      ))}
    </div>
  );
}

/** 実画面の画像。枠は白い角丸＋影（スマホ画面の雰囲気。ボタンや架空の画面は描かない） */
function ScreenImage({ image, height, width, decoration, accent, showGuide, hint }: { image: SlideImage | null; height: number | string; width: number | string; decoration: Decoration; accent: string; showGuide: boolean; hint?: string }) {
  const polaroid = decoration === 'polaroid';
  const pad = polaroid ? 22 : 16;
  const frame: CSSProperties = {
    width,
    height,
    background: '#FFFFFF',
    borderRadius: polaroid ? 14 : 44,
    padding: polaroid ? `${pad}px ${pad}px ${pad + 34}px` : pad,
    boxShadow: '0 18px 40px rgba(59,47,42,0.18)',
    transform: polaroid ? 'rotate(-1.6deg)' : undefined,
    position: 'relative',
    flexShrink: 0,
    alignSelf: 'center',
  };
  const innerRadius = polaroid ? 6 : 30;
  return (
    <div style={frame} data-slot="image">
      {polaroid && <Tape color={accent} />}
      {image ? (
        <img
          src={image.src}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: image.fit === 'top' ? 'cover' : 'contain', objectPosition: 'top center', borderRadius: innerRadius, background: '#F4F1EA', display: 'block' }}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', borderRadius: innerRadius, border: '6px dashed #E26A6A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: '#C24848', fontSize: 34, fontWeight: 800, textAlign: 'center', padding: 30, background: '#FFF1F1' }}>
          <span>実際の画面が未設定です</span>
          {hint && <span style={{ fontSize: 26, fontWeight: 600 }}>{hint}</span>}
        </div>
      )}
    </div>
  );
}

function Tape({ color }: { color: string }) {
  return <span style={{ position: 'absolute', top: -22, left: '50%', width: 180, height: 46, marginLeft: -90, background: color, opacity: 0.75, transform: 'rotate(3deg)', borderRadius: 4 }} />;
}

/** CTA（スタンプの上）：ボタンに見えないよう、図形ではなく文字＋マーカー＋矢印だけで示す */
function CtaBlock({ cta, caption, color, accent, scale }: { cta: string; caption: string; color: string; accent: string; scale: number }) {
  const ctaSize = fitFontSize(`↓ ${cta} ↓`, INNER_W, 64, 40, scale);
  const capSize = fitFontSize(caption, INNER_W, 36, 26, scale);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      {cta.trim() && (
        <p style={{ ...textBase, fontSize: ctaSize, fontWeight: 800, color, lineHeight: 1.3 }}>
          <span style={{ backgroundImage: `linear-gradient(transparent 58%, ${accent} 58%, ${accent} 94%, transparent 94%)`, padding: '0 0.1em' }}>↓ {cta} ↓</span>
        </p>
      )}
      {caption.trim() && <p style={{ ...textBase, fontSize: capSize, fontWeight: 700, color, opacity: 0.85, lineHeight: 1.4 }}>{caption}</p>}
    </div>
  );
}

/**
 * テンプレートAの CTA（スタンプの真上）：「無料で診断する ↓」。文字に線を重ねない（マーカーなし）。
 * 文字の下に離して短い線を1本だけ置く（ボタン・スタンプに見える枠や図形は描かない）。
 */
function VodCta({ cta, size, color, accent }: { cta: string; size: number; color: string; accent: string }) {
  if (!cta.trim()) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <p style={{ ...textBase, fontSize: size, fontWeight: 800, color, lineHeight: 1.25, whiteSpace: 'nowrap' }}>{cta} ↓</p>
      <span style={{ width: 120, height: 8, borderRadius: 4, background: accent, opacity: 0.9 }} />
    </div>
  );
}

/** テンプレートAの CTA 部分の高さ（文字＋間＋線） */
const vodCtaHeight = (size: number) => Math.round(size * 1.25) + 12 + 8;

function PointsList({ body, color, accent, card, scale, compact }: { body: string; color: string; accent: string; card: string; scale: number; compact: boolean }) {
  const items = body.split('\n').map((s) => s.trim()).filter(Boolean);
  if (items.length === 0) return null;
  const size = Math.min(...items.map((t) => fitFontSize(t, INNER_W - 200, compact ? 40 : 46, 28, scale)));
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: compact ? 16 : 24, width: INNER_W, alignSelf: 'center' }}>
      {items.map((t, i) => (
        <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 26, background: card, borderRadius: 32, padding: compact ? '20px 30px' : '28px 34px', boxShadow: '0 8px 0 rgba(59,47,42,0.08)' }}>
          <span style={{ flexShrink: 0, width: 72, height: 72, borderRadius: 36, background: accent, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, fontWeight: 800 }}>{i + 1}</span>
          <span style={{ fontSize: size, fontWeight: 700, color, lineHeight: 1.4, overflowWrap: 'anywhere' }}>{t}</span>
        </li>
      ))}
    </ol>
  );
}

// ── 装飾（テンプレートごとに変える。文字・画像の領域の外側だけ） ─────────────

function Decorations({ decoration, accent, sub }: { decoration: Decoration; accent: string; sub: string }) {
  const items: ReactNode[] = [];
  const glyph = (key: string, ch: string, x: number, y: number, size: number, color: string, rot = 0, opacity = 0.9) =>
    items.push(<span key={key} style={{ position: 'absolute', left: x, top: y, fontSize: size, lineHeight: 1, color, opacity, transform: `rotate(${rot}deg)` }}>{ch}</span>);
  switch (decoration) {
    case 'bubble':
      items.push(<span key="c1" style={{ position: 'absolute', left: -120, top: 120, width: 340, height: 340, borderRadius: '50%', background: sub, opacity: 0.55 }} />);
      items.push(<span key="c2" style={{ position: 'absolute', right: -90, bottom: 120, width: 300, height: 300, borderRadius: '50%', background: accent, opacity: 0.35 }} />);
      glyph('s1', '●', 960, 300, 26, accent);
      glyph('s2', '●', 70, 1500, 22, accent);
      break;
    case 'polaroid':
      for (let i = 0; i < 9; i++) items.push(<span key={`d${i}`} style={{ position: 'absolute', left: 40 + (i % 3) * 36, top: 1560 + Math.floor(i / 3) * 36, width: 14, height: 14, borderRadius: 7, background: accent, opacity: 0.6 }} />);
      for (let i = 0; i < 9; i++) items.push(<span key={`e${i}`} style={{ position: 'absolute', right: 40 + (i % 3) * 36, top: 340 + Math.floor(i / 3) * 36, width: 14, height: 14, borderRadius: 7, background: accent, opacity: 0.6 }} />);
      break;
    case 'hearts':
      glyph('h1', '♡', 60, 330, 90, accent, -12);
      glyph('h2', '♥', 940, 420, 64, accent, 10, 0.7);
      glyph('h3', '♡', 950, 1480, 80, accent, 14);
      glyph('h4', '♥', 70, 1540, 54, accent, -8, 0.7);
      break;
    case 'sparkle':
      glyph('k1', '✦', 70, 360, 76, accent);
      glyph('k2', '✧', 950, 330, 60, accent);
      glyph('k3', '✦', 960, 1500, 64, accent);
      glyph('k4', '✧', 60, 1560, 50, accent);
      break;
    case 'steps':
      items.push(<span key="st" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 250, backgroundImage: `repeating-linear-gradient(-45deg, ${accent} 0 26px, transparent 26px 52px)`, opacity: 0.25 }} />);
      items.push(<span key="sb" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 270, backgroundImage: `repeating-linear-gradient(-45deg, ${accent} 0 26px, transparent 26px 52px)`, opacity: 0.25 }} />);
      break;
  }
  return <>{items}</>;
}

// ── スタンプの位置 ────────────────────────────────────────────────

const LINK_HALF = 80;
const QUESTION_HALF = 190;

export function stickerZone(kind: 'link' | 'question', linkPos: number): { top: number; bottom: number; center: number } {
  const center = Math.round((STORY_H * linkPos) / 100);
  const half = kind === 'link' ? LINK_HALF : QUESTION_HALF;
  // 下部の返信欄にかからないよう、下端を SAFE_BOTTOM 以内に収める
  const bottom = Math.min(SAFE_BOTTOM - 70, center + half);
  return { top: bottom - half * 2, bottom, center: bottom - half };
}

function Guides({ zone, kind, questionText }: { zone: { top: number; bottom: number } | null; kind: 'link' | 'question' | 'none'; questionText?: string }) {
  return (
    <div data-guide style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: SAFE_TOP, background: 'rgba(30,30,30,0.28)', color: '#fff', fontSize: 30, fontWeight: 700, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 18 }}>Instagram 上部UI（文字を置かない）</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: SAFE_BOTTOM, bottom: 0, background: 'rgba(30,30,30,0.28)', color: '#fff', fontSize: 30, fontWeight: 700, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 18 }}>返信欄など（文字を置かない）</div>
      {zone && kind !== 'none' && (
        <div style={{ position: 'absolute', left: kind === 'link' ? 250 : 150, right: kind === 'link' ? 250 : 150, top: zone.top, height: zone.bottom - zone.top, border: '6px dashed #7C3AED', borderRadius: 28, background: 'rgba(124,58,237,0.10)', color: '#5B21B6', fontSize: 30, fontWeight: 800, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 8 }}>
          <span>{kind === 'link' ? 'ここにリンクスタンプ' : 'ここに質問スタンプ'}</span>
          {kind === 'question' && questionText && <span style={{ fontSize: 34 }}>「{questionText}」</span>}
          <span style={{ fontSize: 22, fontWeight: 600 }}>（ガイド表示・画像には入りません）</span>
        </div>
      )}
    </div>
  );
}

// ── 本体 ────────────────────────────────────────────────────────

/** テンプレートAの実画面の大きさ（診断結果画像 feed は 4:5。縦横比を保ったまま、見出し・CTA・スタンプの間に収める） */
const VOD_IMAGE_RATIO = 0.8;
const VOD_IMAGE_MAX_H = 600;
const VOD_GAP = 28;

/**
 * テンプレートAの「実画面」ページ：見出し（できるだけ1行）→ 大きな実画面 → 「無料で診断する ↓」→ スタンプの余白 → 説明文。
 * 画像はスタンプの上と下の広いほうに置く（リンク位置 50% なら下、60・70% なら上）。
 */
function VodScreenSlide({ decoration, def, text, design, index, total, image, showGuide, questionText }: StorySlideProps) {
  const { colors, fontScale } = design;
  const font = FONT_STACKS[design.font].stack;
  const contentTop = SAFE_TOP + BRAND_H + (total > 1 ? 40 : 20);
  const zone = def.sticker === 'none' ? null : stickerZone(def.sticker, design.linkPos);
  const hasLink = zone !== null && def.sticker === 'link';

  const head = fitStoryHeading(text.heading, INNER_W, 72, 52, 40, fontScale);
  const headH = head.lines.length > 0 ? Math.ceil(head.lines.length * head.size * 1.32) : 0;
  const subSize = fitFontSize(text.subheading, INNER_W - 40, 40, 28, fontScale);
  const subLines = text.subheading.split('\n').filter((l) => l.trim()).length;
  const subH = subLines > 0 ? Math.ceil(subLines * subSize * 1.5) : 0;
  const textH = headH + (headH > 0 && subH > 0 ? 16 : 0) + subH;
  const noteH = text.note.trim() ? 70 : 0;

  const ctaSize = fitFontSize(`${text.cta} ↓`, INNER_W, 60, 40, fontScale);
  const ctaH = hasLink && text.cta.trim() ? vodCtaHeight(ctaSize) : 0;
  const capSize = fitFontSize(text.stickerCaption, INNER_W, 34, 24, fontScale);
  const capH = hasLink && text.stickerCaption.trim() ? Math.ceil(capSize * 1.4) : 0;

  // 上の領域（見出しの下〜CTAの上）と下の領域（スタンプ下の説明文の下〜返信欄の上）
  const upperLimit = zone ? zone.top - 12 - ctaH - (ctaH > 0 ? VOD_GAP : 0) : SAFE_BOTTOM - noteH - 16;
  const aboveH = upperLimit - (contentTop + textH + VOD_GAP);
  const lowerStart = zone ? zone.bottom + 14 + (capH > 0 ? capH : 0) + VOD_GAP : SAFE_BOTTOM;
  const belowH = SAFE_BOTTOM - noteH - 16 - lowerStart;
  const below = zone !== null && belowH > aboveH;
  let imgH = Math.min(Math.max(240, below ? belowH : aboveH), VOD_IMAGE_MAX_H);
  let imgW = Math.round(imgH * VOD_IMAGE_RATIO);
  if (imgW > INNER_W) { imgW = INNER_W; imgH = Math.round(imgW / VOD_IMAGE_RATIO); }

  // 画像が上：見出し＋画像をまとめて上の領域の中央へ。画像が下：見出しだけ上の領域の中央へ
  const groupH = below ? textH : textH + VOD_GAP + imgH;
  const textTop = contentTop + Math.max(0, Math.floor((upperLimit - contentTop - groupH) / 2));
  const imgTop = below ? lowerStart + Math.max(0, Math.floor((belowH - imgH) / 2)) : textTop + textH + VOD_GAP;

  return (
    <div
      data-story-frame
      style={{ position: 'relative', width: STORY_W, height: STORY_H, overflow: 'hidden', background: colors.bg, fontFamily: font, color: colors.text, WebkitFontSmoothing: 'antialiased' }}
    >
      <Decorations decoration={decoration} accent={colors.accent} sub={colors.sub} />
      <Brand color={colors.text} bg={colors.sub} />
      <PageDots index={index} total={total} color={colors.text} />

      <div data-fit-area="upper" style={{ position: 'absolute', left: SIDE, right: SIDE, top: textTop, height: textH + 4, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' }}>
        <Heading text={head.lines.join('\n')} size={head.size} color={colors.text} noWrap={head.fits} />
        <Sub text={text.subheading} size={subSize} color={colors.text} />
      </div>

      <div style={{ position: 'absolute', left: Math.round((STORY_W - imgW) / 2), top: imgTop, width: imgW, height: imgH }}>
        <ScreenImage image={image} height={imgH} width={imgW} decoration={decoration} accent={colors.accent} showGuide={showGuide} hint={def.imageHint} />
      </div>

      {zone && ctaH > 0 && (
        <div style={{ position: 'absolute', left: SIDE, right: SIDE, top: zone.top - 12 - ctaH, height: ctaH, display: 'flex', justifyContent: 'center' }}>
          <VodCta cta={text.cta} size={ctaSize} color={colors.text} accent={colors.accent} />
        </div>
      )}
      {zone && capH > 0 && (
        <div style={{ position: 'absolute', left: SIDE, right: SIDE, top: zone.bottom + 14, height: capH, display: 'flex', justifyContent: 'center' }}>
          <p style={{ ...textBase, fontSize: capSize, fontWeight: 700, color: colors.text, opacity: 0.85, lineHeight: 1.4 }}>{text.stickerCaption}</p>
        </div>
      )}

      {text.note.trim() && (
        <div style={{ position: 'absolute', left: SIDE, right: SIDE, top: SAFE_BOTTOM - noteH, height: noteH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ ...textBase, fontSize: fitFontSize(text.note, INNER_W, 34, 24, fontScale), fontWeight: 700, color: colors.text, opacity: 0.8 }}>{text.note}</p>
        </div>
      )}

      {showGuide && <Guides zone={zone} kind={def.sticker} questionText={questionText} />}
    </div>
  );
}

export function StorySlide(props: StorySlideProps) {
  const vod = props.templateId === 'vod';
  if (vod && props.def.layout === 'screen') return <VodScreenSlide {...props} />;
  return <BaseSlide {...props} vod={vod} />;
}

function BaseSlide({ decoration, def, text, design, index, total, image, showGuide, questionText, vod }: StorySlideProps & { vod: boolean }) {
  const { colors, fontScale } = design;
  const font = FONT_STACKS[design.font].stack;
  const contentTop = SAFE_TOP + BRAND_H + (total > 1 ? 40 : 20);
  const zone = def.sticker === 'none' ? null : stickerZone(def.sticker, design.linkPos);
  const showImage = def.image === 'required' || (def.image === 'optional' && image !== null);
  const hasCta = def.sticker === 'link' && (text.cta.trim() || text.stickerCaption.trim());
  const marker = decoration === 'polaroid' || decoration === 'steps' ? colors.accent : undefined;

  // テンプレートA：CTA は「無料で診断する ↓」だけをスタンプの上に、説明文はスタンプの下に置く（文字に線を重ねない）
  const vodCtaSize = fitFontSize(`${text.cta} ↓`, INNER_W, 64, 40, fontScale);
  const vodCapSize = fitFontSize(text.stickerCaption, INNER_W, 34, 24, fontScale);
  const vodCapH = vod && def.sticker === 'link' && text.stickerCaption.trim() ? Math.ceil(vodCapSize * 1.4) : 0;

  // スタンプの上に置く CTA・説明文の高さ（目安）
  const ctaH = def.sticker === 'link'
    ? (vod ? (text.cta.trim() ? vodCtaHeight(vodCtaSize) : 0) + 26 : (text.cta.trim() ? 96 : 0) + (text.stickerCaption.trim() ? 64 : 0) + 24)
    : def.sticker === 'question' ? (text.stickerCaption.trim() ? 80 : 20) : 0;
  const noteH = text.note.trim() ? 70 : 0;

  // 縦の領域: 上の領域（本文）／スタンプ／下の領域（補足・場合によって画像）
  const upperBottom = zone ? zone.top - ctaH - 20 : SAFE_BOTTOM - noteH - 20;
  const lowerTop = zone ? zone.bottom + 30 + (vodCapH > 0 ? vodCapH + 14 : 0) : SAFE_BOTTOM;
  const lowerSpace = SAFE_BOTTOM - lowerTop - noteH;
  // スタンプが上寄り（50%）で下の領域が広いときは、画像をスタンプの下に置く
  const imageBelow = showImage && zone !== null && lowerSpace >= 420;

  const hasImageAbove = showImage && !imageBelow;
  const headingBase = def.layout === 'hook' ? 104 : hasImageAbove ? 72 : def.layout === 'question' || def.layout === 'cta' ? 92 : 80;
  const headingSize = fitFontSize(text.heading, INNER_W, headingBase, 44, fontScale);
  const subSize = fitFontSize(text.subheading, INNER_W - 40, def.layout === 'hook' ? 50 : 42, 28, fontScale);
  const bodySize = fitFontSize(text.body, INNER_W, 40, 26, fontScale);
  const labelLike = (def.layout === 'screen' || def.layout === 'combined') && text.subheading.trim().length > 0 && text.subheading.length <= 16 && !text.subheading.includes('\n');
  // テンプレートA：見出しはできるだけ1行（「Snow Man推しの人！」）。長い名前だけ「推し」の前で改行
  const bubbleHook = def.layout === 'hook' && decoration === 'bubble';
  const vodHead = vod ? fitStoryHeading(text.heading, bubbleHook ? INNER_W - 80 : INNER_W, headingBase, def.layout === 'hook' ? 64 : 52, 40, fontScale) : null;

  const upperAreaH = upperBottom - contentTop;
  const textBlock = (
    <>
      {labelLike && <Sub text={text.subheading} size={Math.min(subSize, 38)} color={colors.text} background={colors.sub} />}
      {bubbleHook ? (
        <div style={{ position: 'relative', background: '#FFFFFF', borderRadius: 60, padding: '64px 40px', boxShadow: '0 14px 0 rgba(59,47,42,0.10)', width: INNER_W, alignSelf: 'center' }}>
          {vodHead
            ? <Heading text={vodHead.lines.join('\n')} size={vodHead.size} color={colors.text} noWrap={vodHead.fits} />
            : <Heading text={text.heading} size={Math.min(headingSize, fitFontSize(text.heading, INNER_W - 80, headingBase, 44, fontScale))} color={colors.text} />}
          <span style={{ position: 'absolute', bottom: -44, left: '50%', marginLeft: -36, width: 0, height: 0, borderLeft: '36px solid transparent', borderRight: '36px solid transparent', borderTop: '48px solid #FFFFFF' }} />
        </div>
      ) : def.layout === 'question' && decoration === 'hearts' ? (
        <div style={{ background: colors.sub, borderRadius: 64, padding: '52px 36px', width: INNER_W, alignSelf: 'center' }}>
          <Heading text={text.heading} size={Math.min(headingSize, fitFontSize(text.heading, INNER_W - 72, headingBase, 44, fontScale))} color={colors.text} />
        </div>
      ) : vodHead ? (
        <Heading text={vodHead.lines.join('\n')} size={vodHead.size} color={colors.text} marker={marker} noWrap={vodHead.fits} />
      ) : (
        <Heading text={text.heading} size={headingSize} color={colors.text} marker={marker} />
      )}
      {!labelLike && <Sub text={text.subheading} size={subSize} color={colors.text} background={def.layout === 'hook' ? colors.sub : undefined} />}
      {def.layout === 'points'
        ? <PointsList body={text.body} color={colors.text} accent={colors.accent} card={colors.sub} scale={fontScale} compact={zone !== null} />
        : text.body.trim() && <p style={{ ...textBase, fontSize: bodySize, lineHeight: 1.6, fontWeight: 600, color: colors.text }}><Lines text={text.body} /></p>}
    </>
  );

  const imgWidth = (h: number) => Math.min(INNER_W - 40, Math.round(h * 1.05));

  return (
    <div
      data-story-frame
      style={{ position: 'relative', width: STORY_W, height: STORY_H, overflow: 'hidden', background: colors.bg, fontFamily: font, color: colors.text, WebkitFontSmoothing: 'antialiased' }}
    >
      <Decorations decoration={decoration} accent={colors.accent} sub={colors.sub} />
      <Brand color={colors.text} bg={colors.sub} />
      <PageDots index={index} total={total} color={colors.text} />

      {/* 上の領域：本文（＋画像） */}
      <div
        data-fit-area="upper"
        style={{ position: 'absolute', left: SIDE, right: SIDE, top: contentTop, height: upperAreaH, display: 'flex', flexDirection: 'column', justifyContent: hasImageAbove ? 'flex-start' : 'center', gap: 34, overflow: 'hidden' }}
      >
        {textBlock}
        {hasImageAbove && (
          <FlexImage>
            <ScreenImage image={image} height="100%" width="100%" decoration={decoration} accent={colors.accent} showGuide={showGuide} hint={def.imageHint} />
          </FlexImage>
        )}
      </div>

      {/* スタンプ直上：CTA・説明文 */}
      {zone && hasCta && (
        <div style={{ position: 'absolute', left: SIDE, right: SIDE, top: zone.top - ctaH, height: ctaH, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 14 }}>
          {vod
            ? <VodCta cta={text.cta} size={vodCtaSize} color={colors.text} accent={colors.accent} />
            : <CtaBlock cta={text.cta} caption={text.stickerCaption} color={colors.text} accent={colors.accent} scale={fontScale} />}
        </div>
      )}
      {zone && vodCapH > 0 && (
        <div style={{ position: 'absolute', left: SIDE, right: SIDE, top: zone.bottom + 14, height: vodCapH, display: 'flex', justifyContent: 'center' }}>
          <p style={{ ...textBase, fontSize: vodCapSize, fontWeight: 700, color: colors.text, opacity: 0.85, lineHeight: 1.4 }}>{text.stickerCaption}</p>
        </div>
      )}
      {zone && def.sticker === 'question' && text.stickerCaption.trim() && (
        <div style={{ position: 'absolute', left: SIDE, right: SIDE, top: zone.top - ctaH, height: ctaH, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 16 }}>
          <p style={{ ...textBase, fontSize: fitFontSize(text.stickerCaption, INNER_W, 40, 28, fontScale), fontWeight: 800, color: colors.text }}>▼ {text.stickerCaption} ▼</p>
        </div>
      )}

      {/* スタンプの下：画像（スタンプが上寄りのとき） */}
      {imageBelow && (
        <div data-fit-area="lower" style={{ position: 'absolute', left: SIDE, right: SIDE, top: lowerTop, height: lowerSpace, display: 'flex', justifyContent: 'center' }}>
          <ScreenImage image={image} height={lowerSpace - 10} width={imgWidth(lowerSpace - 10)} decoration={decoration} accent={colors.accent} showGuide={showGuide} hint={def.imageHint} />
        </div>
      )}

      {/* 補足文 */}
      {text.note.trim() && (
        <div style={{ position: 'absolute', left: SIDE, right: SIDE, top: SAFE_BOTTOM - noteH, height: noteH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ ...textBase, fontSize: fitFontSize(text.note, INNER_W, 34, 24, fontScale), fontWeight: 700, color: colors.text, opacity: 0.8 }}>{text.note}</p>
        </div>
      )}

      {showGuide && <Guides zone={zone} kind={def.sticker} questionText={questionText} />}
    </div>
  );
}

/**
 * 本文の下の残りの高さいっぱいに画像を置く箱。本文の高さは文言で変わるため flex で決め、
 * 横幅は高さ×1.05（上限は本文幅）。画像は箱いっぱい（100%）に描く。
 */
function FlexImage({ children }: { children: ReactNode }) {
  return (
    <div style={{ flex: 1, minHeight: 240, display: 'flex', justifyContent: 'center' }}>
      <div style={{ height: '100%', aspectRatio: '1.05 / 1', maxWidth: INNER_W - 40, display: 'flex' }}>
        {children}
      </div>
    </div>
  );
}

/** プレビュー用：1080×1920 を指定の幅に縮小して表示 */
export function StoryScaled({ width, children }: { width: number; children: ReactNode }) {
  const scale = width / STORY_W;
  return (
    <div style={{ width, height: STORY_H * scale, overflow: 'hidden', position: 'relative', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
      <div style={{ width: STORY_W, height: STORY_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{children}</div>
    </div>
  );
}
