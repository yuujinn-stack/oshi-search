// 公開ページの「楽天のキャンペーン」枠（ライブ映像特集など）に出すイベントを決める純粋関数（DB・React 非依存）。
//
// イベントは楽天イベント管理（/admin/rakuten-events・rakuten_events テーブル）で手動登録したものだけ。
// 公開ページに出す条件（すべて満たすもの）:
//   - 管理画面の「公開」（visibility='published'。SNS投稿とこの枠の両方に使ってよい状態。非公開＝下書きは出さない）
//   - 公式確認済み（公式URL＋最終確認日時。src/lib/rakuten-event/core.ts isOfficiallyConfirmed）
//   - リンク先（エントリーURL、無ければ公式URL）が楽天の公式ページ（https・rakuten.co.jp 等。アフィリエイトの計測リンクは不可）
//   - 開催中、または開始まで UPCOMING_WINDOW_MS 以内（開催前は「開催予定」と表示し、「開催中」とは書かない）
//   - 終了日時を過ぎたものは出さない（終了状態は保存せず、表示する時刻で判定する）
// ポイント倍率・特典・対象商品・最安値などは表示しない（イベント名・期間・公式ページへの案内だけ）。
import {
  EVENT_TYPE_LABEL, eventStatus, isOfficialRakutenUrl, isOfficiallyConfirmed, type RakutenEvent,
} from '@/lib/rakuten-event/core';

/** 開始前のイベントを「開催予定」として出す期間 */
export const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type CampaignStatus = 'active' | 'upcoming';

export interface PublicCampaign {
  id: number;
  name: string;
  typeLabel: string;
  status: CampaignStatus;
  startsAt: number;
  endsAt: number;
  /** 楽天公式のエントリーページ（無ければ公式ページ） */
  url: string;
  isEntry: boolean;
}

export type CampaignSource = Pick<RakutenEvent, 'id' | 'name' | 'eventType' | 'startsAt' | 'endsAt' | 'officialUrl' | 'entryUrl' | 'lastCheckedAt' | 'visibility'>;

export function publicCampaigns(events: CampaignSource[], nowMs: number): PublicCampaign[] {
  const out: PublicCampaign[] = [];
  for (const e of events) {
    if (e.visibility !== 'published') continue;
    if (!Number.isFinite(e.startsAt) || !Number.isFinite(e.endsAt) || e.endsAt <= e.startsAt) continue;
    if (!isOfficiallyConfirmed(e) || !isOfficialRakutenUrl(e.officialUrl)) continue;
    const st = eventStatus(e, nowMs);
    if (st === 'ended') continue;
    if (st === 'upcoming' && e.startsAt - nowMs > UPCOMING_WINDOW_MS) continue;
    const isEntry = isOfficialRakutenUrl(e.entryUrl);
    out.push({
      id: e.id,
      name: e.name,
      typeLabel: EVENT_TYPE_LABEL[e.eventType] ?? '',
      status: st,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      url: isEntry ? String(e.entryUrl) : String(e.officialUrl),
      isEntry,
    });
  }
  // 開催中を先に、その中は終了の早い順。開催予定は開始の早い順
  return out.sort((a, b) =>
    (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1)
    || (a.status === 'active' ? a.endsAt - b.endsAt : a.startsAt - b.startsAt)
    || a.id - b.id);
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 例: 11月4日(火)20:00（日本時間） */
export function formatCampaignTime(ms: number): string {
  const d = new Date(ms + JST_OFFSET_MS);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEKDAYS[d.getUTCDay()]})${hh}:${mm}`;
}

export function campaignPeriodLabel(c: Pick<PublicCampaign, 'startsAt' | 'endsAt'>): string {
  return `${formatCampaignTime(c.startsAt)}〜${formatCampaignTime(c.endsAt)}`;
}

/**
 * ページを再描画せずに開いたままでも、表示時点の状態に合わせる（クライアントで使う）。
 * 終了後は null（表示しない）。開始時刻を過ぎたら開催中。
 */
export function statusAt(c: Pick<PublicCampaign, 'startsAt' | 'endsAt'>, nowMs: number): CampaignStatus | null {
  if (nowMs >= c.endsAt) return null;
  return nowMs < c.startsAt ? 'upcoming' : 'active';
}
