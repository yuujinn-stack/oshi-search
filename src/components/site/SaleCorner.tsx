'use client';

// トップページの「期間限定 楽天セール特設コーナー」（設定: src/lib/sale-corner/config.ts、判定: src/lib/sale-corner/core.ts）。
// - 最初の描画はサーバーで決めた状態（initialPhase）のまま出し、ハイドレーション後に端末の時刻で確認し直す
//   （トップはキャッシュ〔revalidate〕されるため、キャッシュ中に開始・終了を迎えても正しい表示にする）。
//   開始・終了の時刻ちょうど、1分ごと、タブに戻ったときにも確認する。終了後は何も描画しない
// - 楽天の商品リンクは置かない（導線は推しサーチ内のページと楽天公式のセール会場だけ）。楽天の画像・ロゴも使わない
// - 計測: 表示（半分以上が画面に入ったとき1回）＝sale_corner_view、推しサーチ内の導線＝sale_corner_click、
//   楽天公式のセール会場＝既存の rakuten_campaign_click。1回のクリックで1イベントだけ送る
// - 既存ページのセクション番号CSS（home-graphic.css の section:nth-of-type 等）に影響しないよう <aside> で描画する
// - アニメーション・ポップアップなし
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { sendGaEvent } from '@/lib/ga-event';
import { sendGaEventWhenReady } from '@/lib/ga-ready';
import {
  nextSaleBoundary, saleCornerCtaClickEvent, saleCornerOfficialClickEvent, saleCornerViewEvent, salePeriodLabel,
  salePhaseAt, upcomingLabel, type SaleCorner as SaleCornerData, type SaleCornerLink, type SalePhase,
} from '@/lib/sale-corner/core';

/** setTimeout の上限（約24.8日）を超えないようにする */
const MAX_TIMEOUT_MS = 2_000_000_000;

const INK = '#0A0A0A';
const ORANGE = '#FF5A00';

function isMiddleClick(e: MouseEvent) {
  return e.button === 1;
}

