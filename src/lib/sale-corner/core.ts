// 期間限定 楽天セール特設コーナーの判定・表示文言・GA4 イベント（純粋関数。DB・React 非依存）。
// サーバー（トップページの描画）とクライアント（開いたままのページでの切り替え）の両方で同じ関数を使う。
// 日本時間の計算は +9時間の固定オフセットで行い、実行環境のタイムゾーンに依存しない（ハイドレーションの不一致を防ぐ）。
import { isOfficialRakutenUrl } from '@/lib/rakuten-event/core';
import type { SaleCornerConfig } from './config';

export type SalePhase = 'upcoming' | 'active';

/** クライアントに渡す形（日時はミリ秒） */
export interface SaleCorner {
  id: string;
  title: string;
  activeLabel: string;
  lead: string;
  startsAt: number;
  endsAt: number;
  announceFrom: number | null;
  officialUrl: string;
  conditionsNote: string;
}

export type SaleCtaKind = 'oshi_shopping' | 'group_page' | 'live_archive';

export interface SaleCornerLink {
  kind: SaleCtaKind;
  href: string;
  label: string;
  groupName?: string;
}

export interface SaleCornerGroupLinks {
  groupName: string;
  groupHref: string;
  /** 過去のライブ映像特集の対象グループだけ */
  liveHref: string | null;
}

/** 設定を検証して表示用に変換する。不正な設定（日時・公式URL）は null（表示しない） */
export function toSaleCorner(c: SaleCornerConfig): SaleCorner | null {
  const startsAt = Date.parse(c.startsAt);
  const endsAt = Date.parse(c.endsAt);
  const announceFrom = c.announceFrom ? Date.parse(c.announceFrom) : null;
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return null;
  if (announceFrom !== null && (!Number.isFinite(announceFrom) || announceFrom > startsAt)) return null;
  if (!isOfficialRakutenUrl(c.officialUrl)) return null;
  return {
    id: c.id,
    title: c.title,
    activeLabel: c.activeLabel,
    lead: c.lead,
    startsAt,
    endsAt,
    announceFrom,
    officialUrl: c.officialUrl,
    conditionsNote: c.conditionsNote,
  };
}

/** 表示時点の状態。告知前・終了後（終了日時ちょうど以降）は null＝表示しない */
export function salePhaseAt(c: Pick<SaleCorner, 'startsAt' | 'endsAt' | 'announceFrom'>, nowMs: number): SalePhase | null {
  if (nowMs >= c.endsAt) return null;
  if (nowMs >= c.startsAt) return 'active';
  if (c.announceFrom !== null && nowMs < c.announceFrom) return null;
  return 'upcoming';
}

/** 次に状態が変わる時刻（告知開始・開始・終了）。無ければ null */
export function nextSaleBoundary(c: Pick<SaleCorner, 'startsAt' | 'endsAt' | 'announceFrom'>, nowMs: number): number | null {
  const times = [c.announceFrom, c.startsAt, c.endsAt].filter((t): t is number => t !== null && t > nowMs);
  return times.length ? Math.min(...times) : null;
}

/**
 * ページに載せるコーナーを1件選ぶ（未終了のものだけ。開催中 → 開始の早い順）。
 * 告知前のものも選ぶ（ページのキャッシュ中に告知開始を迎えたら、クライアントで表示に切り替えるため）。
 */
export function pickSaleCorner(configs: SaleCornerConfig[], nowMs: number): SaleCorner | null {
  const list = configs
    .map(toSaleCorner)
    .filter((c): c is SaleCorner => c !== null && nowMs < c.endsAt)
    .sort((a, b) => {
      const aa = salePhaseAt(a, nowMs) === 'active' ? 0 : 1;
      const bb = salePhaseAt(b, nowMs) === 'active' ? 0 : 1;
      return aa - bb || a.startsAt - b.startsAt;
    });
  return list[0] ?? null;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function jstParts(ms: number) {
  const d = new Date(ms + JST_OFFSET_MS);
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** 開始前のバッジ。例: 11月19日20時スタート（分があれば 20時30分） */
export function upcomingLabel(c: Pick<SaleCorner, 'startsAt'>): string {
  const p = jstParts(c.startsAt);
  return `${p.month}月${p.day}日${p.hour}時${p.minute ? `${p.minute}分` : ''}スタート`;
}

function shortTime(ms: number): string {
  const p = jstParts(ms);
  return `${p.month}/${p.day} ${p.hour}:${String(p.minute).padStart(2, '0')}`;
}

/** 期間。例: 11/19 20:00〜11/25 1:59 */
export function salePeriodLabel(c: Pick<SaleCorner, 'startsAt' | 'endsAt'>): string {
  return `${shortTime(c.startsAt)}〜${shortTime(c.endsAt)}`;
}

/** 表示する導線（お買い物診断 → グループごとにグループページ・ライブ映像）。GA4 の position はこの順 */
export function saleCornerLinks(groups: SaleCornerGroupLinks[]): SaleCornerLink[] {
  const out: SaleCornerLink[] = [{ kind: 'oshi_shopping', href: '/oshi-shopping', label: '推し活お買い物診断' }];
  for (const g of groups) {
    out.push({ kind: 'group_page', href: g.groupHref, label: g.groupName, groupName: g.groupName });
    if (g.liveHref) out.push({ kind: 'live_archive', href: g.liveHref, label: 'ライブ映像', groupName: g.groupName });
  }
  return out;
}

// ── GA4 ──────────────────────────────────────────────────────────────────────
// 送信は既存の sendGaEvent / sendGaEventWhenReady（本番ホストで gtag があるときだけ）。
// コーナー内に楽天の商品リンクは置かないため affiliate_click とは重ならない。
// 楽天公式のセール会場へのクリックは、既存の「楽天の公式キャンペーンページへのクリック」と同じ rakuten_campaign_click で送る
// （1回のクリックで送るイベントは1つだけ）。

export const SALE_CORNER_PLACEMENT = 'home_sale_corner';

export const SALE_CORNER_GA_EVENTS = {
  view: 'sale_corner_view',
  ctaClick: 'sale_corner_click',
  officialClick: 'rakuten_campaign_click',
} as const;

type Params = Record<string, string | number>;
export type GaEvent = [name: string, params: Params];

export function saleCornerViewEvent(c: Pick<SaleCorner, 'id'>, phase: SalePhase): GaEvent {
  return [SALE_CORNER_GA_EVENTS.view, { sale_id: c.id, sale_phase: phase, placement: SALE_CORNER_PLACEMENT }];
}

export function saleCornerCtaClickEvent(c: Pick<SaleCorner, 'id'>, phase: SalePhase, link: SaleCornerLink, position: number): GaEvent {
  return [SALE_CORNER_GA_EVENTS.ctaClick, {
    sale_id: c.id,
    sale_phase: phase,
    cta: link.kind,
    link_url: link.href,
    position,
    placement: SALE_CORNER_PLACEMENT,
    ...(link.groupName ? { group_name: link.groupName } : {}),
  }];
}

export function saleCornerOfficialClickEvent(c: Pick<SaleCorner, 'id'>, phase: SalePhase): GaEvent {
  return [SALE_CORNER_GA_EVENTS.officialClick, {
    // 既存の rakuten_campaign_click と同じ項目名（campaign_id は GA4 の予約パラメータのため使わない）。
    // 管理画面のイベントではないため rakuten_event_id は無く、sale_id で区別する
    sale_id: c.id,
    campaign_status: phase,
    campaign_kind: 'market_kaimawari',
    link_type: 'official',
    placement: SALE_CORNER_PLACEMENT,
  }];
}
