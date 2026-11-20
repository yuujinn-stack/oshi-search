'use client';

/**
 * 楽天BF・推し別セール紹介（フィード投稿 1080×1350・3〜4枚）の描画。黒×ゴールド（B案）。
 * - 1枚目（表紙）：セール名・期間・グループ名/人物名・最大割引率（採用した承認済みの商品から計算した値だけ）
 * - 商品ページ（1〜2枚）：承認済みの商品を1ページ3件（最大6件）。商品画像・価格の表記（通常価格 等）・セール価格・値下げ額・割引率・
 *   適用条件（条件付きの値下げのときだけ）。何ページ目かは index（表紙の次が商品ページ1）から決める
 * - 最終ページ：プロフィールのリンクから推しサーチへ
 * 価格・割引率は props.sale（管理画面の承認欄で確認した値）だけを描き、無いときは数字を出さない。
 * 楽天のロゴ・画像は使わない（商品画像は商品データの画像をサーバーで取得したもの）。
 */

import type { CSSProperties, ReactNode } from 'react';
import { FONT_STACKS } from '@/lib/story-maker/templates';
import { BF_FRAME_H, bfConditionText, bfPageItems, formatYen, type BfSlideItem } from '@/lib/story-maker/bf-sale';
import type { StorySlideProps } from './StorySlide';

const W = 1080;
const H = BF_FRAME_H;
const GOLD = '#E3C26F';
const GOLD_DEEP = '#B8913A';
const BG = '#0B0A0D';
const CARD = '#17151B';
const MUTED = '#A79F8E';
const PR_TEXT = 'PR（楽天アフィリエイト広告を含みます）';

/** 1行に収める文字サイズ（全角1・半角0.58で見積もる） */
function fitOneLine(text: string, maxWidth: number, base: number, min: number): number {
  const w = Array.from(text).reduce((n, ch) => n + (/[\x20-\x7e]/.test(ch) ? 0.58 : 1), 0);
  if (w === 0) return base;
  return Math.max(min, Math.min(base, Math.floor(maxWidth / w)));
}

function Lines({ text }: { text: string }) {
  const lines = text.split('\n');
  return <>{lines.map((l, i) => <span key={i} style={{ display: 'block' }}>{l || ' '}</span>)}</>;
}

