'use client';

/**
 * 楽天BF・推し別セール紹介（Instagram 通常投稿 1080×1350・3〜4枚）の描画。黒×ゴールド（B案）を Instagram 向けに強めたデザイン。
 * - 表紙：「最大◯%OFF」を最も大きく（赤＋白縁）。推しの名前・紹介する商品の種類（採用した商品から）・セール名と期間。
 *   金の光・紙吹雪・キラキラは文字に重ならない四隅と端だけに控えめに置く。プロフィール一覧の縮小表示でも読める大きさにする
 * - 商品ページ（1〜2枚）：承認済みの商品を1ページ3件（最大6件）。商品画像は白地の枠に縦横比を保って大きく表示し、画像に文字を重ねない。
 *   価格の表記（通常価格 等）・セール価格・割引率（赤いバッジ）・◯円OFF。条件付きの値下げは適用条件を独立した行で表示。
 *   何ページ目かは index（表紙の次が商品ページ1）から決める
 * - 最終ページ：プロフィールのリンクから推しサーチへ（矢印は使わない）。サイト名・oshi-search.jp を大きく
 * 価格・割引率は props.sale（管理画面の承認欄で確認した値）だけを描き、無いときは数字を出さない。
 * 楽天のロゴ・画像は使わない（商品画像は商品データの画像をサーバーで取得したもの）。
 */

import type { CSSProperties, ReactNode } from 'react';
import { FONT_STACKS } from '@/lib/story-maker/templates';
import { BF_FRAME_H, bfCategoryLine, bfConditionText, bfPageItems, formatYen, type BfSlideItem } from '@/lib/story-maker/bf-sale';
import type { StorySlideProps } from './StorySlide';

const W = 1080;
const H = BF_FRAME_H;
const GOLD = '#E3C26F';
const GOLD_LIGHT = '#F6E3A8';
const GOLD_DEEP = '#B8913A';
const RED = '#E0262E';
const RED_DEEP = '#9E1219';
const BG = '#0B0A0D';
const CARD = '#17151B';
const CREAM = '#F4ECD8';
const MUTED = '#A79F8E';
const PR_TEXT = 'PR（楽天アフィリエイト広告を含みます）';
/** 左右の余白（枠の内側） */
const SIDE = 72;

/** 1行に収める文字サイズ（全角1・半角0.6で見積もる） */
function fitOneLine(text: string, maxWidth: number, base: number, min: number): number {
  const w = Array.from(text).reduce((n, ch) => n + (/[\x20-\x7e]/.test(ch) ? 0.6 : 1), 0);
  if (w === 0) return base;
  return Math.max(min, Math.min(base, Math.floor(maxWidth / w)));
}

/** 縁取り（text-shadow を重ねる。foreignObject → canvas でも同じ見た目になる） */
function outline(px: number, color = '#FFFFFF'): string {
  const steps = 16;
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    return `${(Math.cos(a) * px).toFixed(1)}px ${(Math.sin(a) * px).toFixed(1)}px 0 ${color}`;
  }).join(', ');
}

function Lines({ text }: { text: string }) {
  const lines = text.split('\n');
  return <>{lines.map((l, i) => <span key={i} style={{ display: 'block' }}>{l || ' '}</span>)}</>;
}

