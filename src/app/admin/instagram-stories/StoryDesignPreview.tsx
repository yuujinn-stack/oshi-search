'use client';

/**
 * ストーリーズの「完成イメージ」プレビュー（1080×1920 をそのままの座標で描き、枠の幅に合わせて縮小する）。
 *
 * - 寸法はすべて 1080 基準の px で書き、u() で container query 単位（cqw）に変換する。
 *   どの表示幅でも同じ比率になるので、Canva 等で 1080×1920 のまま再現できる。
 * - 本文・画像・リンクの各ブロックは STORY_LAYOUT / getLinkStickerZone の範囲に配置する
 *   （data-story-zone を付けて、はみ出し確認に使う）。
 * - デザインがあるのは STORY_DESIGNS に登録したテンプレートだけ。ほかは従来の配置図を表示する。
 * - 診断結果などのモックアップには実データ風の数字を出さない（「例」「◯◯」表記）。
 */

import type { CSSProperties, ReactNode } from 'react';
import {
  STORY_CANVAS,
  STORY_LAYOUT,
  getLinkStickerZone,
  type StorySlide,
  type StoryZone,
} from '@/lib/instagram-story-templates';
import { COST_GUIDE_UPDATED_AT } from '@/lib/support-ads/content';

/** 1080 基準の px → 枠幅に対する cqw */
const u = (px: number) => `calc(${px} * 100cqw / ${STORY_CANVAS.width})`;
/**
 * 枠線の太さ用。ブラウザは枠線の太さを整数pxに切り捨てるため、計算誤差で 3.99999px になると 3px になる
 * （PNG保存時の SVG 内で実際に起きた）。わずかに足して、プレビューと保存画像のどちらでも指定どおりの太さにする。
 */
const ub = (px: number) => `calc(${px} * 100cqw / ${STORY_CANVAS.width} + 0.02px)`;

/** 推しサーチ本体（graphic-site.css の C案トークン）に合わせた色 */
const C = {
  bg: '#F6F5F1',
  surface: '#FFFFFF',
  ink: '#0A0A0A',
  body: '#2B2B28',
  muted: '#62625C',
  border: '#D9D8D1',
  borderStrong: '#B9B8B0',
  orange: '#FF5A00',
  orangeText: '#C84A00',
  orangeSoft: '#FFF1E8',
  /** 見出しのマーカー（背景 #F6F5F1 の上でも見える濃さ） */
  orangeMark: '#FFD3B8',
  blueSoft: '#EAF1FB',
  blueText: '#1D4E89',
  green: '#15803D',
  greenSoft: '#EAF7EF',
  amberSoft: '#FEF3C7',
  amberText: '#92400E',
} as const;

const FONT = "'Noto Sans JP', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', system-ui, sans-serif";
// 総称フォント（monospace / ui-monospace）は環境や PNG 保存時（SVG 画像内）で別の書体になるため、実在する書体名を先に並べる。
// 管理画面（Mac の Chrome）ではこれまでも Osaka-Mono で表示されていた。
const MONO = "'Space Mono', 'Osaka-Mono', Osaka, Menlo, Consolas, monospace";

const SIDE = 80;

/**
 * 完成イメージの本文ブロック。CTA（リンクステッカー位置）は動かさず、見出しを Instagram 上部UIから少し離して
 * 本文→画面→CTA の間隔をそろえる（2枚目の本文が最も長く、+30px で画面モックとの間隔が約45px）。
 */
const TEXT_ZONE: StoryZone = { top: STORY_LAYOUT.text.top + 30, bottom: STORY_LAYOUT.text.bottom };

function zoneBox(zone: StoryZone, inset = SIDE): CSSProperties {
  return { position: 'absolute', top: u(zone.top), height: u(zone.bottom - zone.top), left: u(inset), right: u(inset) };
}

/** 上部ラベル行（小さめの補足ラベル＋推しサーチのロゴ文字） */
function LabelRow({ label, tone, pr = false }: { label: string; tone: 'orange' | 'ink' | 'outline'; pr?: boolean }) {
  const chip: CSSProperties =
    tone === 'orange'
      ? { background: C.orange, color: '#FFF', border: `${ub(3)} solid ${C.orange}` }
      : tone === 'ink'
        ? { background: C.ink, color: '#FFF', border: `${ub(3)} solid ${C.ink}` }
        : { background: C.surface, color: C.orangeText, border: `${ub(3)} solid ${C.orange}` };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ ...chip, fontSize: u(34), fontWeight: 800, padding: `${u(8)} ${u(22)}`, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: u(18) }}>
        {/* 広告であることが一目で分かるよう、ラベル行に常に表示する */}
        {pr && (
          <span style={{ fontSize: u(30), fontWeight: 900, color: C.ink, background: C.surface, border: `${ub(3)} solid ${C.ink}`, padding: `${u(2)} ${u(14)}`, lineHeight: 1.3, letterSpacing: '0.06em' }}>
            PR
          </span>
        )}
        <span style={{ fontSize: u(30), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap', letterSpacing: '0.02em' }}>
          推しサーチ
        </span>
      </span>
    </div>
  );
}

/** 見出しの強調（下側だけ薄いオレンジのマーカー） */
function Mark({ children }: { children: ReactNode }) {
  return (
    <span style={{ background: `linear-gradient(transparent 64%, ${C.orangeMark} 64%, ${C.orangeMark} 94%, transparent 94%)`, boxDecorationBreak: 'clone' }}>
      {children}
    </span>
  );
}

function Headline({ size, children, mt = 44 }: { size: number; children: ReactNode; mt?: number }) {
  return (
    <h3 style={{ margin: `${u(mt)} 0 0`, fontSize: u(size), fontWeight: 900, lineHeight: 1.28, color: C.ink, letterSpacing: '-0.01em', whiteSpace: 'pre' }}>
      {children}
    </h3>
  );
}

function Sub({ children, mt = 34 }: { children: ReactNode; mt?: number }) {
  return (
    <p style={{ margin: `${u(mt)} 0 0`, fontSize: u(38), fontWeight: 700, lineHeight: 1.5, color: C.body, whiteSpace: 'pre' }}>
      {children}
    </p>
  );
}

function LinkIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" style={{ width: u(size), height: u(size), flexShrink: 0 }} aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </svg>
  );
}

