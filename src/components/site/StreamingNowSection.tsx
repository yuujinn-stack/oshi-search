// 人物ページ「今すぐ見られる作品」セクション（推しサーチの中核導線）。
//
// 「この人物の出演作品を探す → 現在どこで配信されているか分かる →
//  実際にそのVODへ移動できる」という一連の流れを、人物ページの最上部で
//  完結させることが目的。既存の配信データ取得ロジック（isConfirmedVodAvailability・
//  deduplicateProviders）・アフィリエイト管理（AffiliateSlot）・確認日表示
//  （work.vodUpdatedAt）はそのまま再利用し、新しい判定・推測は一切行わない。
import Link from 'next/link';
import type { WorkRecord } from '@/types/work';
import { deduplicateProviders, isConfirmedVodAvailability, getVodProviderDisplayInfo, normalizeProviderName } from '@/lib/vod-dedup';
import { getWorkPublicUrl } from '@/lib/work-url';
import { getWorkDisplayImage, getRenderableWorkImageUrl } from '@/lib/work-image';
import { VOD_TYPE_CONFIG, getVodLink } from '@/lib/vod-cta';
import AffiliateSlot from '@/components/site/AffiliateSlot';
import VodTrackLink from '@/components/site/VodTrackLink';

const STREAMING_TYPES = ['flatrate', 'free', 'ads'];
const MAX_WORKS = 6;
const MAX_PROVIDERS_PER_WORK = 3;

function getStreamingProviders(work: WorkRecord, terminatedSlugs: Set<string>) {
  return deduplicateProviders(
    (work.vodProviders ?? []).filter((p) => isConfirmedVodAvailability(p, terminatedSlugs)),
  ).filter((p) => STREAMING_TYPES.includes(p.type));
}

function formatCheckedDate(vodUpdatedAt?: number): string | null {
  if (!vodUpdatedAt) return null;
  return new Date(vodUpdatedAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
}

interface Props {
  works: WorkRecord[];
  terminatedSlugs: Set<string>;
}

export default function StreamingNowSection({ works, terminatedSlugs }: Props) {
  // publishedWorksはreleaseYear降順のため、先頭N件は自然と「新しい作品優先」になる
  // （架空の人気順・おすすめ判定は行わない。既存の並び順をそのまま利用するだけ）
  const targets = works.slice(0, MAX_WORKS);
  if (targets.length === 0) return null;

  return (
    <section id="streaming-now" aria-labelledby="streaming-now-heading">
      <div className="flex items-center gap-2 mb-4">
        <h2 id="streaming-now-heading" className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>
          ▶ 今すぐ見られる作品
        </h2>
        <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
          🟢 {works.length}件
        </span>
      </div>

      <div className="space-y-3">
        {targets.map((work) => {
          const providers = getStreamingProviders(work, terminatedSlugs).slice(0, MAX_PROVIDERS_PER_WORK);
          if (providers.length === 0) return null;
          const posterUrl = getRenderableWorkImageUrl(getWorkDisplayImage(work));
          const workDetailUrl = getWorkPublicUrl({ workId: work.id, personName: work.personName }) ?? '#';
          const checkedDate = formatCheckedDate(work.vodUpdatedAt);

          return (
            <div key={work.id} className="theme-card overflow-hidden p-3 flex gap-3">
              {/* ポスター */}
              <Link href={workDetailUrl} className="flex-shrink-0">
                {posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={posterUrl}
                    alt={work.title}
                    className="w-16 h-24 object-cover rounded-lg"
                    loading="lazy"
                  />
                ) : (
                  <div
                    className="w-16 h-24 rounded-lg flex items-center justify-center text-2xl"
                    style={{ background: 'var(--ds-primary-soft)' }}
                  >
                    🎬
                  </div>
                )}
              </Link>

              {/* 作品情報・CTA */}
              <div className="min-w-0 flex-1">
                <Link href={workDetailUrl} className="block">
                  <p className="text-sm font-bold line-clamp-2 leading-snug" style={{ color: 'var(--ds-text)' }}>
                    {work.title}
                  </p>
                </Link>
                {work.releaseYear && (
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--ds-muted)' }}>{work.releaseYear}年</p>
                )}

                {/* 配信サービスごとのCTA */}
                <div className="mt-2 space-y-1.5">
                  {providers.map((p, i) => {
                    const cfg = VOD_TYPE_CONFIG[p.type] ?? VOD_TYPE_CONFIG.unknown;
                    const info = getVodProviderDisplayInfo(p.providerName);
                    const link = getVodLink(p);
                    const ctaText = `${info.displayName}で${cfg.btnLabel}`;
                    return (
                      <div key={`${p.providerId}-${p.type}-${i}`} className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${cfg.labelColor} ${cfg.bg}`}>
                          {cfg.icon} {cfg.label}
                        </span>
                        <AffiliateSlot
                          vodService={normalizeProviderName(p.providerName)}
                          slotKey="work_provider"
                          className="flex-1 min-w-0"
                          fallback={
                            link ? (
                              <VodTrackLink
                                href={link}
                                service={p.providerName}
                                className={`flex items-center justify-center gap-1 w-full text-xs font-bold text-white py-1.5 px-2 rounded-lg transition-colors ${cfg.btn}`}
                              >
                                {ctaText}
                              </VodTrackLink>
                            ) : (
                              <span className="text-[11px]" style={{ color: 'var(--ds-muted)' }}>
                                {info.displayName}で視聴可能
                              </span>
                            )
                          }
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between gap-2 mt-2">
                  {checkedDate && (
                    <p className="text-[10px]" style={{ color: 'var(--ds-muted)' }}>確認日: {checkedDate}</p>
                  )}
                  {/* 作品詳細（内部操作＝outline/secondary。VOD CTAとは視覚的に区別する） */}
                  <Link
                    href={workDetailUrl}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-lg flex-shrink-0 transition-colors"
                    style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
                  >
                    作品詳細を見る
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