export default function SaleCorner({ corner, links, initialPhase, className, style }: {
  corner: SaleCornerData;
  links: SaleCornerLink[];
  initialPhase: SalePhase | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [phase, setPhase] = useState<SalePhase | null>(initialPhase);
  const rootRef = useRef<HTMLElement | null>(null);
  const viewSent = useRef(false);

  // 端末の時刻で状態を確認し直す（開始・終了の時刻ちょうど＋1分ごと＋タブに戻ったとき）
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      const now = Date.now();
      setPhase(salePhaseAt(corner, now));
      if (timer) clearTimeout(timer);
      const next = nextSaleBoundary(corner, now);
      if (next !== null) timer = setTimeout(check, Math.min(next - now + 50, MAX_TIMEOUT_MS));
    };
    check();
    const interval = setInterval(check, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [corner]);

  // 表示数: 半分以上が画面に入ったときにページ表示ごと1回
  useEffect(() => {
    const el = rootRef.current;
    if (!phase || !el || viewSent.current || typeof IntersectionObserver === 'undefined') return;
    let cancel: (() => void) | null = null;
    const io = new IntersectionObserver((entries) => {
      if (viewSent.current || !entries.some((e) => e.isIntersecting)) return;
      viewSent.current = true;
      io.disconnect();
      cancel = sendGaEventWhenReady(...saleCornerViewEvent(corner, phase));
    }, { threshold: 0.5 });
    io.observe(el);
    return () => { io.disconnect(); cancel?.(); };
  }, [phase, corner]);

  if (!phase) return null;

  const trackCta = (link: SaleCornerLink, position: number) => sendGaEvent(...saleCornerCtaClickEvent(corner, phase, link, position));
  const trackOfficial = () => sendGaEvent(...saleCornerOfficialClickEvent(corner, phase));

  const shopping = links.find((l) => l.kind === 'oshi_shopping');
  const groupRows = new Map<string, { group?: SaleCornerLink; live?: SaleCornerLink }>();
  for (const l of links) {
    if (!l.groupName) continue;
    const row = groupRows.get(l.groupName) ?? {};
    if (l.kind === 'group_page') row.group = l;
    if (l.kind === 'live_archive') row.live = l;
    groupRows.set(l.groupName, row);
  }
  const positionOf = (l: SaleCornerLink) => links.indexOf(l) + 1;

  const pill: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '6px 12px',
    background: 'transparent', color: '#FFFFFF', border: '1.5px solid rgba(255,255,255,0.55)',
    fontSize: 13, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap',
  };

  return (
    <aside
      ref={rootRef}
      aria-labelledby={`sale-corner-${corner.id}`}
      className={className}
      style={{
        background: INK, color: '#FFFFFF', border: `2px solid ${INK}`, boxShadow: `4px 4px 0 ${ORANGE}`,
        padding: '16px', ...style,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: '#FFB27F' }}>期間限定</span>
        <span
          style={{
            display: 'inline-block', padding: '2px 8px', fontSize: 12, fontWeight: 800, lineHeight: 1.5,
            background: phase === 'active' ? ORANGE : '#FFFFFF', color: INK,
          }}
        >
          {phase === 'active' ? corner.activeLabel : upcomingLabel(corner)}
        </span>
      </div>
      <h2 id={`sale-corner-${corner.id}`} style={{ marginTop: 8, fontSize: 19, fontWeight: 900, lineHeight: 1.35, color: '#FFFFFF' }}>
        {corner.title}
      </h2>
      <p style={{ marginTop: 4, fontSize: 14, fontWeight: 700, lineHeight: 1.55, color: '#FFFFFF' }}>{corner.lead}</p>
      <p style={{ marginTop: 2, fontSize: 12.5, lineHeight: 1.6, color: 'rgba(255,255,255,0.75)' }}>
        <span style={{ fontWeight: 700, color: '#FFFFFF' }}>{salePeriodLabel(corner)}</span>（日本時間）
      </p>

      {shopping && (
        <Link
          href={shopping.href}
          onClick={() => trackCta(shopping, positionOf(shopping))}
          onAuxClick={(e) => { if (isMiddleClick(e)) trackCta(shopping, positionOf(shopping)); }}
          style={{
            marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            minHeight: 48, padding: '10px 14px', background: '#FFFFFF', color: INK, border: `2px solid #FFFFFF`,
            fontSize: 14.5, fontWeight: 900, textDecoration: 'none',
          }}
        >
          <span>{shopping.label}で探す</span>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      {groupRows.size > 0 && (
        <>
          <p style={{ marginTop: 14, fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.75)' }}>グループから探す</p>
          <ul style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 8, listStyle: 'none', padding: 0 }}>
            {[...groupRows.entries()].map(([name, row]) => (
              <li key={name} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {row.group && (
                  <Link
                    href={row.group.href}
                    onClick={() => trackCta(row.group!, positionOf(row.group!))}
                    onAuxClick={(e) => { if (isMiddleClick(e)) trackCta(row.group!, positionOf(row.group!)); }}
                    style={{ ...pill, flex: '1 1 140px', justifyContent: 'space-between', background: '#FFFFFF', color: INK, borderColor: '#FFFFFF' }}
                  >
                    <span>{row.group.label}</span>
                    <span aria-hidden="true" style={{ marginLeft: 8 }}>›</span>
                  </Link>
                )}
                {row.live && (
                  <Link
                    href={row.live.href}
                    aria-label={`${name}の過去のライブ映像`}
                    onClick={() => trackCta(row.live!, positionOf(row.live!))}
                    onAuxClick={(e) => { if (isMiddleClick(e)) trackCta(row.live!, positionOf(row.live!)); }}
                    style={{ ...pill, flex: '0 0 auto' }}
                  >
                    {row.live.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <a
        href={corner.officialUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={trackOfficial}
        onAuxClick={(e) => { if (isMiddleClick(e)) trackOfficial(); }}
        style={{
          marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          minHeight: 44, padding: '8px 12px', border: '1.5px dashed rgba(255,255,255,0.55)', color: '#FFFFFF', textDecoration: 'none',
        }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 800 }}>楽天市場の公式セール会場へ</span>
          <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.7)', wordBreak: 'break-all' }}>
            楽天のページ（event.rakuten.co.jp）が新しいタブで開きます
          </span>
        </span>
        <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 13, fontWeight: 800 }}>↗</span>
      </a>

      <p style={{ marginTop: 10, fontSize: 11, lineHeight: 1.7, color: 'rgba(255,255,255,0.7)' }}>
        {corner.conditionsNote}
        詳しくは楽天の公式ページでご確認ください。推しサーチに掲載している商品がセールの対象かどうか、価格・在庫・特典は確認していません。
      </p>
    </aside>
  );
}