/**
 * ずらした影（ぼかしなし）。Safari は PNG 保存時の SVG 画像内で box-shadow を描かないため、背面の箱で描く。
 * 親（position: relative）の先頭に置き、影を付ける箱は後ろの兄弟要素（position: relative）にする。
 */
function HardShadow({ offset, color, radius }: { offset: number; color: string; radius?: string }) {
  return (
    <span aria-hidden style={{ position: 'absolute', left: u(offset), top: u(offset), width: '100%', height: '100%', background: color, borderRadius: radius }} />
  );
}

type CtaTone = 'primary' | 'outline' | 'strong';

/** リンクステッカーを置く位置（下端から300〜450px上）に描くCTA */
function StickerCta({ slide, tone, size }: { slide: StorySlide; tone: CtaTone; size: number }) {
  const zone = getLinkStickerZone(slide.linkPosition);
  const shadow = 12;
  const style: Record<CtaTone, CSSProperties> = {
    primary: { background: C.orange, color: '#FFF', border: `${ub(4)} solid ${C.ink}` },
    outline: { background: C.surface, color: C.ink, border: `${ub(4)} solid ${C.ink}` },
    strong: { background: C.ink, color: '#FFF', border: `${ub(4)} solid ${C.ink}` },
  };
  const shadowOf: Record<CtaTone, { offset: number; color: string }> = {
    primary: { offset: shadow, color: C.ink },
    outline: { offset: 10, color: C.orange },
    strong: { offset: shadow, color: C.orange },
  };
  const iconColor = tone === 'outline' ? C.orange : '#FFF';
  return (
    <div data-story-zone="cta" style={{ ...zoneBox(zone, 110), display: 'flex' }}>
      {/* 影のぶんだけ短くして、影まで含めて範囲内に収める */}
      <div style={{ position: 'relative', width: `calc(100% - ${u(shadow)})`, height: `calc(100% - ${u(shadow)})` }}>
        <HardShadow offset={shadowOf[tone].offset} color={shadowOf[tone].color} radius={u(999)} />
        <div
          style={{
            ...style[tone],
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: u(999),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: u(18),
            fontSize: u(size),
            fontWeight: 900,
            whiteSpace: 'nowrap',
            letterSpacing: '0.01em',
          }}
        >
          <LinkIcon size={size * 0.9} color={iconColor} />
          {slide.linkCTA}
        </div>
      </div>
    </div>
  );
}

