'use client';

/**
 * 自動作成のカード（B＝関連商品、E＝グッズ制作サービス）。ScreenImage の白い枠の中いっぱいに描く。
 * 枠の大きさはページの構成で変わるため、文字・余白は枠の幅に対する割合（cqw）で指定する。
 * 'portrait'（縦長の枠）は大きい1件＋小さい2件、'wide'（正方形に近い枠）は横に並べる。
 * 画像は data: URL だけ（PNG 保存で欠けない）。画像が無い商品は、商品名とカテゴリの代替カードにする。
 */

import type { CSSProperties } from 'react';
import type { ProductPanelItem, ServicePanelItem, StoryPanel } from '@/lib/story-maker/panels';

export type PanelShape = 'portrait' | 'wide';

const INK = '#3B2F2A';
const MUTED = '#7A6A62';
const LINE = '#EDE6DA';

const SECTION_ICON: Record<string, string> = {
  '写真集・書籍': '📷',
  '本・写真集': '📷',
  CD: '💿',
  'Blu-ray・DVD': '📀',
  グッズ: '🎁',
};

const clamp = (lines: number): CSSProperties => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
});

function Header({ text, accent }: { text: string; accent: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
      <span data-panel-title style={{ background: accent, color: INK, fontWeight: 800, fontSize: '4.4cqw', lineHeight: 1.3, padding: '0.9cqw 4cqw', borderRadius: 999, maxWidth: '100%', ...clamp(1) }}>{text}</span>
    </div>
  );
}

function ProductCard({ item, big, accent }: { item: ProductPanelItem; big: boolean; accent: string }) {
  const icon = SECTION_ICON[item.section] ?? '🛍';
  return (
    <div data-panel-item style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#FFFFFF', border: `0.4cqw solid ${LINE}`, borderRadius: '3cqw', overflow: 'hidden' }}>
      <div style={{ flex: 1, minHeight: 0, background: '#F7F3EC', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {item.imageSrc ? (
          <img src={item.imageSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        ) : (
          // 代替カード：画像を取得できなかった商品は、カテゴリのアイコンだけ（架空の画像は描かない）
          <div data-panel-fallback style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1cqw', color: MUTED }}>
            <span style={{ fontSize: big ? '16cqw' : '9cqw', lineHeight: 1 }}>{icon}</span>
            <span style={{ fontSize: big ? '3.6cqw' : '2.8cqw', fontWeight: 700 }}>{item.section}</span>
          </div>
        )}
      </div>
      <div style={{ padding: big ? '2cqw 2.6cqw 2.4cqw' : '1.4cqw 1.8cqw 1.8cqw', borderTop: `0.4cqw solid ${LINE}`, flexShrink: 0 }}>
        <span style={{ display: 'inline-block', background: accent, color: INK, fontSize: big ? '3cqw' : '2.4cqw', fontWeight: 800, borderRadius: 999, padding: '0.2cqw 1.8cqw', marginBottom: '0.8cqw' }}>{icon} {item.section}</span>
        <p style={{ margin: 0, color: INK, fontWeight: 700, fontSize: big ? '3.8cqw' : '2.9cqw', lineHeight: 1.35, ...clamp(2) }}>{item.title}</p>
      </div>
    </div>
  );
}

function ProductsPanel({ panel, shape, accent }: { panel: Extract<StoryPanel, { kind: 'products' }>; shape: PanelShape; accent: string }) {
  const [first, ...rest] = panel.items;
  return (
    <>
      <Header text={panel.title} accent={accent} />
      {shape === 'portrait' && rest.length > 0 ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '2.4cqw' }}>
          <div style={{ flex: 1.35, minHeight: 0, display: 'flex' }}><ProductCard item={first} big accent={accent} /></div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '2.4cqw' }}>
            {rest.map((it, i) => <ProductCard key={i} item={it} big={false} accent={accent} />)}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '2.4cqw' }}>
          {panel.items.map((it, i) => <ProductCard key={i} item={it} big={panel.items.length === 1} accent={accent} />)}
        </div>
      )}
    </>
  );
}

function ServiceCard({ item, accent, compact }: { item: ServicePanelItem; accent: string; compact: boolean }) {
  return (
    <div data-panel-item style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '1.6cqw', background: '#FFFFFF', border: `0.4cqw solid ${LINE}`, borderRadius: '3cqw', padding: compact ? '2.4cqw' : '3.2cqw', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '2cqw', flexShrink: 0 }}>
        <span style={{ flexShrink: 0, width: '9cqw', height: '9cqw', borderRadius: '50%', background: accent, color: INK, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '4.6cqw' }}>{item.mark}</span>
        <span style={{ color: INK, fontWeight: 900, fontSize: compact ? '4.4cqw' : '5.2cqw', lineHeight: 1.25, ...clamp(1) }}>{item.name}</span>
      </div>
      <p style={{ margin: 0, color: INK, fontWeight: 700, fontSize: compact ? '3cqw' : '3.5cqw', lineHeight: 1.45, ...clamp(compact ? 4 : 3) }}>{item.catchCopy}</p>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '0.8cqw', borderTop: `0.4cqw solid ${LINE}`, paddingTop: '1.4cqw' }}>
        <p style={{ margin: 0, color: MUTED, fontWeight: 700, fontSize: compact ? '2.6cqw' : '3cqw', lineHeight: 1.4, ...clamp(compact ? 3 : 2) }}>作れるもの：{item.items}</p>
        {item.minQty && <p style={{ margin: 0, color: MUTED, fontWeight: 700, fontSize: compact ? '2.6cqw' : '3cqw', lineHeight: 1.4 }}>最小注文：{item.minQty}</p>}
      </div>
    </div>
  );
}

function ServicesPanel({ panel, shape, accent }: { panel: Extract<StoryPanel, { kind: 'services' }>; shape: PanelShape; accent: string }) {
  const wide = shape === 'wide' && panel.items.length > 1;
  return (
    <>
      <Header text={panel.title} accent={accent} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: wide ? 'row' : 'column', gap: '2.4cqw' }}>
        {panel.items.map((it, i) => <ServiceCard key={i} item={it} accent={accent} compact={wide} />)}
      </div>
    </>
  );
}

export function StoryPanelView({ panel, shape, accent, radius }: { panel: StoryPanel; shape: PanelShape; accent: string; radius: number }) {
  // 外側が大きさの基準（containerType）。cqw は内側の要素から外側の幅を参照する
  return (
    <div data-panel={panel.kind} style={{ width: '100%', height: '100%', containerType: 'size', borderRadius: radius, background: '#FFFBF2', overflow: 'hidden' }}>
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: '2.4cqw', padding: '3cqw', boxSizing: 'border-box', textAlign: 'left' }}>
        {panel.kind === 'products'
          ? <ProductsPanel panel={panel} shape={shape} accent={accent} />
          : <ServicesPanel panel={panel} shape={shape} accent={accent} />}
      </div>
    </div>
  );
}
