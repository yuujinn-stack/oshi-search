// 人物ページの「〇〇の過去ライブ映像を発掘」コーナー（所属グループのライブ映像を3公演まで紹介）。
// - データは過去のライブ映像ライブラリー（src/lib/live-archive。公式サイトで確認した公演・既存の楽天商品データ）をそのまま使う
// - 1公演1枠（同じ公演の DVD／Blu-ray で枠を埋めない）。形式ごとに1つのリンク（通常盤を優先）
// - グループの公演であり、本人の出演を示すものではない（出演メンバー・価格・特典は表示しない）
// - 楽天リンクのクリックは既存の TrackedRakutenLink（/api/track・GA4 affiliate_click）だけで計測する（新しいイベントは送らない）
// 楽天のイベント情報（開催中のキャンペーン）があれば、商品カードの下に小さな案内を出す（商品リンクとは別の公式ページへのリンク）。
// 人物ページのデザインCSS（person-graphic.css）で section#live-archive に番号つきの「LIVE ARCHIVE」ラベルが付く。
import Link from 'next/link';
import TrackedRakutenLink from '@/components/site/TrackedRakutenLink';
import RakutenCampaignBox from '@/components/live-archive/RakutenCampaignBox';
import type { PublicCampaign } from '@/lib/rakuten-campaign/core';
import { formatLinksOf, itemLabel, type LiveArchiveEntry } from '@/lib/live-archive/core';

export const PERSON_LIVE_ARCHIVE_PLACEMENT = 'person_live_archive';

/** GA4 のグループID（一覧ページと同じく公開URLのグループのスラッグ。/groups/<slug>/live から取り出す） */
function groupIdOf(listHref: string): string {
  const m = /^\/groups\/([^/]+)\/live$/.exec(listHref);
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

export default function PersonLiveArchiveSection({ id, groupName, entries, listHref, campaigns = [] }: {
  /** セクションの id（1つ目は "live-archive"） */
  id: string;
  groupName: string;
  /** 表示する公演（pickSpreadPerformances で選んだもの） */
  entries: LiveArchiveEntry[];
  /** /groups/<slug>/live */
  listHref: string;
  /** 楽天のイベント情報（loadLiveArchiveCampaigns。空なら案内を出さず通常のコーナーだけ） */
  campaigns?: PublicCampaign[];
}) {
  if (entries.length === 0) return null;
  const headingId = `${id}-heading`;
  let position = 0;
  return (
    <section id={id} aria-labelledby={headingId}>
      <h2 id={headingId} className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>
        {groupName}の過去ライブ映像を発掘
      </h2>
      <p className="text-sm mt-1 mb-4" style={{ color: 'var(--ds-muted)' }}>
        好きになる前のライブもチェック！過去のDVD・Blu-rayを探してみよう。
      </p>

      <div className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 gap-3">
        {entries.map((entry) => {
          const links = formatLinksOf(entry);
          return (
            <div
              key={entry.id}
              className="group flex flex-col overflow-hidden"
              style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius)' }}
            >
              <div className="flex items-center justify-center p-2" style={{ background: '#FFFFFF' }}>
                {entry.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={entry.imageUrl}
                    alt={entry.title}
                    className="w-full object-contain"
                    style={{ aspectRatio: '1 / 1', maxHeight: 220 }}
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full flex items-center justify-center text-3xl" style={{ aspectRatio: '1 / 1', maxHeight: 220, color: '#d1d5db' }} aria-hidden="true">
                    📀
                  </div>
                )}
              </div>
              <div className="p-3 flex flex-col gap-2 flex-1">
                <div>
                  <p className="text-[11px] font-bold" style={{ color: 'var(--ds-muted)' }}>{entry.releaseYear}年発売</p>
                  <h3 className="text-sm font-bold leading-snug mt-0.5 break-words" style={{ color: 'var(--ds-text)' }}>{entry.title}</h3>
                </div>
                <div className="mt-auto flex flex-col gap-1.5">
                  {links.map((item) => {
                    position += 1;
                    return (
                      <TrackedRakutenLink
                        key={item.productId}
                        track={{
                          productId: item.productId,
                          personSlug: '',
                          title: `${entry.title} ${itemLabel(item)}`,
                          category: 'Blu-ray・DVD',
                          imageUrl: item.imageUrl,
                          affiliateUrl: item.href,
                          pageType: 'person',
                          placement: PERSON_LIVE_ARCHIVE_PLACEMENT,
                          position,
                          linkElement: 'cta',
                          // 本人の関連商品として判定した商品ではないため、人物ページ由来の商品メタデータは保存しない（クリック数のみ）
                          saveMeta: false,
                        }}
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer sponsored"
                        className="flex items-center justify-between gap-2 px-2.5 text-xs font-bold hover:opacity-80 transition-opacity"
                        style={{ minHeight: 44, border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius)', background: 'var(--ds-bg)', color: 'var(--ds-text)', textDecoration: 'none' }}
                      >
                        <span className="min-w-0">{itemLabel(item)}</span>
                        <span className="shrink-0 text-[11px]" style={{ color: 'var(--ds-cta)' }}>楽天で見る ›</span>
                      </TrackedRakutenLink>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {campaigns.length > 0 && (
        <RakutenCampaignBox
          campaigns={campaigns}
          placement={PERSON_LIVE_ARCHIVE_PLACEMENT}
          groupId={groupIdOf(listHref)}
          className="mt-3"
        />
      )}

      <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--ds-muted)' }}>
        {groupName}の公演の映像です（各公演の出演メンバーは公式情報でご確認ください）。価格・在庫・特典は楽天の商品ページでご確認ください。
      </p>
      <div className="mt-3 text-center">
        <Link
          href={listHref}
          className="inline-flex items-center justify-center px-5 text-sm font-bold"
          style={{ minHeight: 44, border: '1.5px solid #0A0A0A', background: '#FFFFFF', color: '#0A0A0A', textDecoration: 'none' }}
        >
          {groupName}のライブ映像をすべて見る →
        </Link>
      </div>
    </section>
  );
}