function Frame({ children, font }: { children: ReactNode; font: string }) {
  return (
    <div
      data-story-frame
      style={{ position: 'relative', width: W, height: H, overflow: 'hidden', background: BG, fontFamily: font, color: '#FFFFFF', WebkitFontSmoothing: 'antialiased' }}
    >
      {/* 背景の金の光と二重線の枠 */}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 0%, rgba(227,194,111,0.20), rgba(11,10,13,0) 55%), radial-gradient(circle at 50% 110%, rgba(184,145,58,0.18), rgba(11,10,13,0) 50%)` }} />
      <div style={{ position: 'absolute', left: 32, top: 32, right: 32, bottom: 32, border: `3px solid ${GOLD}` }} />
      <div style={{ position: 'absolute', left: 44, top: 44, right: 44, bottom: 44, border: `1px solid rgba(227,194,111,0.45)` }} />
      {children}
    </div>
  );
}

function Pr({ top = 62 }: { top?: number }) {
  return <div style={{ position: 'absolute', left: 72, top, fontSize: 22, color: MUTED, letterSpacing: 1 }}>{PR_TEXT}</div>;
}

function PageNo({ index, total }: { index: number; total: number }) {
  return <div style={{ position: 'absolute', right: 72, top: 62, fontSize: 22, color: GOLD, fontWeight: 700, letterSpacing: 2 }}>{index + 1} / {total}</div>;
}

function Brand({ bottom = 66 }: { bottom?: number }) {
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom, textAlign: 'center', fontSize: 26, fontWeight: 800, color: GOLD, letterSpacing: 6 }}>
      推しサーチ
    </div>
  );
}

const center: CSSProperties = { position: 'absolute', left: 80, right: 80, textAlign: 'center' };

function Cover({ text, design, index, total, sale }: StorySlideProps) {
  const s = design.fontScale;
  const name = text.heading.replace(/\n/g, ' ');
  const nameSize = Math.round(fitOneLine(name, 860, 150, 64) * Math.min(1, s));
  const rate = sale?.maxRate ?? null;
  return (
    <>
      <Pr />
      <PageNo index={index} total={total} />
      <div style={{ ...center, top: 150 }}>
        <div style={{ display: 'inline-block', padding: '12px 36px', border: `2px solid ${GOLD}`, borderRadius: 999, fontSize: Math.round(40 * s), fontWeight: 800, color: GOLD, letterSpacing: 4 }}>
          {text.subheading}
        </div>
        {sale?.periodLabel && <div style={{ marginTop: 22, fontSize: Math.round(28 * s), color: MUTED, letterSpacing: 1 }}>{sale.periodLabel}（日本時間）</div>}
      </div>
      <div data-fit-area="name" style={{ ...center, top: 380, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: nameSize, fontWeight: 900, lineHeight: 1.1, whiteSpace: 'nowrap', textShadow: '0 4px 24px rgba(0,0,0,0.6)' }}>{name}</div>
      </div>
      <div style={{ ...center, top: 590, fontSize: Math.round(44 * s), fontWeight: 700, color: '#F4ECD8', letterSpacing: 3 }}>{text.body}</div>
      <div style={{ position: 'absolute', left: 160, right: 160, top: 680, height: 2, background: `linear-gradient(90deg, rgba(227,194,111,0), ${GOLD}, rgba(227,194,111,0))` }} />
      <div style={{ ...center, top: 720 }}>
        {rate !== null ? (
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', color: GOLD, fontWeight: 900, lineHeight: 1 }}>
            <span style={{ fontSize: Math.round(84 * s), marginRight: 16 }}>最大</span>
            <span style={{ fontSize: Math.round(260 * s), letterSpacing: -6, textShadow: `0 6px 0 ${GOLD_DEEP}` }}>{rate}</span>
            <span style={{ fontSize: Math.round(110 * s), marginLeft: 8 }}>%OFF</span>
          </div>
        ) : (
          <div style={{ fontSize: 40, color: MUTED, paddingTop: 80 }}>（承認済みの商品を選ぶと最大割引率が入ります）</div>
        )}
        <div style={{ marginTop: 34, fontSize: Math.round(26 * s), color: MUTED }}>※紹介する{sale?.items.length ?? 0}商品のうち、楽天の商品ページで確認した割引率の最大値</div>
      </div>
      {text.note && <div style={{ ...center, bottom: 130, fontSize: Math.round(32 * s), color: '#F4ECD8', fontWeight: 700 }}>{text.note}</div>}
      <Brand />
    </>
  );
}

function ProductCard({ item, scale }: { item: BfSlideItem; scale: number }) {
  const IMG = 266;
  const cond = bfConditionText(item);
  return (
    <div data-fit-area="product" style={{ display: 'flex', gap: 30, height: 306, padding: 20, background: CARD, border: `1px solid rgba(227,194,111,0.5)`, borderRadius: 20, overflow: 'hidden' }}>
      <div style={{ width: IMG, height: IMG, flexShrink: 0, borderRadius: 14, background: '#FFFFFF', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {item.imageSrc
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={item.imageSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          : <div style={{ color: '#6B6255', fontSize: 30, fontWeight: 700, textAlign: 'center', padding: 16 }}>{item.section}</div>}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span style={{ flexShrink: 0, fontSize: 22, fontWeight: 800, color: BG, background: GOLD, borderRadius: 6, padding: '4px 12px' }}>{item.section}</span>
          {cond && <span style={{ minWidth: 0, fontSize: 21, fontWeight: 700, color: GOLD, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>条件：{cond}</span>}
        </div>
        <div style={{ marginTop: 10, flexShrink: 0, fontSize: Math.round(26 * scale), lineHeight: 1.35, maxHeight: Math.round(26 * scale * 1.35 * 2), overflow: 'hidden', color: '#F4ECD8', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {item.title}
        </div>
        <div style={{ marginTop: 'auto' }}>
          <div style={{ fontSize: 24, color: MUTED }}>
            {item.priceLabel} <span style={{ textDecoration: 'line-through' }}>{formatYen(item.regularPrice)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 2 }}>
            <span style={{ fontSize: 24, color: GOLD, fontWeight: 700 }}>セール価格</span>
            <span style={{ fontSize: Math.round(52 * scale), fontWeight: 900, lineHeight: 1.05 }}>{formatYen(item.salePrice)}</span>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <span style={{ fontSize: 26, fontWeight: 900, color: BG, background: GOLD, borderRadius: 8, padding: '4px 14px' }}>{item.offRate}%OFF</span>
            <span style={{ fontSize: 26, fontWeight: 800, color: GOLD, border: `2px solid ${GOLD}`, borderRadius: 8, padding: '2px 14px' }}>{formatYen(item.offAmount)} OFF</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Products({ text, design, index, total, sale }: StorySlideProps) {
  const s = design.fontScale;
  const heading = text.heading.replace(/\n/g, ' ');
  // 表紙の次（index 1）が商品ページ1。商品ページの枚数＝全体−表紙−最終ページ
  const page = Math.max(0, index - 1);
  const pages = Math.max(1, total - 2);
  const items = bfPageItems(sale?.items ?? [], page);
  return (
    <>
      <Pr />
      <PageNo index={index} total={total} />
      <div style={{ ...center, top: 112 }}>
        <div style={{ fontSize: 26, color: GOLD, letterSpacing: 4, fontWeight: 700 }}>楽天ブラックフライデー{pages > 1 ? `（${page + 1}/${pages}）` : ''}</div>
        <div data-fit-area="heading" style={{ marginTop: 6, height: 70, fontSize: Math.round(fitOneLine(heading, 900, 54, 34) * Math.min(1, s)), fontWeight: 900, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden' }}>{heading}</div>
      </div>
      <div style={{ position: 'absolute', left: 72, right: 72, top: 250, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {items.length > 0
          ? items.map((it) => <ProductCard key={it.productId} item={it} scale={Math.min(1, s)} />)
          : <div style={{ height: 600, border: `2px dashed ${GOLD}`, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 34, textAlign: 'center' }}>承認済みの商品がありません<br />（管理画面で商品を確認・承認してください）</div>}
      </div>
      <div style={{ position: 'absolute', left: 72, right: 72, bottom: 60, fontSize: 21, lineHeight: 1.5, color: MUTED }}>
        {sale?.checkedLabel ? `※価格は${sale.checkedLabel}時点で楽天の商品ページで確認したものです。` : '※価格は楽天の商品ページで確認したものです。'}
        価格・在庫・セール対象は変わる場合があります。購入前に楽天の商品ページでご確認ください。{text.note}
      </div>
    </>
  );
}

function Final({ text, design, index, total }: StorySlideProps) {
  const s = design.fontScale;
  const cta = text.cta.replace(/\n/g, ' ');
  return (
    <>
      <Pr />
      <PageNo index={index} total={total} />
      <div data-fit-area="heading" style={{ ...center, top: 200, fontSize: Math.round(76 * s), fontWeight: 900, lineHeight: 1.3 }}>
        <Lines text={text.heading} />
      </div>
      <div style={{ ...center, top: 470 }}>
        <div style={{ margin: '0 auto', width: 150, height: 150, borderRadius: 999, border: `4px solid ${GOLD}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: GOLD, fontSize: 96, fontWeight: 900, lineHeight: 1 }}>↑</div>
      </div>
      <div data-fit-area="body" style={{ ...center, top: 670, fontSize: Math.round(68 * s), fontWeight: 900, lineHeight: 1.35, color: GOLD }}>
        <Lines text={text.body} />
      </div>
      {cta && (
        <div style={{ ...center, top: 920 }}>
          <div style={{ display: 'inline-block', padding: '20px 40px', borderRadius: 999, background: GOLD, color: BG, fontSize: Math.round(fitOneLine(cta, 820, 40, 26) * Math.min(1, s)), fontWeight: 900, whiteSpace: 'nowrap' }}>{cta}</div>
        </div>
      )}
      <div style={{ ...center, top: 1060, fontSize: Math.round(28 * s), color: '#F4ECD8', lineHeight: 1.5 }}>写真集・ライブ映像・CD・グッズを<br />推しごとにまとめて探せます</div>
      <Brand bottom={120} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 76, textAlign: 'center', fontSize: 22, color: MUTED, letterSpacing: 2 }}>oshi-search.jp</div>
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
