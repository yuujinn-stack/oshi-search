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

/** 1080 基準の px → 枠幅に対する cqw */
const u = (px: number) => `calc(${px} * 100cqw / ${STORY_CANVAS.width})`;

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
const MONO = "'Space Mono', ui-monospace, SFMono-Regular, monospace";

const SIDE = 80;

function zoneBox(zone: StoryZone, inset = SIDE): CSSProperties {
  return { position: 'absolute', top: u(zone.top), height: u(zone.bottom - zone.top), left: u(inset), right: u(inset) };
}

/** 上部ラベル行（小さめの補足ラベル＋推しサーチのロゴ文字） */
function LabelRow({ label, tone }: { label: string; tone: 'orange' | 'ink' | 'outline' }) {
  const chip: CSSProperties =
    tone === 'orange'
      ? { background: C.orange, color: '#FFF', border: `${u(3)} solid ${C.orange}` }
      : tone === 'ink'
        ? { background: C.ink, color: '#FFF', border: `${u(3)} solid ${C.ink}` }
        : { background: C.surface, color: C.orangeText, border: `${u(3)} solid ${C.orange}` };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ ...chip, fontSize: u(34), fontWeight: 800, padding: `${u(8)} ${u(22)}`, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ fontSize: u(30), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap', letterSpacing: '0.02em' }}>
        推しサーチ
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

function Headline({ size, children }: { size: number; children: ReactNode }) {
  return (
    <h3 style={{ margin: `${u(44)} 0 0`, fontSize: u(size), fontWeight: 900, lineHeight: 1.28, color: C.ink, letterSpacing: '-0.01em', whiteSpace: 'pre' }}>
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

type CtaTone = 'primary' | 'outline' | 'strong';

/** リンクステッカーを置く位置（下端から300〜450px上）に描くCTA */
function StickerCta({ slide, tone, size }: { slide: StorySlide; tone: CtaTone; size: number }) {
  const zone = getLinkStickerZone(slide.linkPosition);
  const shadow = 12;
  const style: Record<CtaTone, CSSProperties> = {
    primary: { background: C.orange, color: '#FFF', border: `${u(4)} solid ${C.ink}`, boxShadow: `${u(shadow)} ${u(shadow)} 0 ${C.ink}` },
    outline: { background: C.surface, color: C.ink, border: `${u(4)} solid ${C.ink}`, boxShadow: `${u(10)} ${u(10)} 0 ${C.orange}` },
    strong: { background: C.ink, color: '#FFF', border: `${u(4)} solid ${C.ink}`, boxShadow: `${u(shadow)} ${u(shadow)} 0 ${C.orange}` },
  };
  const iconColor = tone === 'outline' ? C.orange : '#FFF';
  return (
    <div data-story-zone="cta" style={{ ...zoneBox(zone, 110), display: 'flex' }}>
      <div
        style={{
          ...style[tone],
          // 影のぶんだけ短くして、影まで含めて範囲内に収める
          width: `calc(100% - ${u(shadow)})`,
          height: `calc(100% - ${u(shadow)})`,
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
  );
}

/** モックアップの外枠（ブラウザ風の白いカード） */
function MockCard({ url, children, tag }: { url: string; children: ReactNode; tag?: string }) {
  return (
    <div
      style={{
        position: 'relative',
        background: C.surface,
        border: `${u(4)} solid ${C.ink}`,
        boxShadow: `${u(14)} ${u(14)} 0 ${C.ink}`,
        height: `calc(100% - ${u(14)})`,
        width: `calc(100% - ${u(14)})`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: u(10), padding: `${u(14)} ${u(22)}`, borderBottom: `${u(3)} solid ${C.ink}`, background: C.bg }}>
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
    ? { background: C.surface, color: C.muted, border: `${u(2)} solid ${C.borderStrong}`, fontWeight: 700, fontSize: u(26), padding: `${u(10)} 0`, margin: `0 ${u(120)}` }
    : { background: C.ink, color: '#FFF', fontWeight: 900, fontSize: u(34), padding: `${u(18)} 0`, boxShadow: `${u(8)} ${u(8)} 0 ${C.orange}`, marginRight: u(8) };
  return <div style={{ ...style, textAlign: 'center', whiteSpace: 'nowrap' }}>{children}</div>;
}

const AVATAR_COLORS = ['#F2994A', '#6C9BD2', '#5DB383'];

// ── 推しからサブスク診断 ────────────────────────────────────────────────

function OshiVodSlide1({ slide }: { slide: StorySlide }) {
  return (
    <>
      <div data-story-zone="text" style={zoneBox(STORY_LAYOUT.text)}>
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
          <div style={{ marginTop: u(26), border: `${u(3)} solid ${C.ink}`, padding: `${u(16)} ${u(20)}`, display: 'flex', alignItems: 'center', gap: u(14), fontSize: u(30), color: C.muted }}>
            <span aria-hidden>🔍</span>
            <span style={{ whiteSpace: 'nowrap' }}>推しの名前を入力</span>
          </div>
          <div style={{ marginTop: u(20), display: 'flex', gap: u(14) }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: u(10), background: C.greenSoft, border: `${u(2)} solid ${C.green}`, padding: `${u(8)} ${u(18)} ${u(8)} ${u(8)}`, fontSize: u(28), fontWeight: 800, color: C.ink }}>
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
      <span
        data-story-zone="cta-hint"
        style={{
          position: 'absolute',
          left: u(150),
          // 画像ブロックの下端〜リンクステッカー上端のすき間（1420〜1470）に収める
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
        1タップで診断ページへ
      </span>
      <StickerCta slide={slide} tone="primary" size={54} />
    </>
  );
}

function OshiVodSlide2({ slide }: { slide: StorySlide }) {
  const panel = (title: string, people: string[], note?: string) => (
    <div style={{ flex: 1, border: `${u(3)} solid ${C.ink}`, background: C.surface, padding: `${u(22)} ${u(20)}`, display: 'flex', flexDirection: 'column', gap: u(16), minWidth: 0 }}>
      <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: u(8), fontSize: u(28), fontWeight: 900, color: C.ink, whiteSpace: 'nowrap' }}>
        <Check size={34} />
        {title}
      </p>
      {people.map((p, i) => (
        <span key={p} style={{ display: 'flex', alignItems: 'center', gap: u(14), background: C.greenSoft, border: `${u(2)} solid ${C.green}`, padding: `${u(8)} ${u(14)}`, fontSize: u(28), fontWeight: 800, color: C.ink, whiteSpace: 'nowrap' }}>
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
      <div data-story-zone="text" style={zoneBox(STORY_LAYOUT.text)}>
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
      <div data-story-zone="text" style={zoneBox(STORY_LAYOUT.text)}>
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
          <div style={{ ...grid, marginTop: u(22), paddingBottom: u(10), borderBottom: `${u(3)} solid ${C.ink}` }}>
            <span style={{ ...cell, fontSize: u(24), fontWeight: 800, color: C.muted }}>配信サービス</span>
            <span style={{ ...cell, fontSize: u(24), fontWeight: 800, color: C.muted }}>出演作品数</span>
            <span style={{ ...cell, fontSize: u(24), fontWeight: 800, color: C.muted, textAlign: 'right' }}>月額料金</span>
          </div>
          {rows.map((name, i) => (
            <div key={name} style={{ ...grid, padding: `${u(18)} 0`, borderBottom: `${u(2)} solid ${C.border}` }}>
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

/** デザイン済みのテンプレート（テンプレートID → スライドごとの描画） */
const STORY_DESIGNS: Record<string, ((props: { slide: StorySlide }) => ReactNode)[]> = {
  'oshi-vod-diagnosis': [OshiVodSlide1, OshiVodSlide2, OshiVodSlide3],
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
      <div style={{ ...zoneStylePct(sticker), border: `${u(5)} dashed #7C3AED`, background: 'rgba(124,58,237,.10)' }}>
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
