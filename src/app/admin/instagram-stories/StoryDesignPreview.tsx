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
import { COST_GUIDE_UPDATED_AT, FLOW_STEPS } from '@/lib/support-ads/content';

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
// 人物写真・他社の広告画像・推しアドのバナー画像（計測用の外部画像）は使わず、CSS で描いたイラストと
// 推しサーチの応援広告ガイド（/support-ads）の画面イメージで構成する。
// 費用・流れは src/lib/support-ads/content.ts（推しアド公式で確認済みの内容）と同じ値だけを使う。

/** 費用の目安（7日間）。値は content.ts の MEDIA_GUIDES.priceNote と一致すること（テストで確認） */
export const SUPPORT_AD_PRICE_ROWS = [
  { key: 'poster', media: '駅ポスター（B1）', price: '4万〜8万円' },
  { key: 'signage', media: '駅サイネージ', price: '5万〜50万円' },
  { key: 'vision', media: '屋外ビジョン', price: '30万円〜' },
] as const;

const CREAM = '#FFF7EE';

function IllustrationTag({ children }: { children: ReactNode }) {
  return (
    <span style={{ position: 'absolute', top: u(18), right: u(18), zIndex: 1, fontSize: u(22), fontWeight: 800, color: C.amberText, background: C.amberSoft, padding: `${u(2)} ${u(12)}`, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

/** イラスト用の外枠（MockCard と同じ黒枠・ずらし影。中身はクリーム地） */
function IllustrationCard({ children, tag }: { children: ReactNode; tag: string }) {
  return (
    <div style={{ position: 'relative', height: `calc(100% - ${u(14)})`, width: `calc(100% - ${u(14)})` }}>
      <HardShadow offset={14} color={C.ink} />
      <div style={{ position: 'relative', height: '100%', width: '100%', background: CREAM, border: `${ub(4)} solid ${C.ink}`, overflow: 'hidden' }}>
        <IllustrationTag>{tag}</IllustrationTag>
        {children}
      </div>
    </div>
  );
}

/** お祝いメッセージ入りの応援広告（イラスト）。名前は「推しの名前」のまま（実在の人物は描かない） */
function BirthdayPoster({ width, height, title = 'HAPPY BIRTHDAY' }: { width: number; height: number; title?: string }) {
  return (
    <div style={{ width: u(width), height: u(height), background: `linear-gradient(160deg, #FFE3CF 0%, #FFF7EE 55%, #FFD9BF 100%)`, border: `${ub(3)} solid ${C.ink}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u(height * 0.04), position: 'relative' }}>
      <span style={{ fontFamily: MONO, fontSize: u(width * 0.085), fontWeight: 700, color: C.orangeText, letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>{title}</span>
      <span style={{ fontSize: u(width * 0.3), lineHeight: 1 }} aria-hidden>🎂</span>
      <span style={{ fontSize: u(width * 0.11), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap' }}>推しの名前</span>
      <span style={{ fontSize: u(width * 0.065), fontWeight: 700, color: C.body, whiteSpace: 'nowrap' }}>おめでとう！</span>
    </div>
  );
}

/** 1枚目は駅広告のビジュアルを主役にするため、本文を短くまとめて画像ブロックを広げる（CTA は2・3枚目と同じ高さ） */
const AD1_TEXT: StoryZone = { top: TEXT_ZONE.top, bottom: 756 };
const AD1_VISUAL: StoryZone = { top: 780, bottom: 1440 };

/** 駅の壁面に貼られた広告枠（左右の枠は奥行きを出すための脇役） */
function AdFrame({ x, y, w, h, dim = false, children }: { x: number; y: number; w: number; h: number; dim?: boolean; children?: ReactNode }) {
  return (
    <div style={{ position: 'absolute', left: u(x), top: u(y), width: u(w), height: u(h), background: '#2E2C28', padding: u(dim ? 10 : 14), opacity: dim ? 0.55 : 1 }}>
      <div style={{ width: '100%', height: '100%', background: dim ? '#F3EEE6' : 'linear-gradient(170deg, #FFF8EF 0%, #FFE4D6 55%, #FFE9C2 100%)', position: 'relative', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

/** 掲出例のラベル（誕生日・周年・デビュー記念） */
function OccasionTag({ x, y, rotate, label }: { x: number; y: number; rotate: number; label: string }) {
  return (
    <div style={{ position: 'absolute', left: u(x), top: u(y), transform: `rotate(${rotate}deg)` }}>
      <div style={{ position: 'relative' }}>
        <HardShadow offset={6} color={C.ink} radius={u(999)} />
        <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: u(10), background: C.surface, border: `${ub(3)} solid ${C.ink}`, borderRadius: u(999), padding: `${u(10)} ${u(24)}`, fontSize: u(30), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap' }}>
          <span style={{ width: u(14), height: u(14), borderRadius: '50%', background: C.orange }} />
          {label}
        </span>
      </div>
    </div>
  );
}

const AD1_CONFETTI: { x: number; y: number; w: number; h: number; r: number; c: string; round?: boolean }[] = [
  { x: 320, y: 40, w: 20, h: 9, r: -25, c: C.orange },
  { x: 410, y: 22, w: 12, h: 12, r: 0, c: '#E8B44A', round: true },
  { x: 560, y: 34, w: 22, h: 9, r: 30, c: '#F4A7B9' },
  { x: 650, y: 52, w: 12, h: 12, r: 0, c: C.orange, round: true },
  { x: 250, y: 300, w: 18, h: 8, r: 40, c: '#E8B44A' },
  { x: 720, y: 280, w: 20, h: 9, r: -35, c: '#F4A7B9' },
  { x: 230, y: 470, w: 12, h: 12, r: 0, c: '#F4A7B9', round: true },
  { x: 735, y: 500, w: 12, h: 12, r: 0, c: '#E8B44A', round: true },
];

function StationAdVisual() {
  const W = 960;
  const floor = 92;
  const frame = { w: 400, h: 500 };
  const fx = (W - frame.w) / 2;
  const fy = 40;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', border: `${ub(4)} solid ${C.ink}`, background: `repeating-linear-gradient(90deg, rgba(0,0,0,0.045) 0 ${u(2)}, transparent ${u(2)} ${u(120)}), repeating-linear-gradient(0deg, rgba(0,0,0,0.045) 0 ${u(2)}, transparent ${u(2)} ${u(120)}), linear-gradient(180deg, #F1ECE3 0%, #E4DDD1 100%)` }}>
      {/* 天井の照明 */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: u(14), background: '#FFFFFF', borderBottom: `${ub(2)} solid #D8D1C4` }} />
      {/* 主役の広告枠のまわりの明るさ（照明に照らされた掲出面） */}
      <div style={{ position: 'absolute', left: u(fx - 140), top: u(fy - 90), width: u(frame.w + 280), height: u(frame.h + 180), background: 'radial-gradient(closest-side, rgba(255,214,170,0.75), rgba(255,214,170,0))' }} />

      {/* 左右の広告枠（奥行き用） */}
      <AdFrame x={-120} y={110} w={230} h={330} dim />
      <AdFrame x={W - 110} y={110} w={230} h={330} dim />

      {/* 駅名標 */}
      <div style={{ position: 'absolute', left: u(28), top: u(34), display: 'flex', alignItems: 'center', gap: u(10), background: C.ink, color: '#FFF', padding: `${u(8)} ${u(18)}`, borderRadius: u(6) }}>
        <span style={{ width: u(22), height: u(22), borderRadius: '50%', border: `${ub(5)} solid #5DB383`, background: '#FFF' }} />
        <span style={{ fontSize: u(26), fontWeight: 900, whiteSpace: 'nowrap' }}>◯◯駅</span>
      </div>
      <span style={{ position: 'absolute', top: u(34), right: u(28), zIndex: 2, fontSize: u(24), fontWeight: 900, color: C.amberText, background: C.amberSoft, border: `${ub(2)} solid #E8B44A`, padding: `${u(4)} ${u(14)}`, whiteSpace: 'nowrap' }}>
        掲載イメージ
      </span>

      {/* 主役：誕生日の駅ポスター */}
      <AdFrame x={fx} y={fy} w={frame.w} h={frame.h}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: u(26) }}>
          <span style={{ fontSize: u(26), fontWeight: 900, color: C.orangeText, letterSpacing: '0.32em', whiteSpace: 'nowrap', paddingLeft: '0.32em' }}>HAPPY</span>
          <span style={{ fontSize: u(54), fontWeight: 900, color: C.ink, letterSpacing: '0.06em', lineHeight: 1.1, whiteSpace: 'nowrap' }}>BIRTHDAY</span>
          {/* 写真やイラストを入れる場所（人物は描かない） */}
          <div style={{ marginTop: u(16), width: u(160), height: u(160), borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #FFFFFF 0%, #FFD3B8 60%, #FFB98F 100%)', border: `${ub(6)} solid #E8B44A`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: u(80), color: '#E8B44A', lineHeight: 1 }} aria-hidden>★</span>
          </div>
          <span style={{ marginTop: u(20), fontSize: u(50), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap' }}>推しの名前</span>
          <span style={{ marginTop: u(6), fontFamily: MONO, fontSize: u(22), fontWeight: 700, color: C.body, letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>2026.◯◯.◯◯</span>
        </div>
        {/* ポスターの帯（オレンジ） */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: u(16), background: C.orange }} />
      </AdFrame>

      {AD1_CONFETTI.map((p, i) => (
        <span key={i} aria-hidden style={{ position: 'absolute', left: u(p.x), top: u(p.y), width: u(p.w), height: u(p.h), background: p.c, borderRadius: p.round ? '50%' : u(2), transform: `rotate(${p.r}deg)` }} />
      ))}

      <OccasionTag x={56} y={170} rotate={-6} label="誕生日" />
      <OccasionTag x={710} y={300} rotate={5} label="周年" />
      <OccasionTag x={40} y={430} rotate={4} label="デビュー記念" />

      {/* 床：照明の映り込みと、補足のひとこと */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: u(floor), background: 'linear-gradient(180deg, #3A3733 0%, #22201D 100%)', borderTop: `${ub(3)} solid ${C.ink}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', left: u(fx + 30), width: u(frame.w - 60), top: 0, height: u(26), background: 'linear-gradient(180deg, rgba(255,214,170,0.35), rgba(255,214,170,0))' }} />
        <span style={{ position: 'relative', fontSize: u(34), fontWeight: 900, color: '#FFFFFF', whiteSpace: 'nowrap', letterSpacing: '0.02em' }}>
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

function SupportAdSlide2({ slide }: { slide: StorySlide }) {
  return (
    <>
      <div data-story-zone="text" style={zoneBox(TEXT_ZONE)}>
        <LabelRow label="応援広告とは" tone="ink" pr />
        <Headline size={84}>
          {'応援広告って\n'}
          <Mark>知ってる？</Mark>
        </Headline>
        <Sub>{'推しを応援する気持ちを、\n広告という形に。'}</Sub>
      </div>

      <div data-story-zone="image" style={zoneBox(STORY_LAYOUT.image, 110)}>
        <IllustrationCard tag="掲載イメージ（イラスト）">
          {/* 駅の壁面：路線カラーの帯＋ポスター枠＋サイネージ */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: u(70), background: '#EDEBE4', borderBottom: `${ub(3)} solid ${C.ink}`, display: 'flex', alignItems: 'center', padding: `0 ${u(28)}`, gap: u(14) }}>
            <span style={{ width: u(18), height: u(18), borderRadius: '50%', background: '#5DB383' }} />
            <span style={{ fontFamily: MONO, fontSize: u(24), fontWeight: 700, color: C.body, letterSpacing: '0.1em', whiteSpace: 'nowrap' }}>STATION</span>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, top: u(70), bottom: u(96), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: u(56) }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u(12) }}>
              <BirthdayPoster width={220} height={310} />
              <span style={{ fontSize: u(26), fontWeight: 900, color: C.ink }}>駅ポスター</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: u(12) }}>
              <div style={{ background: C.ink, padding: u(14), borderRadius: u(10) }}>
                <div style={{ width: u(300), height: u(190), background: `linear-gradient(135deg, ${C.orange} 0%, #FF8A3D 100%)`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: u(8), color: '#FFF' }}>
                  <span style={{ fontFamily: MONO, fontSize: u(22), fontWeight: 700, letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>CONGRATULATIONS</span>
                  <span style={{ fontSize: u(36), fontWeight: 900, whiteSpace: 'nowrap' }}>推しの名前</span>
                  <span style={{ fontSize: u(22), fontWeight: 700, whiteSpace: 'nowrap' }}>デビュー◯周年</span>
                </div>
              </div>
              <span style={{ fontSize: u(26), fontWeight: 900, color: C.ink }}>駅サイネージ</span>
            </div>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: u(96), background: C.surface, borderTop: `${ub(3)} solid ${C.ink}`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `0 ${u(20)}` }}>
            <span style={{ fontSize: u(30), fontWeight: 800, color: C.ink, whiteSpace: 'nowrap' }}>
              誕生日・周年・ライブ記念など、<span style={{ color: C.orangeText }}>特別な日の応援</span>に。
            </span>
          </div>
        </IllustrationCard>
      </div>

      <StickerCta slide={slide} tone="outline" size={46} />
    </>
  );
}

function SupportAdSlide3({ slide }: { slide: StorySlide }) {
  const sectionLabel: CSSProperties = { margin: 0, fontSize: u(24), fontWeight: 800, color: C.muted, whiteSpace: 'nowrap' };
  return (
    <>
      <div data-story-zone="text" style={zoneBox(TEXT_ZONE)}>
        <LabelRow label="費用と始め方" tone="outline" pr />
        <Headline size={74}>
          {'応援広告、\n'}
          <Mark>いくらかかるの？</Mark>
        </Headline>
        <Sub>{'何から始める？費用はどれくらい？'}</Sub>
        <p style={{ margin: `${u(14)} 0 0`, display: 'inline-block', fontSize: u(34), fontWeight: 800, color: C.ink, background: C.orangeSoft, borderLeft: `${ub(8)} solid ${C.orange}`, padding: `${u(8)} ${u(18)}`, whiteSpace: 'nowrap' }}>
          まずは推しアドで費用や始め方をチェック。
        </p>
      </div>

      <div data-story-zone="image" style={zoneBox(STORY_LAYOUT.image, 110)}>
        <MockCard url="oshi-search.jp/support-ads" tag="画面イメージ">
          <p style={{ margin: 0, fontSize: u(36), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap' }}>はじめての応援広告ガイド</p>
          <p style={{ ...sectionLabel, marginTop: u(10) }}>費用の目安（7日間）</p>
          <div style={{ marginTop: u(6), borderTop: `${ub(3)} solid ${C.ink}` }}>
            {SUPPORT_AD_PRICE_ROWS.map((r) => (
              <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${u(6)} 0`, borderBottom: `${ub(2)} solid ${C.border}`, fontSize: u(27), whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 800, color: C.ink }}>{r.media}</span>
                <span style={{ fontWeight: 900, color: C.orangeText }}>{r.price}</span>
              </div>
            ))}
          </div>
          <p style={{ ...sectionLabel, marginTop: u(12) }}>掲載までの流れ</p>
          <div style={{ marginTop: u(8), display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: u(8) }}>
            {FLOW_STEPS.map((step, i) => (
              <span key={step.title} style={{ display: 'flex', alignItems: 'center', gap: u(8), background: C.blueSoft, color: C.blueText, fontSize: u(21), fontWeight: 800, padding: `${u(6)} ${u(10)}`, whiteSpace: 'nowrap' }}>
                <span style={{ fontFamily: MONO, color: C.orangeText }}>{i + 1}</span>
                {step.title}
              </span>
            ))}
          </div>
          <p style={{ margin: 'auto 0 0', paddingTop: u(8), fontSize: u(20), color: C.muted, lineHeight: 1.4 }}>
            {`※推しアド公式の費用ガイド（${COST_GUIDE_UPDATED_AT}更新）の目安。媒体・時期・空き状況で変わります。`}
          </p>
        </MockCard>
      </div>

      {/* 3枚の中で最も目立たせる：オレンジのCTA＋「1タップで」ラベル */}
      <CtaHint>1タップで応援広告ガイドへ</CtaHint>
      <StickerCta slide={slide} tone="primary" size={50} />
    </>
  );
}

/** デザイン済みのテンプレート（テンプレートID → スライドごとの描画） */
const STORY_DESIGNS: Record<string, ((props: { slide: StorySlide }) => ReactNode)[]> = {
  'oshi-vod-diagnosis': [OshiVodSlide1, OshiVodSlide2, OshiVodSlide3],
  'support-ads-oshiad': [SupportAdSlide1, SupportAdSlide2, SupportAdSlide3],
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
