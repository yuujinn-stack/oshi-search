import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  VOD_PAGE_PROVIDERS,
  getVodPageProviderConfig,
  getWorksForVodProvider,
  getVodProviderStats,
  getTopPersonsForVodProvider,
  parseVodPageParam,
  isVodPageOutOfRange,
} from '@/lib/vod-page';
import { getAllPersonsMerged } from '@/lib/persons';
import { getVodPageEditorial } from '@/lib/vod-page-editorial';
import VodWorkCard from '@/components/VodWorkCard';
import VodTopPersonCard from '@/components/VodTopPersonCard';
import AffiliateSlot from '@/components/site/AffiliateSlot';

export const revalidate = 60;
export const dynamicParams = false; // VOD_PAGE_PROVIDERS以外のslugはNext.jsの標準挙動で404にする

interface Props {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateStaticParams() {
  return VOD_PAGE_PROVIDERS.map((p) => ({ provider: p.urlSlug }));
}

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { provider } = await params;
  const config = getVodPageProviderConfig(provider);
  if (!config) return {};

  const title = `${config.displayName}で見られる芸能人・アイドルの出演作品`;
  const description = `${config.displayName}で現在配信を確認できる映画・ドラマ・番組などを、芸能人・アイドル・俳優・アーティストから探せます。`;

  // ページごとに内容が異なる一覧ページのため、page=2以降は自ページを自己canonicalにする
  // （常にpage1を指すと、page2以降がGoogleにインデックスされにくくなる／重複コンテンツ扱いの
  // リスクがあるため）。不正なpage値の場合はpage1のURLにフォールバックする。
  const { page: pageParam } = await searchParams;
  const parsedPage = parseVodPageParam(pageParam);
  const page = parsedPage && parsedPage > 1 ? parsedPage : 1;
  const canonicalUrl =
    page > 1 ? `${SITE_ORIGIN}/vod/${config.urlSlug}?page=${page}` : `${SITE_ORIGIN}/vod/${config.urlSlug}`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: { title, description, type: 'website', url: canonicalUrl },
  };
}

function buildPageHref(urlSlug: string, page: number): string {
  return page <= 1 ? `/vod/${urlSlug}` : `/vod/${urlSlug}?page=${page}`;
}

