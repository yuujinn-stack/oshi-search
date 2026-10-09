// 診断結果の配信サービスCTA。
// - 既存のアフィリエイト管理（AffiliateSlot）を slotKey="oshi_vod_result" でそのまま利用する。
//   作品ページ（work_provider）と掲載位置を分けることで、診断経由のクリックをASP側で区別できる。
// - 広告がある場合のみ AffiliateSlot が「PR」表記を付ける。広告が無いサービスは公式サイトへの
//   VodTrackLink（既存の /api/track 計測）をサービス別配色（getVodServiceStyle）で表示する。
// - このCTAはランキング・組み合わせ・詳細比較の「表示ルール」に従って全サービスへ同じ形で
//   付ける。提携の有無で順位・位置・強調を変えることはない（リンク先が変わるだけ）。
// - 外側の data-ov-cta 要素で OshiVodTracker がクリックを検知し GA4 の diagnosis_cta_click を送る。
import AffiliateSlot from '@/components/site/AffiliateSlot';
import VodTrackLink from '@/components/site/VodTrackLink';
import ProviderLogo from '@/components/ProviderLogo';
import { getVodServiceStyle, VOD_OFFICIAL_URLS } from '@/lib/vod-cta';
import { getVodPlanInfo } from '@/lib/vod-plan-info';

export type OshiVodCtaPlacement = 'hero' | 'ranking_count' | 'ranking_price' | 'ranking_cost' | 'pair' | 'over80' | 'detail';

interface Props {
  service: string;
  displayName: string;
  logoPath?: string;
  placement: OshiVodCtaPlacement;
  rank?: number;
  size?: 'md' | 'sm';
  /**
   * brand: サービス別配色の目立つボタン（結論カード・組み合わせ用）
   * compact: 中立色の小さなリンク（詳しい比較用。全サービス分並ぶため広告的に見えないようにする）
   */
  variant?: 'brand' | 'compact';
}

export default function OshiVodServiceCta({ service, displayName, logoPath, placement, rank, size = 'sm', variant = 'brand' }: Props) {
  const href = getVodPlanInfo(service)?.officialUrl ?? VOD_OFFICIAL_URLS[service];
  const style = getVodServiceStyle(service);
  const youtubeAccent = service === 'youtube' ? 'vod-cta-btn--youtube' : '';
  const sizeCls = size === 'md' ? 'text-sm px-4 py-3' : 'text-xs px-3 py-2';
  return (
    <div className="ov-cta" data-ov-cta="" data-vod-service={service} data-ov-placement={placement} data-ov-rank={rank ?? ''}>
      <AffiliateSlot
        vodService={service}
        slotKey="oshi_vod_result"
        fallback={
          href && variant === 'compact' ? (
            <VodTrackLink href={href} service={service} className="ov-cta-compact">
              <ProviderLogo providerName={service} logoPath={logoPath} size="xs" />
              <span className="truncate">{displayName}の公式サイト</span>
              <span aria-hidden="true">→</span>
            </VodTrackLink>
          ) : href ? (
            <VodTrackLink
              href={href}
              service={service}
              className={`vod-cta-btn ${youtubeAccent} gap-2 w-full rounded-lg font-bold ${sizeCls}`}
              style={{ background: style.background, color: style.color, border: style.border }}
            >
              <ProviderLogo providerName={service} logoPath={logoPath} size="xs" />
              <span className="truncate">{displayName}の公式サイトを見る</span>
              <span aria-hidden="true">→</span>
            </VodTrackLink>
          ) : null
        }
      />
    </div>
  );
}