function Frame({ children, font }: { children: ReactNode; font: string }) {
  return (
    <div
      data-story-frame
      style={{ position: 'relative', width: W, height: H, overflow: 'hidden', background: BG, fontFamily: font, color: '#FFFFFF', WebkitFontSmoothing: 'antialiased' }}
    >
      {/* 背景の金の光と二重線の枠 */}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 0%, rgba(227,194,111,0.22), rgba(11,10,13,0) 55%), radial-gradient(circle at 50% 110%, rgba(184,145,58,0.2), rgba(11,10,13,0) 50%)` }} />
      <div style={{ position: 'absolute', left: 32, top: 32, right: 32, bottom: 32, border: `3px solid ${GOLD}` }} />
      <div style={{ position: 'absolute', left: 44, top: 44, right: 44, bottom: 44, border: `1px solid rgba(227,194,111,0.45)` }} />
      {children}
    </div>
  );
}

function Pr() {
  return <div style={{ position: 'absolute', left: SIDE, top: 62, fontSize: 22, color: MUTED, letterSpacing: 1 }}>{PR_TEXT}</div>;
}

function PageNo({ index, total }: { index: number; total: number }) {
  return <div style={{ position: 'absolute', right: SIDE, top: 62, fontSize: 22, color: GOLD, fontWeight: 700, letterSpacing: 2 }}>{index + 1} / {total}</div>;
}

const center: CSSProperties = { position: 'absolute', left: SIDE, right: SIDE, textAlign: 'center' };

// ── 表紙の飾り（固定の位置。毎回同じ画像になるよう乱数は使わない） ───────────────
/** 4本の光のキラキラ */
function Sparkle({ x, y, size, opacity = 0.85 }: { x: number; y: number; size: number; opacity?: number }) {
  return (
    <div style={{
      position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, opacity,
      background: `radial-gradient(circle, #FFFFFF 0%, ${GOLD_LIGHT} 35%, ${GOLD} 60%)`,
      clipPath: 'polygon(50% 0%, 58% 42%, 100% 50%, 58% 58%, 50% 100%, 42% 58%, 0% 50%, 42% 42%)',
    }} />
  );
}
/** 紙吹雪（細長い金の紙片） */
function Confetti({ x, y, w, h, rot, color = GOLD, opacity = 0.7 }: { x: number; y: number; w: number; h: number; rot: number; color?: string; opacity?: number }) {
  return <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, background: color, opacity, transform: `rotate(${rot}deg)`, borderRadius: 2 }} />;
}

const SPARKLES = [
  { x: 120, y: 150, size: 46 }, { x: 960, y: 165, size: 38 }, { x: 100, y: 632, size: 28, opacity: 0.65 },
  { x: 982, y: 628, size: 40 }, { x: 140, y: 1210, size: 34, opacity: 0.7 }, { x: 945, y: 1235, size: 28, opacity: 0.6 },
];
const CONFETTI = [
  { x: 70, y: 230, w: 26, h: 9, rot: 28 }, { x: 175, y: 105, w: 20, h: 8, rot: -35, color: GOLD_LIGHT },
  { x: 1000, y: 260, w: 24, h: 9, rot: -22 }, { x: 905, y: 108, w: 18, h: 8, rot: 40, color: GOLD_LIGHT },
  { x: 84, y: 1100, w: 22, h: 8, rot: -50, color: GOLD_DEEP }, { x: 975, y: 1090, w: 26, h: 9, rot: 55 },
  { x: 230, y: 1255, w: 20, h: 8, rot: 15, color: GOLD_LIGHT }, { x: 840, y: 1260, w: 22, h: 8, rot: -18, color: GOLD_DEEP },
  { x: 58, y: 520, w: 18, h: 7, rot: 70, opacity: 0.5 }, { x: 1012, y: 470, w: 18, h: 7, rot: -65, opacity: 0.5 },
];

function CoverDecor() {
  return (
    <>
      {/* 「最大◯%OFF」の後ろの金の光 */}
      <div style={{ position: 'absolute', left: 90, right: 90, top: 640, height: 400, background: 'radial-gradient(ellipse at 50% 50%, rgba(227,194,111,0.30), rgba(227,194,111,0) 65%)' }} />
      {CONFETTI.map((c, i) => <Confetti key={`c${i}`} {...c} />)}
      {SPARKLES.map((s, i) => <Sparkle key={`s${i}`} {...s} />)}
    </>
  );
}