export default async function VodProviderPage({ params, searchParams }: Props) {
  const { provider } = await params;
  const config = getVodPageProviderConfig(provider);
  if (!config) notFound();

  // Hulu / DMM TV / Disney+ の3ページのみ追加コンテンツを表示する（他11サービスはnullのまま）。
  const editorial = getVodPageEditorial(config.urlSlug);

  const { page: pageParam } = await searchParams;
  const page = parseVodPageParam(pageParam);
  // page=0・負数・小数・数字以外の文字列など、形式として不正な値は404にする。
  if (page === null) notFound();

  const [stats, result, topPersonsRaw, allPersons] = await Promise.all([
    getVodProviderStats(config.normalizedSlug),
    getWorksForVodProvider(config.normalizedSlug, page),
    getTopPersonsForVodProvider(config.normalizedSlug, 12),
    getAllPersonsMerged(),
  ]);

  // 確認済み作品が実際に存在するproviderで総ページ数を超えるpageが指定された
  // 場合は404にする（totalCount=0の場合は通常の空一覧表示のまま維持する）。
  if (isVodPageOutOfRange(page, result.totalCount, result.totalPages)) notFound();

  const groupByName = new Map(allPersons.map((p) => [p.name, p.group]));
  const topPersons = topPersonsRaw.map((p) => ({ ...p, group: groupByName.get(p.name) ?? '' }));

  const personUrl = `${SITE_ORIGIN}/vod/${config.urlSlug}`;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: SITE_ORIGIN },
      { '@type': 'ListItem', position: 2, name: `${config.displayName}で見られる出演作品`, item: personUrl },
    ],
  };

  // このページ（現在のページ分）に実際に表示している作品のみを反映する。全件を含む
  // ItemListではない（result.worksは現在のpageの24件のみ）ため、positionは
  // このページ内での通し番号（全体通し番号ではなく1始まり）とする。
  const itemListJsonLd = result.works.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: result.works.map((work, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: `${SITE_ORIGIN}${work.detailUrl}`,
      name: work.title,
    })),
  } : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      {itemListJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />
      )}

      {/* パンくず */}
      <nav className="text-xs mb-6 flex items-center gap-1.5" style={{ color: 'var(--ds-muted)' }}>
        <Link href="/" className="hover:underline">トップ</Link>
        <span aria-hidden="true">›</span>
        <span>{config.displayName}で見られる出演作品</span>
      </nav>

      {/* H1・導入文 */}
      <div className="mb-6">
        <h1 className="text-2xl font-black mb-3" style={{ color: 'var(--ds-text)' }}>
          {config.displayName}で見られる推しの出演作品
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ds-muted)' }}>
          推しサーチでは、{config.displayName}で現在配信を確認できた映画・ドラマ・番組などを、出演者から探せます。
          気になる人物の出演作品や配信状況を確認し、視聴したい作品を探すときにご活用ください。
        </p>
      </div>

      <AffiliateSlot vodService={config.normalizedSlug} slotKey="vod_hero" className="mb-6" />

      {/* 配信状況に関する注意文 */}
      <p className="text-xs rounded-xl px-4 py-3 mb-6" style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-muted)' }}>
        配信状況は変更・終了する場合があります。実際に視聴する際は、各動画配信サービスの公式サイトで最新情報をご確認ください。
      </p>

      {/* 概要カード */}
      <div className="grid grid-cols-2 gap-3 mb-8 max-w-md">
        <div className="rounded-xl px-4 py-3 text-center" style={{ background: 'var(--ds-primary-soft)' }}>
          <p className="text-2xl font-black" style={{ color: 'var(--ds-primary)' }}>{stats.workCount}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ds-muted)' }}>配信確認済み作品</p>
        </div>
        <div className="rounded-xl px-4 py-3 text-center" style={{ background: 'var(--ds-primary-soft)' }}>
          <p className="text-2xl font-black" style={{ color: 'var(--ds-primary)' }}>{stats.personCount}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ds-muted)' }}>関連人物</p>
        </div>
      </div>

      {/* サービス説明 */}
      <section className="mb-10">
        <h2 className="text-base font-bold mb-2" style={{ color: 'var(--ds-text)' }}>
          {config.displayName}の配信作品を人物から探す
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ds-muted)' }}>
          推しサーチでは、人物やグループを起点に出演作品を探し、その作品が{config.displayName}で配信されているか確認できます。
          好きな俳優・アイドル・アーティストの出演作品を探したいときにご活用ください。
        </p>
      </section>

      {/* Hulu / DMM TV / Disney+ 限定: このサイトならではの活用法・情報の透明性・FAQ */}
      {editorial && (
        <>
          <section className="mb-10">
            <h2 className="text-base font-bold mb-2" style={{ color: 'var(--ds-text)' }}>
              {editorial.uniqueValueHeading}
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ds-muted)' }}>
              {editorial.uniqueValueBody}
            </p>
          </section>

          <section className="mb-10 rounded-xl px-4 py-4" style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}>
            <h2 className="text-base font-bold mb-2" style={{ color: 'var(--ds-text)' }}>
              配信情報について
            </h2>
            <ul className="text-xs leading-relaxed list-disc pl-4 space-y-1" style={{ color: 'var(--ds-muted)' }}>
              <li>掲載しているのは日本国内向けの配信情報です。</li>
              <li>推しサーチが現在確認できている範囲の情報を掲載しています。</li>
              <li>各作品カードに、その配信情報を確認した日付を表示しています。</li>
              <li>配信状況はサービス側の都合により変更・終了されることがあります。</li>
              <li>実際に視聴する際は、最終的な視聴可否・料金等を{config.displayName}の公式サービスでご確認ください。</li>
              {editorial.officialDisclaimer && <li>{editorial.officialDisclaimer}</li>}
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="text-base font-bold mb-3" style={{ color: 'var(--ds-text)' }}>
              よくある質問
            </h2>
            <div className="space-y-2">
              {editorial.faq.map((item) => (
                <details key={item.question} className="rounded-xl px-4 py-3" style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}>
                  <summary className="text-sm font-semibold cursor-pointer" style={{ color: 'var(--ds-text)' }}>
                    {item.question}
                  </summary>
                  <p className="text-xs leading-relaxed mt-2" style={{ color: 'var(--ds-muted)' }}>
                    {item.answer}
                  </p>
                </details>
              ))}
            </div>
          </section>
        </>
      )}

      {/* 人物から探す */}
      {topPersons.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-bold mb-4" style={{ color: 'var(--ds-text)' }}>
            {config.displayName}の配信作品から人物を探す
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {topPersons.map((p) => (
              <VodTopPersonCard key={p.name} name={p.name} group={p.group} workCount={p.workCount} />
            ))}
          </div>
        </section>
      )}

      <AffiliateSlot vodService={config.normalizedSlug} slotKey="vod_mid" className="mb-10" />

      {/* 作品一覧 */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>
            {config.displayName}の配信作品一覧
          </h2>
          {result.totalCount > 0 && (
            <span className="text-xs" style={{ color: 'var(--ds-muted)' }}>
              {result.totalCount}件中 {(page - 1) * result.pageSize + 1}〜{Math.min(page * result.pageSize, result.totalCount)}件
            </span>
          )}
        </div>

        {result.works.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {result.works.map((work) => (
              <VodWorkCard key={work.workId} work={work} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-center py-12 rounded-xl" style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-muted)' }}>
            現在、推しサーチで{config.displayName}の配信を確認できている作品はありません。
          </p>
        )}

        {/* ページネーション */}
        {result.totalPages > 1 && (
          <nav className="flex items-center justify-center gap-2 mt-8" aria-label="ページネーション">
            {page > 1 && (
              <Link
                href={buildPageHref(config.urlSlug, page - 1)}
                className="text-xs font-semibold px-4 py-2 rounded-lg"
                style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
              >
                ← 前へ
              </Link>
            )}
            <span className="text-xs" style={{ color: 'var(--ds-muted)' }}>
              {page} / {result.totalPages}
            </span>
            {page < result.totalPages && (
              <Link
                href={buildPageHref(config.urlSlug, page + 1)}
                className="text-xs font-semibold px-4 py-2 rounded-lg"
                style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
              >
                次へ →
              </Link>
            )}
          </nav>
        )}
      </section>

      <AffiliateSlot vodService={config.normalizedSlug} slotKey="vod_bottom" className="mt-10" />

      {/* 情報の調査・更新方針への控えめなリンク */}
      <p className="text-xs text-center mt-10" style={{ color: 'var(--ds-muted)' }}>
        <Link href="/editorial-policy" className="hover:underline">配信情報の調査・更新方針はこちら</Link>
      </p>
    </div>
  );
}
