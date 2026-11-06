// /groups/<slug>/live — 過去のライブ映像（ライブDVD・Blu-ray）発掘特集の一覧ページ。
// 対象グループ（src/lib/live-archive/catalog.ts LIVE_ARCHIVE_GROUPS）以外は 404。
// 商品は掲載リストに登録した楽天ブックスの商品番号だけ（既存の商品データ・アフィリエイトURL・画像・価格を使う）。
// 楽天のキャンペーン枠は表示時刻で開催状態を判定するため、動的に描画する（キャッシュした「開催中」を出し続けない）。
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import GraphicPageStyles from '@/components/site/GraphicPageStyles';
import PrNotice from '@/components/site/PrNotice';
import LiveArchiveBrowser from '@/components/live-archive/LiveArchiveBrowser';
import RakutenCampaignBox from '@/components/live-archive/RakutenCampaignBox';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllMembershipRecords } from '@/lib/group-membership-store';
import { groupMembershipRecords, personsInGroup } from '@/lib/group-membership';
import { getAllGroupMetas } from '@/lib/group-meta';
import { canonicalGroupSlug, resolveGroupFromSlug, resolveGroupName } from '@/lib/group-slug';
import { countItems, liveArchiveGroupOf } from '@/lib/live-archive/core';
import { loadLiveArchive, loadLiveArchiveCampaigns } from '@/lib/live-archive/data';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ groupSlug: string }>;
}

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';

async function resolve(groupSlug: string) {
  const metas = await getAllGroupMetas().catch(() => []);
  const meta = resolveGroupFromSlug(groupSlug, metas);
  const groupName = meta?.groupName ?? resolveGroupName(groupSlug, metas) ?? decodeURIComponent(groupSlug);
  const archiveGroup = liveArchiveGroupOf(groupName);
  // 公開URLのスラッグはグループページと同じ（canonical）。meta が無いときは受け取ったスラッグのまま
  const slug = meta ? canonicalGroupSlug(meta) : groupSlug;
  return { groupName, archiveGroup, slug };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { groupSlug } = await params;
  const { groupName, archiveGroup, slug } = await resolve(groupSlug);
  if (!archiveGroup) return {};
  const title = `${groupName}の過去のライブDVD・Blu-ray一覧｜ライブ映像を探す`;
  const description = `${groupName}の過去のライブ映像（ライブDVD・Blu-ray）を発売日順にまとめています。公演ごとにDVD／Blu-ray・初回盤／通常盤を整理し、楽天ブックスの商品ページへ案内します。`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    alternates: { canonical: `${SITE_ORIGIN}/groups/${slug}/live` },
  };
}

export default async function GroupLiveArchivePage({ params }: Props) {
  const { groupSlug } = await params;
  const { groupName, archiveGroup, slug } = await resolve(groupSlug);
  if (!archiveGroup) notFound();
  if (groupSlug !== slug) permanentRedirect(`/groups/${slug}/live`);

  const [persons, records] = await Promise.all([getAllPersonsMerged(), getAllMembershipRecords()]);
  // グループページと同じメンバー（現在・過去の所属を含む）の商品データから探す
  const memberNames = personsInGroup(groupName, persons, groupMembershipRecords(records)).map((p) => p.name);
  const now = Date.now();
  const [entries, campaigns] = await Promise.all([
    loadLiveArchive(groupName, memberNames, now).catch((err) => {
      const e = err as { name?: string; code?: string } | null;
      console.error('[live-archive] products unavailable:', e?.name ?? 'Error', e?.code ?? '');
      return null;
    }),
    loadLiveArchiveCampaigns(now),
  ]);

  const groupPath = `/groups/${slug}`;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: SITE_ORIGIN },
      { '@type': 'ListItem', position: 2, name: groupName, item: `${SITE_ORIGIN}${groupPath}` },
      { '@type': 'ListItem', position: 3, name: '過去のライブ映像', item: `${SITE_ORIGIN}${groupPath}/live` },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <div className="page-bg oshi-graphic-page" style={{ background: 'var(--ds-bg)', minHeight: '100vh' }}>
        <GraphicPageStyles />
        <PrNotice className="max-w-3xl mx-auto px-4 pt-3" />

        <nav aria-label="パンくずリスト" className="breadcrumb-bar">
          <div className="max-w-3xl mx-auto px-4 py-2.5 flex flex-wrap items-center gap-1.5 text-xs" style={{ color: 'var(--ds-muted)' }}>
            <Link href="/" className="theme-text-link">ホーム</Link>
            <span style={{ opacity: 0.4 }}>›</span>
            <Link href={groupPath} className="theme-text-link">{groupName}</Link>
            <span style={{ opacity: 0.4 }}>›</span>
            <span className="font-medium" style={{ color: 'var(--ds-text)' }}>過去のライブ映像</span>
          </div>
        </nav>

        <main className="max-w-3xl mx-auto px-4 pb-12">
          <header className="pt-4 pb-5">
            <p className="text-xs font-bold" style={{ color: 'var(--ds-muted)' }}>ライブ映像 発掘特集</p>
            <h1 className="text-2xl font-black mt-1 leading-tight" style={{ color: 'var(--ds-text)' }}>
              {groupName}の過去のライブDVD・Blu-ray
            </h1>
            <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--ds-muted)' }}>
              好きになる前のツアーや、まだ持っていないライブ映像を探せます。
              {entries && entries.length > 0 && `${entries.length}公演・${countItems(entries)}商品を掲載しています。`}
            </p>
          </header>

          {entries == null ? (
            <p className="text-sm px-4 py-3 rounded-xl" style={{ color: 'var(--ds-muted)', background: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}>
              商品情報を一時的に読み込めませんでした。時間をおいて再度お試しください。
            </p>
          ) : (
            <LiveArchiveBrowser
              groupName={groupName}
              groupId={slug}
              entries={entries}
              placement="live_list"
              officialListUrl={archiveGroup.officialListUrl}
            />
          )}

          {/* 楽天のイベント情報（開催中のものだけ）。商品カードの下に置き、商品の購入リンクとは分ける */}
          {campaigns.length > 0 && entries != null && entries.length > 0 && (
            <RakutenCampaignBox campaigns={campaigns} placement="live_list" groupId={slug} className="mt-6" />
          )}

          <p className="mt-8 text-center">
            <Link href={groupPath} className="theme-text-link text-sm">‹ {groupName}のページに戻る（メンバー・出演作品・配信情報）</Link>
          </p>
        </main>
      </div>
    </>
  );
}