function Cover({ text, design, index, total, sale }: StorySlideProps) {
  const s = Math.min(1, design.fontScale);
  const name = text.heading.replace(/\n/g, ' ');
  const nameSize = Math.round(fitOneLine(name, 900, 168, 72) * s);
  const rate = sale?.maxRate ?? null;
  const categories = bfCategoryLine((sale?.items ?? []).map((i) => i.section));
  const catSize = Math.round(fitOneLine(categories, 900, 52, 34) * s);
  // 割引率は1〜99（verifyBfItem で 1%以上・セール価格1円以上）。2桁で「最大」「%OFF」と1行に収まる大きさ
  const numSize = Math.round(290 * s);
  return (
    <>
      <CoverDecor />
      <Pr />
      <PageNo index={index} total={total} />
      <div style={{ ...center, top: 112 }}>
        <div style={{ display: 'inline-block', padding: '10px 40px', border: `3px solid ${GOLD}`, borderRadius: 999, fontSize: Math.round(44 * s), fontWeight: 900, color: GOLD, letterSpacing: 4, background: 'rgba(11,10,13,0.6)' }}>
          {text.subheading}
        </div>
        {sale?.periodLabel && <div style={{ marginTop: 16, fontSize: Math.round(28 * s), color: CREAM, letterSpacing: 1 }}>{sale.periodLabel}（日本時間）</div>}
      </div>
      {/* 推しの名前（白・金の下線） */}
      <div data-fit-area="name" style={{ ...center, top: 262, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: nameSize, fontWeight: 900, lineHeight: 1.1, whiteSpace: 'nowrap', textShadow: `0 6px 28px rgba(0,0,0,0.7), 0 0 2px ${GOLD_DEEP}` }}>{name}</div>
      </div>
      <div style={{ position: 'absolute', left: 260, right: 260, top: 466, height: 4, borderRadius: 2, background: `linear-gradient(90deg, rgba(227,194,111,0), ${GOLD}, rgba(227,194,111,0))` }} />
      {/* 何の商品の紹介か（採用した商品の種類） */}
      <div data-fit-area="categories" style={{ ...center, top: 494, height: 130, overflow: 'hidden' }}>
        <div style={{ fontSize: catSize, fontWeight: 900, color: GOLD_LIGHT, lineHeight: 1.25, whiteSpace: 'nowrap' }}>{categories}</div>
        <div style={{ marginTop: 6, fontSize: Math.round(36 * s), fontWeight: 700, color: CREAM, lineHeight: 1.3 }}>{text.body}</div>
      </div>
      {/* 最大◯%OFF（いちばん目立たせる。数字は赤＋白縁） */}
      <div style={{ ...center, top: 650, height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {rate !== null ? (
          <div data-fit-area="rate" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap', maxWidth: W - SIDE * 2 }}>
            <span style={{ fontSize: Math.round(84 * s), whiteSpace: 'nowrap', color: GOLD_LIGHT, marginRight: 14, textShadow: `${outline(3, BG)}, 0 6px 16px rgba(0,0,0,0.6)` }}>最大</span>
            <span style={{ fontSize: numSize, whiteSpace: 'nowrap', color: RED, letterSpacing: -8, textShadow: `${outline(7)}, 0 14px 0 ${RED_DEEP}, 0 16px 30px rgba(0,0,0,0.6)` }}>{rate}</span>
            <span style={{ fontSize: Math.round(112 * s), whiteSpace: 'nowrap', color: RED, marginLeft: 12, textShadow: `${outline(5)}, 0 8px 0 ${RED_DEEP}` }}>%OFF</span>
          </div>
        ) : (
          <div style={{ fontSize: 40, color: MUTED }}>（承認済みの商品を選ぶと最大割引率が入ります）</div>
        )}
      </div>
      <div style={{ ...center, top: 1004, fontSize: Math.round(25 * s), color: MUTED }}>※紹介する{sale?.items.length ?? 0}商品のうち、楽天の商品ページで確認した割引率の最大値</div>
      {text.note && (
        <div style={{ ...center, top: 1080 }}>
          <div style={{ display: 'inline-block', padding: '14px 44px', borderRadius: 999, background: GOLD, color: BG, fontSize: Math.round(fitOneLine(text.note, 760, 38, 26) * s), fontWeight: 900, whiteSpace: 'nowrap' }}>{text.note}</div>
        </div>
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 70, textAlign: 'center', fontSize: 30, fontWeight: 900, color: GOLD, letterSpacing: 6 }}>推しサーチ</div>
    </>
  );
}

// ── 商品ページ ─────────────────────────────────────────────
const CARD_H = 318;
const CARD_GAP = 16;
const CARD_PAD = 14;
const IMG = CARD_H - CARD_PAD * 2 - 4; // 枠線2px×2を除いた正方形
const COL_W = W - SIDE * 2 - CARD_PAD * 2 - 4 - IMG - 24;

function ProductCard({ item, scale }: { item: BfSlideItem; scale: number }) {
  const cond = bfConditionText(item);
  const titleSize = Math.round(25 * scale);
  const titleLines = cond ? 1 : 2;
  const priceText = formatYen(item.salePrice);
  const priceSize = Math.round(fitOneLine(priceText, 280, 58, 36) * scale);
  return (
    <div data-fit-area="product" style={{ display: 'flex', gap: 24, height: CARD_H, padding: CARD_PAD, boxSizing: 'border-box', background: CARD, border: `2px solid rgba(227,194,111,0.55)`, borderRadius: 20, overflow: 'hidden' }}>
      {/* 商品画像：白地の枠に縦横比を保って収める（文字は重ねない） */}
      <div style={{ width: IMG, height: IMG, flexShrink: 0, borderRadius: 14, background: '#FFFFFF', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {item.imageSrc
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={item.imageSrc} alt="" style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain', display: 'block' }} />
          : <div style={{ color: '#6B6255', fontSize: 30, fontWeight: 700, textAlign: 'center', padding: 16 }}>{item.section}</div>}
      </div>
      <div style={{ width: COL_W, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div><span style={{ display: 'inline-block', fontSize: 22, fontWeight: 800, color: BG, background: GOLD, borderRadius: 6, padding: '3px 12px' }}>{item.section}</span></div>
        <div style={{ marginTop: 8, flexShrink: 0, fontSize: titleSize, lineHeight: 1.3, maxHeight: Math.ceil(titleSize * 1.3 * titleLines), overflow: 'hidden', color: CREAM, display: '-webkit-box', WebkitLineClamp: titleLines, WebkitBoxOrient: 'vertical', wordBreak: 'break-all' }}>
          {item.title}
        </div>
        {cond && (
          <div style={{ marginTop: 8, flexShrink: 0, fontSize: 21, lineHeight: 1.35, maxHeight: Math.ceil(21 * 1.35 * 2) + 14, boxSizing: 'border-box', overflow: 'hidden', color: GOLD_LIGHT, background: 'rgba(227,194,111,0.14)', border: `1px solid rgba(227,194,111,0.6)`, borderRadius: 8, padding: '5px 10px', fontWeight: 700, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-all' }}>
            条件：{cond}
          </div>
        )}
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 24, color: MUTED }}>{item.priceLabel} <span style={{ textDecoration: 'line-through' }}>{formatYen(item.regularPrice)}</span></span>
          <span style={{ fontSize: 24, fontWeight: 800, color: GOLD, border: `2px solid ${GOLD}`, borderRadius: 8, padding: '1px 10px' }}>{formatYen(item.offAmount)} OFF</span>
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 22, color: GOLD, fontWeight: 800 }}>セール価格</span>
          <span style={{ fontSize: priceSize, fontWeight: 900, lineHeight: 1.1 }}>{priceText}</span>
          {/* 割引率：赤いバッジ */}
          <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 34, fontWeight: 900, color: '#FFFFFF', background: RED, borderRadius: 12, padding: '6px 14px', lineHeight: 1.1, boxShadow: `0 4px 0 ${RED_DEEP}`, border: '2px solid #FFFFFF' }}>{item.offRate}%OFF</span>
        </div>
      </div>
    </div>
  );
}

function Products({ text, design, index, total, sale }: StorySlideProps) {
  const s = Math.min(1, design.fontScale);
  const heading = text.heading.replace(/\n/g, ' ');
  // 表紙の次（index 1）が商品ページ1。商品ページの枚数＝全体−表紙−最終ページ
  const page = Math.max(0, index - 1);
  const pages = Math.max(1, total - 2);
  const items = bfPageItems(sale?.items ?? [], page);
  return (
    <>
      <Pr />
      <PageNo index={index} total={total} />
      <div style={{ ...center, top: 100 }}>
        <div style={{ fontSize: 26, color: GOLD, letterSpacing: 4, fontWeight: 800 }}>楽天ブラックフライデー{pages > 1 ? `（${page + 1}/${pages}）` : ''}</div>
        <div data-fit-area="heading" style={{ marginTop: 4, height: 70, fontSize: Math.round(fitOneLine(heading, 920, 54, 34) * s), fontWeight: 900, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden' }}>{heading}</div>
      </div>
      <div style={{ position: 'absolute', left: SIDE, right: SIDE, top: 224, display: 'flex', flexDirection: 'column', gap: CARD_GAP }}>
        {items.length > 0
          ? items.map((it) => <ProductCard key={it.productId} item={it} scale={s} />)
          : <div style={{ height: 600, border: `2px dashed ${GOLD}`, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 34, textAlign: 'center' }}>承認済みの商品がありません<br />（管理画面で商品を確認・承認してください）</div>}
      </div>
      <div style={{ position: 'absolute', left: SIDE, right: SIDE, top: 1232, fontSize: 21, lineHeight: 1.5, color: MUTED }}>
        {sale?.checkedLabel ? `※価格は${sale.checkedLabel}時点で楽天の商品ページで確認したものです。` : '※価格は楽天の商品ページで確認したものです。'}
        価格・在庫・セール対象は変わる場合があります。購入前に楽天の商品ページでご確認ください。{text.note}
      </div>
    </>
  );
}

// ── 最終ページ ─────────────────────────────────────────────
function Final({ text, design, index, total }: StorySlideProps) {
  const s = Math.min(1, design.fontScale);
  const cta = text.cta.replace(/\n/g, ' ');
  const bodyLines = text.body.split('\n').filter((l) => l.trim() !== '');
  return (
    <>
      <Pr />
      <PageNo index={index} total={total} />
      <div data-fit-area="heading" style={{ ...center, top: 160, height: 200, fontSize: Math.round(72 * s), fontWeight: 900, lineHeight: 1.3, overflow: 'hidden' }}>
        <Lines text={text.heading} />
      </div>
      {/* プロフィールのリンクから推しサーチへ（矢印は使わない） */}
      <div data-fit-area="body" style={{ position: 'absolute', left: 110, right: 110, top: 400, height: 330, boxSizing: 'border-box', borderRadius: 32, border: `4px solid ${GOLD}`, background: 'rgba(227,194,111,0.10)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden', textAlign: 'center' }}>
        {bodyLines.map((l, i) => {
          const last = bodyLines.length > 1 && i === bodyLines.length - 1;
          const size = Math.round(fitOneLine(l, 780, last ? 110 : 66, 34) * s);
          return <div key={i} style={{ fontSize: size, fontWeight: 900, lineHeight: 1.2, color: last ? '#FFFFFF' : GOLD, whiteSpace: 'nowrap' }}>{l}</div>;
        })}
      </div>
      {cta && (
        <div style={{ ...center, top: 780 }}>
          <div style={{ display: 'inline-block', padding: '20px 44px', borderRadius: 999, background: GOLD, color: BG, fontSize: Math.round(fitOneLine(cta, 820, 42, 26) * s), fontWeight: 900, whiteSpace: 'nowrap' }}>{cta}</div>
        </div>
      )}
      {/* サイト名・URL */}
      <div style={{ ...center, top: 930 }}>
        <div style={{ fontSize: Math.round(88 * s), fontWeight: 900, color: GOLD, letterSpacing: 8, lineHeight: 1.15 }}>推しサーチ</div>
        <div style={{ marginTop: 6, fontSize: Math.round(50 * s), fontWeight: 800, color: '#FFFFFF', letterSpacing: 2, lineHeight: 1.2 }}>oshi-search.jp</div>
        <div style={{ marginTop: 26, fontSize: Math.round(28 * s), color: CREAM, lineHeight: 1.5 }}>写真集・ライブ映像・CD・グッズを<br />推しごとにまとめて探せます</div>
      </div>
    </>
  );
}

export function BfSaleSlide(props: StorySlideProps) {
  const font = FONT_STACKS[props.design.font].stack;
  const layout = props.def.layout;
  return (
    <Frame font={font}>
      {layout === 'bf-cover' ? <Cover {...props} /> : layout === 'bf-products' ? <Products {...props} /> : <Final {...props} />}
    </Frame>
  );
}
