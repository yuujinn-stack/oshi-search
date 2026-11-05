// 過去のライブ映像特集・楽天キャンペーン枠の GA4 イベント（イベント名とパラメータを作る純粋関数）。
// 送信は既存の sendGaEvent（src/lib/ga-event.ts。本番ホスト oshi-search.jp で gtag があるときだけ）を使う。
// パラメータは公開情報（グループ・公演・商品ID・配置・操作内容）だけで、個人情報・入力内容は含めない。
import type { LiveArchiveEntry, LiveArchiveItem, LiveFormatFilter, LiveSort } from './core';
import type { CampaignStatus, PublicCampaign } from '@/lib/rakuten-campaign/core';

export const LIVE_ARCHIVE_GA_EVENTS = {
  view: 'live_archive_view',
  productClick: 'live_archive_product_click',
  filter: 'live_archive_filter',
  campaignClick: 'rakuten_campaign_click',
} as const;

type Params = Record<string, string | number>;
export type GaEvent = [name: string, params: Params];

export function liveArchiveViewEvent(groupId: string, groupName: string, placement: string, performanceCount: number): GaEvent {
  return [LIVE_ARCHIVE_GA_EVENTS.view, { group_id: groupId, group_name: groupName, placement, performance_count: performanceCount }];
}

export function liveArchiveFilterEvent(groupId: string, placement: string, filter: { sort: LiveSort } | { format: LiveFormatFilter }): GaEvent {
  return [LIVE_ARCHIVE_GA_EVENTS.filter, 'sort' in filter
    ? { group_id: groupId, placement, filter_type: 'sort', filter_value: filter.sort }
    : { group_id: groupId, placement, filter_type: 'format', filter_value: filter.format }];
}

export function liveArchiveProductClickEvent(
  groupId: string,
  placement: string,
  entry: Pick<LiveArchiveEntry, 'id' | 'releaseYear'>,
  item: Pick<LiveArchiveItem, 'productId' | 'format' | 'edition'>,
  position: number,
  state: { sort: LiveSort; format: LiveFormatFilter },
): GaEvent {
  return [LIVE_ARCHIVE_GA_EVENTS.productClick, {
    group_id: groupId,
    product_id: item.productId,
    performance_id: entry.id,
    format: item.format,
    edition: item.edition,
    release_year: entry.releaseYear,
    placement,
    position,
    sort_order: state.sort,
    filter_format: state.format,
  }];
}

export function rakutenCampaignClickEvent(c: Pick<PublicCampaign, 'id' | 'isEntry'>, status: CampaignStatus, placement: string, groupId?: string): GaEvent {
  return [LIVE_ARCHIVE_GA_EVENTS.campaignClick, {
    campaign_id: c.id,
    campaign_status: status,
    link_type: c.isEntry ? 'entry' : 'official',
    placement,
    ...(groupId ? { group_id: groupId } : {}),
  }];
}