/** モックアップの外枠（ブラウザ風の白いカード） */
function MockCard({ url, children, tag }: { url: string; children: ReactNode; tag?: string }) {
  return (
    <div style={{ position: 'relative', height: `calc(100% - ${u(14)})`, width: `calc(100% - ${u(14)})` }}>
      <HardShadow offset={14} color={C.ink} />
      <div
        style={{
          position: 'relative',
          background: C.surface,
          border: `${ub(4)} solid ${C.ink}`,
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: u(10), padding: `${u(14)} ${u(22)}`, borderBottom: `${ub(3)} solid ${C.ink}`, background: C.bg }}>
          {[C.orange, C.border, C.border].map((c, i) => (
            <span key={i} style={{ width: u(16), height: u(16), borderRadius: '50%', background: c }} />
          ))}
          <span style={{ marginLeft: u(12), fontFamily: MONO, fontSize: u(24), color: C.muted, whiteSpace: 'nowrap' }}>{url}</span>
          {tag && (
            <span style={{ marginLeft: 'auto', fontSize: u(22), fontWeight: 800, color: C.amberText, background: C.amberSoft, padding: `${u(2)} ${u(12)}`, whiteSpace: 'nowrap' }}>
              {tag}
            </span>
          )}
        </div>
        <div style={{ flex: 1, padding: `${u(28)} ${u(34)}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>{children}</div>
      </div>
    </div>
  );
}

function Avatar({ label, color, size = 72 }: { label: string; color: string; size?: number }) {
  return (
    <span style={{ width: u(size), height: u(size), borderRadius: '50%', background: color, color: '#FFF', fontWeight: 900, fontSize: u(size * 0.42), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {label}
    </span>
  );
}

function Check({ size = 40, color = C.green }: { size?: number; color?: string }) {
  return (
    <span style={{ width: u(size), height: u(size), borderRadius: '50%', background: color, color: '#FFF', fontSize: u(size * 0.62), fontWeight: 900, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 1 }}>
      ✓
    </span>
  );
}

/**
 * モックアップ内のボタン。muted は画面の一部と分かる程度に控えめにし、
 * 押してほしい場所（下のリンクステッカーCTA）と競合させないための表示。
 */
function MockButton({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const style: CSSProperties = muted
    ? { background: C.surface, color: C.muted, border: `${ub(2)} solid ${C.borderStrong}`, fontWeight: 700, fontSize: u(26), padding: `${u(10)} 0`, margin: `0 ${u(120)}` }
    : { background: C.ink, color: '#FFF', fontWeight: 900, fontSize: u(34), padding: `${u(18)} 0`, boxShadow: `${u(8)} ${u(8)} 0 ${C.orange}`, marginRight: u(8) };
  return <div style={{ ...style, textAlign: 'center', whiteSpace: 'nowrap' }}>{children}</div>;
}

const AVATAR_COLORS = ['#F2994A', '#6C9BD2', '#5DB383'];

/** CTAのすぐ上に添える小さなラベル（画像ブロックの下端〜リンクステッカー上端のすき間 1420〜1470 に収める） */
function CtaHint({ children }: { children: ReactNode }) {
  return (
    <span
      data-story-zone="cta-hint"
      style={{
        position: 'absolute',
        left: u(150),
        top: u(STORY_LAYOUT.image.bottom + 4),
        height: u(42),
        lineHeight: u(42),
        background: C.ink,
        color: '#FFF',
        fontSize: u(26),
        fontWeight: 800,
        padding: `0 ${u(18)}`,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

// ── 推しからサブスク診断 ────────────────────────────────────────────────

function OshiVodSlide1({ slide }: { slide: StorySlide }) {
  return (
    <>
      <div data-story-zone="text" style={zoneBox(TEXT_ZONE)}>
        <LabelRow label="推しから選べる" tone="orange" />
        <Headline size={74}>
          {'推しから\n'}
          <Mark>サブスク診断</Mark>
          {'してみない？'}
        </Headline>
        <Sub>
          {'作品数だけじゃなく\n'}
          <span style={{ color: C.orangeText, fontWeight: 900 }}>料金</span>
          {'までまとめて比較'}
        </Sub>
      </div>

      <div data-story-zone="image" style={zoneBox(STORY_LAYOUT.image, 110)}>
        <MockCard url="oshi-search.jp/oshi-vod">
          <p style={{ margin: 0, fontFamily: MONO, fontSize: u(22), color: C.orangeText, letterSpacing: '0.08em' }}>DIAGNOSIS / SUBSCRIPTION</p>
          <p style={{ margin: `${u(8)} 0 0`, fontSize: u(40), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap' }}>推しに合うサブスク診断</p>
          <div style={{ marginTop: u(26), border: `${ub(3)} solid ${C.ink}`, padding: `${u(16)} ${u(20)}`, display: 'flex', alignItems: 'center', gap: u(14), fontSize: u(30), color: C.muted }}>
            <span aria-hidden>🔍</span>
            <span style={{ whiteSpace: 'nowrap' }}>推しの名前を入力</span>
          </div>
          <div style={{ marginTop: u(20), display: 'flex', gap: u(14) }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: u(10), background: C.greenSoft, border: `${ub(2)} solid ${C.green}`, padding: `${u(8)} ${u(18)} ${u(8)} ${u(8)}`, fontSize: u(28), fontWeight: 800, color: C.ink }}>
              <Avatar label="A" color={AVATAR_COLORS[0]} size={52} />
              推しA
              <Check size={34} />
            </span>
          </div>
          <div style={{ marginTop: 'auto' }}>
            <div style={{ display: 'flex', gap: u(10), marginBottom: u(20) }}>
              {['作品数', '月額', 'コスパ'].map((t) => (
                <span key={t} style={{ flex: 1, textAlign: 'center', fontSize: u(26), fontWeight: 800, color: C.blueText, background: C.blueSoft, padding: `${u(8)} 0`, whiteSpace: 'nowrap' }}>
                  {t}で比較
                </span>
              ))}
            </div>
            <MockButton muted>診断する</MockButton>
          </div>
        </MockCard>
      </div>

      {/* 1枚目だけ「1タップで診断」の小さなラベルを添えて、その場で押せることを強調する */}
      <CtaHint>1タップで診断ページへ</CtaHint>
      <StickerCta slide={slide} tone="primary" size={54} />
    </>
  );
}

function OshiVodSlide2({ slide }: { slide: StorySlide }) {
  const panel = (title: string, people: string[], note?: string) => (
    <div style={{ flex: 1, border: `${ub(3)} solid ${C.ink}`, background: C.surface, padding: `${u(22)} ${u(20)}`, display: 'flex', flexDirection: 'column', gap: u(16), minWidth: 0 }}>
      <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: u(8), fontSize: u(28), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap' }}>
        <Check size={34} />
        {title}
      </p>
      {people.map((p, i) => (
        <span key={p} style={{ display: 'flex', alignItems: 'center', gap: u(14), background: C.greenSoft, border: `${ub(2)} solid ${C.green}`, padding: `${u(8)} ${u(14)}`, fontSize: u(28), fontWeight: 800, color: C.ink, whiteSpace: 'nowrap' }}>
          <Avatar label={p.slice(-1)} color={AVATAR_COLORS[i]} size={50} />
          {p}
          <span style={{ marginLeft: 'auto', color: C.green, fontWeight: 900 }}>選択中</span>
        </span>
      ))}
      {note && <p style={{ margin: 'auto 0 0', fontSize: u(24), fontWeight: 700, color: C.muted, lineHeight: 1.5, whiteSpace: 'pre' }}>{note}</p>}
    </div>
  );
  return (
    <>
      <div data-story-zone="text" style={zoneBox(TEXT_ZONE)}>
        <LabelRow label="使い方はかんたん" tone="ink" />
        <Headline size={88}>
          {'気になる人を\n'}
          <Mark>選ぶだけ。</Mark>
        </Headline>
        <Sub>{'出演作と配信先をもとに\nまとめて比較します'}</Sub>
      </div>

      <div data-story-zone="image" style={zoneBox(STORY_LAYOUT.image, 110)}>
        <MockCard url="oshi-search.jp/oshi-vod">
          <div style={{ display: 'flex', gap: u(18), alignItems: 'stretch' }}>
            {panel('1人だけでもOK', ['推しA'], '1人なら\nそのまま診断')}
            <span style={{ alignSelf: 'center', fontSize: u(26), fontWeight: 800, color: C.muted, whiteSpace: 'nowrap' }}>または</span>
            {panel('3人まとめてもOK', ['推しA', '推しB', '推しC'])}
          </div>
          <div style={{ marginTop: 'auto' }}>
            <MockButton muted>選んだ人で診断する</MockButton>
          </div>
        </MockCard>
      </div>

      <StickerCta slide={slide} tone="outline" size={46} />
    </>
  );
}

function OshiVodSlide3({ slide }: { slide: StorySlide }) {
  const pills: [string, string, string][] = [
    ['出演作品数', C.blueSoft, C.blueText],
    ['配信サービス', C.greenSoft, C.green],
    ['料金', C.orangeSoft, C.orangeText],
  ];
  const rows = ['サービスA', 'サービスB', 'サービスC'];
  const barWidths = ['92%', '68%', '45%'];
  const cell: CSSProperties = { fontSize: u(28), whiteSpace: 'nowrap' };
  const grid: CSSProperties = { display: 'grid', gridTemplateColumns: `${u(250)} 1fr ${u(170)}`, alignItems: 'center', columnGap: u(20) };
  return (
    <>
      <div data-story-zone="text" style={zoneBox(TEXT_ZONE)}>
        <LabelRow label="診断でわかること" tone="outline" />
        <Headline size={76}>
          {'「この人を見るなら\n'}
          <Mark>どのサブスク？</Mark>
          {'」'}
        </Headline>
        <div style={{ marginTop: u(34), display: 'flex', alignItems: 'center', gap: u(12), flexWrap: 'nowrap' }}>
          {pills.map(([label, bg, fg], i) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: u(12) }}>
              {i > 0 && <span style={{ fontSize: u(30), fontWeight: 900, color: C.muted }}>×</span>}
              <span style={{ background: bg, color: fg, fontSize: u(32), fontWeight: 900, padding: `${u(8)} ${u(18)}`, whiteSpace: 'nowrap' }}>{label}</span>
            </span>
          ))}
        </div>
        <Sub mt={18}>{'をまとめて比較'}</Sub>
      </div>

      <div data-story-zone="image" style={zoneBox(STORY_LAYOUT.image, 110)}>
        <MockCard url="oshi-search.jp/oshi-vod" tag="画面イメージ（例）">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: u(14) }}>
            <span style={{ fontSize: u(38), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap' }}>診断結果</span>
            <span style={{ fontSize: u(24), fontWeight: 800, color: C.amberText, background: C.amberSoft, padding: `0 ${u(10)}` }}>例</span>
            <span style={{ marginLeft: 'auto', fontSize: u(26), color: C.muted, whiteSpace: 'nowrap' }}>推しA の場合</span>
          </div>
          <div style={{ ...grid, marginTop: u(22), paddingBottom: u(10), borderBottom: `${ub(3)} solid ${C.ink}` }}>
            <span style={{ ...cell, fontSize: u(24), fontWeight: 800, color: C.muted }}>配信サービス</span>
            <span style={{ ...cell, fontSize: u(24), fontWeight: 800, color: C.muted }}>出演作品数</span>
            <span style={{ ...cell, fontSize: u(24), fontWeight: 800, color: C.muted, textAlign: 'right' }}>月額料金</span>
          </div>
          {rows.map((name, i) => (
            <div key={name} style={{ ...grid, padding: `${u(18)} 0`, borderBottom: `${ub(2)} solid ${C.border}` }}>
              <span style={{ ...cell, fontWeight: 900, color: C.ink, display: 'flex', alignItems: 'center', gap: u(10) }}>
                <span style={{ fontFamily: MONO, color: i === 0 ? C.orangeText : C.muted, fontSize: u(26) }}>{i + 1}位</span>
                {name}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: u(12), minWidth: 0 }}>
                {/* 長さは並び順のイメージだけ（実際の作品数ではない） */}
                <span style={{ width: u(150), height: u(20), background: C.bg, flexShrink: 0 }}>
                  <span style={{ display: 'block', height: '100%', width: barWidths[i], background: i === 0 ? C.orange : C.border }} />
                </span>
                <span style={{ ...cell, color: C.body }}>◯◯作品</span>
              </span>
              <span style={{ ...cell, fontWeight: 800, color: C.ink, textAlign: 'right' }}>¥◯,◯◯◯</span>
            </div>
          ))}
          <p style={{ margin: 'auto 0 0', fontSize: u(22), color: C.muted, lineHeight: 1.5 }}>
            ※画面イメージです。実際の結果は推しによって変わります。
          </p>
        </MockCard>
      </div>

      <StickerCta slide={slide} tone="strong" size={50} />
    </>
  );
}

// ── 応援広告・推しアド（PR） ─────────────────────────────────────────────
//
// 人物写真・他社の広告画像・推しアドのバナー画像（計測用の外部画像）は使わず、CSS・SVG で描いた
// 駅広告のイメージと、費用・始め方の図で構成する。
// 費用・流れは src/lib/support-ads/content.ts（推しアド公式で確認済みの内容）と同じ値だけを使う。

/** 費用の目安（7日間）。値は content.ts の MEDIA_GUIDES.priceNote と一致すること（テストで確認） */
export const SUPPORT_AD_PRICE_ROWS = [
  { key: 'poster', media: '駅ポスター（B1）', price: '4万〜8万円' },
  { key: 'signage', media: '駅サイネージ', price: '5万〜50万円' },
  { key: 'vision', media: '屋外ビジョン', price: '30万円〜' },
] as const;

/** 推しアドの2枚は、本文を短くまとめて画像ブロックを広げる（CTA はほかのテンプレートと同じ高さ） */
const AD1_TEXT: StoryZone = { top: TEXT_ZONE.top, bottom: 756 };
const AD1_VISUAL: StoryZone = { top: 780, bottom: 1440 };

/** 掲出例のラベル（誕生日・周年・デビュー記念） */
function OccasionTag({ x, y, rotate, label }: { x: number; y: number; rotate: number; label: string }) {
  return (
    <div style={{ position: 'absolute', left: u(x), top: u(y), transform: `rotate(${rotate}deg)`, zIndex: 3 }}>
      <div style={{ position: 'relative' }}>
        <HardShadow offset={6} color={C.ink} radius={u(999)} />
        <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: u(10), background: C.surface, border: `${ub(3)} solid ${C.ink}`, borderRadius: u(999), padding: `${u(9)} ${u(22)}`, fontSize: u(28), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap' }}>
          <span style={{ width: u(13), height: u(13), borderRadius: '50%', background: C.orange }} />
          {label}
        </span>
      </div>
    </div>
  );
}

/** ポスター用の書体。Mac に標準である書体を優先し、ない環境では一般的なセリフ体・筆記体になる */
const SCRIPT_FONT = "'Snell Roundhand', 'Apple Chancery', 'Brush Script MT', 'Times New Roman', cursive";
const SERIF_FONT = "Didot, 'Bodoni 72', 'Times New Roman', serif";
const GOLD = '#B8862B';
const GOLD_LIGHT = '#E7C77A';
const BLUSH = '#F4A7B9';

/** 4方向に光るきらめき（SVG） */
function Sparkle({ x, y, size, color = GOLD_LIGHT }: { x: number; y: number; size: number; color?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden style={{ position: 'absolute', left: u(x - size / 2), top: u(y - size / 2), width: u(size), height: u(size) }}>
      <path d="M10 0 C11 7 13 9 20 10 C13 11 11 13 10 20 C9 13 7 11 0 10 C7 9 9 7 10 0 Z" fill={color} />
    </svg>
  );
}

/** 風船（SVG） */
function Balloon({ x, y, w, color, dark }: { x: number; y: number; w: number; color: string; dark: string }) {
  const id = `bl-${x}-${y}`;
  return (
    <svg viewBox="0 0 40 70" aria-hidden style={{ position: 'absolute', left: u(x), top: u(y), width: u(w), height: u((w * 70) / 40) }}>
      <defs>
        <radialGradient id={id} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="35%" stopColor={color} />
          <stop offset="100%" stopColor={dark} />
        </radialGradient>
      </defs>
      <path d="M20 42 C 21 50, 15 56, 21 70" stroke={dark} strokeWidth="1.2" fill="none" />
      <ellipse cx="20" cy="20" rx="17" ry="21" fill={`url(#${id})`} />
      <path d="M17 41 L23 41 L20 45 Z" fill={dark} />
    </svg>
  );
}

const POSTER_CONFETTI: { x: number; y: number; w: number; h: number; r: number; c: string; round?: boolean }[] = [
  // 文字に重ならないよう、ポスターの左右の余白と上部だけに置く
  { x: 40, y: 150, w: 14, h: 6, r: -30, c: C.orange },
  { x: 345, y: 170, w: 14, h: 6, r: 35, c: BLUSH },
  { x: 26, y: 300, w: 9, h: 9, r: 0, c: GOLD_LIGHT, round: true },
  { x: 372, y: 290, w: 9, h: 9, r: 0, c: C.orange, round: true },
  { x: 30, y: 430, w: 13, h: 6, r: 20, c: GOLD_LIGHT },
  { x: 360, y: 440, w: 13, h: 6, r: -25, c: BLUSH },
];

/** 主役：誕生日のお祝いポスター（402×512）。人物は描かず、名前と装飾で華やかさを出す */
function BirthdayAdPoster() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(165deg, #FFFAF4 0%, #FFE9E6 48%, #FFE4C8 100%)', overflow: 'hidden' }}>
      {/* うすい光のすじ */}
      <div style={{ position: 'absolute', left: u(-60), top: u(-40), width: u(260), height: u(620), transform: 'rotate(22deg)', background: 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)' }} />
      {/* 金の細い内枠 */}
      <div style={{ position: 'absolute', left: u(14), top: u(14), right: u(14), bottom: u(30), border: `${ub(2)} solid ${GOLD_LIGHT}` }} />

      <Balloon x={-6} y={-8} w={70} color={BLUSH} dark="#D9788F" />
      <Balloon x={44} y={-26} w={56} color="#FFB27A" dark="#E07A35" />
      <Balloon x={290} y={-20} w={62} color={GOLD_LIGHT} dark="#C9962E" />
      <Balloon x={338} y={2} w={58} color={BLUSH} dark="#D9788F" />

      {POSTER_CONFETTI.map((p, i) => (
        <span key={i} aria-hidden style={{ position: 'absolute', left: u(p.x), top: u(p.y), width: u(p.w), height: u(p.h), background: p.c, borderRadius: p.round ? '50%' : u(2), transform: `rotate(${p.r}deg)` }} />
      ))}
      <Sparkle x={30} y={236} size={24} />
      <Sparkle x={374} y={226} size={20} />
      <Sparkle x={200} y={112} size={16} color={C.orange} />

      <div style={{ position: 'absolute', left: 0, right: 0, top: u(108), display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ fontFamily: SCRIPT_FONT, fontStyle: 'italic', fontSize: u(84), lineHeight: 1, color: '#E8692E', whiteSpace: 'nowrap' }}>Happy</span>
        <span style={{ marginTop: u(4), fontFamily: SERIF_FONT, fontSize: u(46), fontWeight: 700, letterSpacing: '0.2em', paddingLeft: '0.2em', color: GOLD, whiteSpace: 'nowrap' }}>BIRTHDAY</span>
        <span style={{ marginTop: u(16), display: 'flex', alignItems: 'center', gap: u(10) }}>
          <span style={{ width: u(70), height: u(2), background: GOLD_LIGHT }} />
          <span style={{ width: u(8), height: u(8), transform: 'rotate(45deg)', background: GOLD }} />
          <span style={{ width: u(70), height: u(2), background: GOLD_LIGHT }} />
        </span>
        <span style={{ marginTop: u(22), fontSize: u(66), fontWeight: 900, color: C.ink, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>推しの名前</span>
        <span style={{ marginTop: u(14), fontFamily: SERIF_FONT, fontSize: u(24), letterSpacing: '0.16em', color: C.body, whiteSpace: 'nowrap' }}>2026.◯◯.◯◯</span>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: u(16), background: `linear-gradient(90deg, ${C.orange} 0%, #FF8A5B 50%, ${C.orange} 100%)` }} />
    </div>
  );
}

/**
 * 駅構内の背景（SVG・一点透視）。奥の壁に主役の広告を正面から掲出し、天井の照明・床のタイル・左右の壁で奥行きを出す。
 * 背景は彩度を落として、主役のポスターが目立つようにする。
 */
function StationScene({ W, H, back }: { W: number; H: number; back: { x1: number; x2: number; y1: number; y2: number } }) {
  const vx = W / 2;
  const floorLines = [-1.2, -0.75, -0.4, -0.12, 0.12, 0.4, 0.75, 1.2].map((t) => vx + t * W);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="st-back" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F2EDE5" />
          <stop offset="100%" stopColor="#E3DBCF" />
        </linearGradient>
        <linearGradient id="st-ceil" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#CFC8BC" />
          <stop offset="100%" stopColor="#E9E3D9" />
        </linearGradient>
        <linearGradient id="st-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4A4640" />
          <stop offset="100%" stopColor="#24211E" />
        </linearGradient>
        <linearGradient id="st-left" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#CFC7BA" />
          <stop offset="100%" stopColor="#E4DDD2" />
        </linearGradient>
        <linearGradient id="st-right" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%" stopColor="#CFC7BA" />
          <stop offset="100%" stopColor="#E4DDD2" />
        </linearGradient>
        <radialGradient id="st-glow" cx="50%" cy="48%" r="55%">
          <stop offset="0%" stopColor="#FFE2C4" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#FFE2C4" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#FFE2C4" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="st-reflect" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD9B5" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#FFD9B5" stopOpacity="0" />
        </linearGradient>
        <pattern id="st-tile" width="44" height="44" patternUnits="userSpaceOnUse">
          <path d="M44 0 L0 0 0 44" fill="none" stroke="#000" strokeOpacity="0.05" strokeWidth="1.5" />
        </pattern>
      </defs>

      {/* 天井・左右の壁・床（一点透視） */}
      <polygon points={`0,0 ${W},0 ${back.x2},${back.y1} ${back.x1},${back.y1}`} fill="url(#st-ceil)" />
      <polygon points={`0,0 ${back.x1},${back.y1} ${back.x1},${back.y2} 0,${H}`} fill="url(#st-left)" />
      <polygon points={`${W},0 ${back.x2},${back.y1} ${back.x2},${back.y2} ${W},${H}`} fill="url(#st-right)" />
      <polygon points={`0,${H} ${W},${H} ${back.x2},${back.y2} ${back.x1},${back.y2}`} fill="url(#st-floor)" />
      {/* 床のタイル目地（消失点へ向かう線） */}
      {floorLines.map((x, i) => (
        <line key={i} x1={x} y1={H} x2={vx + (x - vx) * ((back.x2 - back.x1) / W)} y2={back.y2} stroke="#FFFFFF" strokeOpacity="0.07" strokeWidth="2" />
      ))}
      {/* 天井の照明（奥へ向かう光の帯） */}
      {[0.3, 0.7].map((t, i) => {
        const xb = back.x1 + (back.x2 - back.x1) * t;
        const xf = W * t;
        return <polygon key={i} points={`${xf - 34},0 ${xf + 34},0 ${xb + 10},${back.y1} ${xb - 10},${back.y1}`} fill="#FFFFFF" fillOpacity="0.85" />;
      })}
      {/* 左右の壁の広告枠（奥行きの手がかり） */}
      <polygon points={`22,${back.y1 + 40} ${back.x1 - 26},${back.y1 + 70} ${back.x1 - 26},${back.y2 - 120} 22,${back.y2 - 60}`} fill="#2E2C28" fillOpacity="0.55" />
      <polygon points={`32,${back.y1 + 52} ${back.x1 - 34},${back.y1 + 79} ${back.x1 - 34},${back.y2 - 128} 32,${back.y2 - 72}`} fill="#F6F1EA" fillOpacity="0.8" />
      <polygon points={`${W - 22},${back.y1 + 40} ${back.x2 + 26},${back.y1 + 70} ${back.x2 + 26},${back.y2 - 120} ${W - 22},${back.y2 - 60}`} fill="#2E2C28" fillOpacity="0.55" />
      <polygon points={`${W - 32},${back.y1 + 52} ${back.x2 + 34},${back.y1 + 79} ${back.x2 + 34},${back.y2 - 128} ${W - 32},${back.y2 - 72}`} fill="#F6F1EA" fillOpacity="0.8" />

      {/* 奥の壁（タイルと照明のあたり） */}
      <rect x={back.x1} y={back.y1} width={back.x2 - back.x1} height={back.y2 - back.y1} fill="url(#st-back)" />
      <rect x={back.x1} y={back.y1} width={back.x2 - back.x1} height={back.y2 - back.y1} fill="url(#st-tile)" />
      <rect x={back.x1} y={back.y1} width={back.x2 - back.x1} height={back.y2 - back.y1} fill="url(#st-glow)" />
      {/* 壁と床の境目の幅木 */}
      <rect x={back.x1} y={back.y2 - 10} width={back.x2 - back.x1} height={10} fill="#8C857A" />
      {/* 床への映り込み */}
      <polygon points={`${vx - 190},${back.y2} ${vx + 190},${back.y2} ${vx + 250},${H} ${vx - 250},${H}`} fill="url(#st-reflect)" />
    </svg>
  );
}

function StationAdVisual() {
  const W = 960;
  const H = 660;
  // 奥の壁（ここに主役の広告を正面から掲出する）
  const back = { x1: 150, x2: 810, y1: 34, y2: 566 };
  const frame = { w: 430, h: 520 };
  const fx = (W - frame.w) / 2;
  const fy = 30;
  const bezel = 14;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', border: `${ub(4)} solid ${C.ink}`, background: '#E8E1D6' }}>
      <StationScene W={W} H={H} back={back} />

      {/* 駅名標（天井から下がる案内サイン） */}
      <div style={{ position: 'absolute', left: u(22), top: u(22), display: 'flex', alignItems: 'center', gap: u(10), background: C.ink, color: '#FFF', padding: `${u(7)} ${u(16)}`, borderRadius: u(6), zIndex: 2 }}>
        <span style={{ width: u(20), height: u(20), borderRadius: '50%', border: `${ub(5)} solid #5DB383`, background: '#FFF' }} />
        <span style={{ fontSize: u(24), fontWeight: 900, whiteSpace: 'nowrap' }}>◯◯駅</span>
      </div>
      <span style={{ position: 'absolute', top: u(22), right: u(22), zIndex: 4, fontSize: u(24), fontWeight: 900, color: C.amberText, background: C.amberSoft, border: `${ub(2)} solid #E8B44A`, padding: `${u(4)} ${u(14)}`, whiteSpace: 'nowrap' }}>
        掲載イメージ
      </span>

      {/* 広告パネルの落ち影（box-shadow は PNG 保存時に Safari で消えるため、グラデーションで描く） */}
      <div style={{ position: 'absolute', left: u(fx - 14), top: u(fy + frame.h - 6), width: u(frame.w + 28), height: u(26), background: 'radial-gradient(closest-side, rgba(30,20,10,0.45), rgba(30,20,10,0))' }} />
      {/* 主役の広告パネル（金属の枠＋内照明） */}
      <div style={{ position: 'absolute', left: u(fx), top: u(fy), width: u(frame.w), height: u(frame.h), padding: u(bezel), background: 'linear-gradient(180deg, #5A5650 0%, #2C2A27 100%)', borderRadius: u(6), zIndex: 1 }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', outline: `${ub(2)} solid rgba(255,255,255,0.35)` }}>
          <BirthdayAdPoster />
          {/* パネル表面の映り込み */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 30%, rgba(255,255,255,0) 100%)' }} />
        </div>
        {/* 上部の照明バー */}
        <div style={{ position: 'absolute', left: u(40), right: u(40), top: u(3), height: u(5), borderRadius: u(4), background: '#FFF6E8' }} />
      </div>

      <OccasionTag x={22} y={150} rotate={-6} label="誕生日" />
      <OccasionTag x={760} y={250} rotate={5} label="周年" />
      <OccasionTag x={14} y={392} rotate={4} label="デビュー記念" />

      {/* 床の帯：補足のひとこと */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: u(H - back.y2), display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
        <span style={{ fontSize: u(34), fontWeight: 900, color: '#FFFFFF', whiteSpace: 'nowrap', letterSpacing: '0.02em' }}>
          誕生日・周年・<span style={{ color: '#FFB27A' }}>デビュー記念</span>にも。
        </span>
      </div>
    </div>
  );
}

function SupportAdSlide1({ slide }: { slide: StorySlide }) {
  return (
    <>
      <div data-story-zone="text" style={zoneBox(AD1_TEXT)}>
        <LabelRow label="はじめての応援広告" tone="orange" pr />
        {/* 3行。いちばん伝えたい「駅広告でお祝い」だけを大きく、オレンジの下線で強調する */}
        <h3 style={{ margin: `${u(24)} 0 0`, fontWeight: 900, color: C.ink, letterSpacing: '-0.01em', whiteSpace: 'pre' }}>
          <span style={{ display: 'block', fontSize: u(58), lineHeight: 1.25 }}>推しの誕生日や周年、</span>
          <span style={{ display: 'inline-block', fontSize: u(94), lineHeight: 1.18, borderBottom: `${ub(14)} solid ${C.orange}`, paddingBottom: u(2) }}>
            <span style={{ color: C.orange }}>駅広告</span>でお祝い
          </span>
          <span style={{ display: 'block', marginTop: u(8), fontSize: u(58), lineHeight: 1.25 }}>できるって知ってた？</span>
        </h3>
        <p style={{ margin: `${u(18)} 0 0`, fontSize: u(32), fontWeight: 700, lineHeight: 1.5, color: C.body, whiteSpace: 'pre' }}>
          <span style={{ color: C.orangeText, fontWeight: 900 }}>「応援広告」</span>
          {'は、\n推しへのお祝いを広告として出せる推し活。'}
        </p>
      </div>

      <div data-story-zone="image" style={zoneBox(AD1_VISUAL, 60)}>
        <StationAdVisual />
      </div>

      <StickerCta slide={slide} tone="primary" size={56} />
    </>
  );
}

/**
 * 始め方の4ステップ。content.ts の FLOW_STEPS（6段階）を、順番を保ったまま短くまとめたもの
 * （steps は FLOW_STEPS の添字。すべての段階を1回ずつ含むことをテストで確認）。
 */
export const SUPPORT_AD_START_STEPS = [
  { label: '掲載場所を\n選ぶ', steps: [0] },
  { label: '申し込み・\n支払い', steps: [1] },
  { label: '書類と\nデザインを提出', steps: [2, 3] },
  { label: '審査のあと\n掲載スタート', steps: [4, 5] },
] as const;

const CREAM_CARD = '#FFF7EE';

/** 媒体のアイコン（SVG） */
function MediaIcon({ kind }: { kind: 'poster' | 'signage' | 'vision' }) {
  const common = { width: u(84), height: u(72), display: 'block' as const };
  if (kind === 'poster') {
    return (
      <svg viewBox="0 0 84 72" aria-hidden style={common}>
        <rect x="24" y="4" width="36" height="52" rx="2" fill="#FFF1E8" stroke={C.ink} strokeWidth="4" />
        <rect x="31" y="13" width="22" height="4" fill={C.orange} />
        <rect x="31" y="22" width="22" height="14" fill="#FFD3B8" />
        <line x1="14" y1="66" x2="70" y2="66" stroke={C.ink} strokeWidth="4" strokeLinecap="round" />
        <line x1="42" y1="56" x2="42" y2="66" stroke={C.ink} strokeWidth="4" />
      </svg>
    );
  }
  if (kind === 'signage') {
    return (
      <svg viewBox="0 0 84 72" aria-hidden style={common}>
        <rect x="10" y="8" width="64" height="42" rx="4" fill={C.ink} />
        <rect x="16" y="14" width="52" height="30" fill={C.orange} />
        <path d="M30 23 L40 29 L30 35 Z" fill="#FFF" />
        <line x1="42" y1="50" x2="42" y2="64" stroke={C.ink} strokeWidth="4" />
        <line x1="28" y1="66" x2="56" y2="66" stroke={C.ink} strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 84 72" aria-hidden style={common}>
      <rect x="4" y="6" width="76" height="44" rx="3" fill={C.ink} />
      <rect x="9" y="11" width="66" height="34" fill="#FFB27A" />
      <rect x="9" y="11" width="66" height="12" fill={C.orange} />
      <rect x="14" y="50" width="6" height="18" fill={C.ink} />
      <rect x="64" y="50" width="6" height="18" fill={C.ink} />
      <rect x="22" y="58" width="10" height="10" fill={C.ink} />
      <rect x="40" y="54" width="12" height="14" fill={C.ink} />
    </svg>
  );
}

/** 白い角ばったパネル（黒枠＋ずらし影）。高さは親いっぱい */
function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ position: 'relative', width: `calc(100% - ${u(12)})`, ...style }}>
      <HardShadow offset={12} color={C.ink} />
      <div style={{ position: 'relative', height: '100%', background: C.surface, border: `${ub(4)} solid ${C.ink}`, padding: `${u(22)} ${u(26)}`, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}

function SupportAdCostSlide({ slide }: { slide: StorySlide }) {
  const icon: Record<(typeof SUPPORT_AD_PRICE_ROWS)[number]['key'], 'poster' | 'signage' | 'vision'> = { poster: 'poster', signage: 'signage', vision: 'vision' };
  return (
    <>
      <div data-story-zone="text" style={zoneBox(AD1_TEXT)}>
        <LabelRow label="費用と始め方" tone="outline" pr />
        <Headline size={76}>
          {'応援広告、\n'}
          <Mark>いくらかかるの？</Mark>
        </Headline>
        <Sub>{'何から始める？費用はどれくらい？'}</Sub>
        <p style={{ margin: `${u(14)} 0 0`, display: 'inline-block', fontSize: u(34), fontWeight: 800, color: C.ink, background: C.orangeSoft, borderLeft: `${ub(8)} solid ${C.orange}`, padding: `${u(8)} ${u(18)}`, whiteSpace: 'nowrap' }}>
          まずは推しアドで費用や始め方をチェック。
        </p>
      </div>

      {/* 下端は「1タップで」ラベル（y=1424〜）の手前で止める（パネルの影まで含めて y≈1418） */}
      <div data-story-zone="image" style={{ ...zoneBox(AD1_VISUAL, 60), paddingBottom: u(34), display: 'flex', flexDirection: 'column', gap: u(16) }}>
        {/* 費用の目安：大きな金額カード3枚 */}
        <Panel style={{ height: u(360) }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: u(34), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap' }}>
              費用の目安<span style={{ fontSize: u(26), color: C.body }}>（7日間）</span>
            </span>
            <span style={{ fontSize: u(24), fontWeight: 900, color: C.orangeText, background: C.orangeSoft, border: `${ub(2)} solid ${C.orange}`, padding: `${u(4)} ${u(14)}`, whiteSpace: 'nowrap' }}>
              場所・媒体・時期で変わります
            </span>
          </div>
          <div style={{ marginTop: u(16), flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: u(14) }}>
            {SUPPORT_AD_PRICE_ROWS.map((r) => (
              <div key={r.key} style={{ background: CREAM_CARD, border: `${ub(3)} solid ${C.ink}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u(8), padding: `${u(12)} ${u(6)}` }}>
                <MediaIcon kind={icon[r.key]} />
                <span style={{ fontSize: u(26), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap' }}>{r.media}</span>
                <span style={{ fontSize: u(42), fontWeight: 900, color: C.orangeText, letterSpacing: '-0.02em', lineHeight: 1.1, whiteSpace: 'nowrap' }}>{r.price}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: `${u(12)} 0 0`, fontSize: u(20), fontWeight: 700, color: C.muted, whiteSpace: 'nowrap' }}>
            {`出典：推しアド公式の費用ガイド（${COST_GUIDE_UPDATED_AT}更新）。税込・税抜の記載なし`}
          </p>
        </Panel>

        {/* 始め方：4ステップ */}
        <Panel style={{ flex: 1 }}>
          <span style={{ fontSize: u(32), fontWeight: 900, color: C.ink, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
            始め方は<span style={{ color: C.orangeText }}>4ステップ</span>
          </span>
          <div style={{ marginTop: u(10), flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            {SUPPORT_AD_START_STEPS.map((step, i) => (
              <div key={step.label} style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div style={{ width: u(196), display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u(8) }}>
                  <span style={{ width: u(56), height: u(56), borderRadius: '50%', background: C.orange, border: `${ub(3)} solid ${C.ink}`, color: '#FFF', fontSize: u(32), fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {i + 1}
                  </span>
                  <span style={{ fontSize: u(25), fontWeight: 900, color: C.ink, textAlign: 'center', lineHeight: 1.35, whiteSpace: 'pre' }}>{step.label}</span>
                </div>
                {i < SUPPORT_AD_START_STEPS.length - 1 && (
                  <span aria-hidden style={{ marginTop: u(14), fontSize: u(30), fontWeight: 900, color: C.orange }}>›</span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* 2枚目（最後のスライド）は最も目立たせる：オレンジのCTA＋「1タップで」ラベル */}
      <CtaHint>1タップで応援広告ガイドへ</CtaHint>
      <StickerCta slide={slide} tone="primary" size={50} />
    </>
  );
}

/** デザイン済みのテンプレート（テンプレートID → スライドごとの描画） */
const STORY_DESIGNS: Record<string, ((props: { slide: StorySlide }) => ReactNode)[]> = {
  'oshi-vod-diagnosis': [OshiVodSlide1, OshiVodSlide2, OshiVodSlide3],
  // 推しアドは2枚構成（興味を引く → 費用と始め方）
  'support-ads-oshiad': [SupportAdSlide1, SupportAdCostSlide],
};

export function hasStoryDesign(templateId: string, slideIndex: number): boolean {
  return Boolean(STORY_DESIGNS[templateId]?.[slideIndex]);
}

function zoneStylePct(zone: StoryZone): CSSProperties {
  return { position: 'absolute', left: 0, right: 0, top: u(zone.top), height: u(zone.bottom - zone.top) };
}

/** Instagram標準UIの範囲とリンクステッカー予定位置を重ねて表示する確認用ガイド */
function GuideOverlay({ slide }: { slide: StorySlide }) {
  const sticker = getLinkStickerZone(slide.linkPosition);
  const label: CSSProperties = { fontSize: u(30), fontWeight: 800, color: '#FFF', textShadow: '0 0 4px rgba(0,0,0,.6)' };
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
      <div style={{ ...zoneStylePct(STORY_LAYOUT.topUi), background: 'rgba(15,15,15,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: u(20) }}>
        <span style={label}>Instagram UI（上部）</span>
      </div>
      <div style={{ ...zoneStylePct(sticker), border: `${ub(5)} dashed #7C3AED`, background: 'rgba(124,58,237,.10)' }}>
        <span style={{ position: 'absolute', right: u(12), top: u(-46), fontSize: u(26), fontWeight: 800, color: '#7C3AED', background: '#FFF', padding: `0 ${u(10)}` }}>
          リンクステッカー（下端から{slide.linkPosition.bottomOffsetMinPx}〜{slide.linkPosition.bottomOffsetMaxPx}px）
        </span>
      </div>
      <div style={{ ...zoneStylePct(STORY_LAYOUT.bottomUi), background: 'rgba(15,15,15,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: u(20) }}>
        <span style={label}>Instagram UI（返信欄など）</span>
      </div>
    </div>
  );
}

/** 1080×1920 比率の枠に、デザイン済みスライドを描く */
export function StoryDesignFrame({ templateId, slideIndex, slide, showGuide }: { templateId: string; slideIndex: number; slide: StorySlide; showGuide: boolean }) {
  const Design = STORY_DESIGNS[templateId]?.[slideIndex];
  if (!Design) return null;
  return (
    <div
      data-story-frame
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: `${STORY_CANVAS.width} / ${STORY_CANVAS.height}`,
        containerType: 'inline-size',
        background: C.bg,
        fontFamily: FONT,
        color: C.ink,
        overflow: 'hidden',
        textAlign: 'left',
      }}
    >
      <Design slide={slide} />
      {showGuide && <GuideOverlay slide={slide} />}
    </div>
  );
}
