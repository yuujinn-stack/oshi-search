import Link from 'next/link';
import { unstable_cache } from 'next/cache';
import { getAllPersonsEnrichedWithGenres, getAllPersonsWithConfig } from '@/lib/persons';
import { getHomeRankingData, RANKING_DATA_CACHE_TAG } from '@/lib/ranking';
import type { HomeRankingData } from '@/lib/ranking';
import type { PersonCardData } from '@/lib/persons';
import { DEFAULT_GENRE_ORDER } from '@/lib/genre-utils';
import HeroSearchForm from '@/components/site/HeroSearchForm';
import type { SuggestionItem } from '@/types/search';
import { getAllGroupMetas } from '@/lib/group-meta';
import { groupHrefByName } from '@/lib/group-slug';
import type { GroupMeta } from '@/types/group';
import { getRenderableProductTitle } from '@/lib/product-image';
import { VOD_PAGE_PROVIDERS, getVodProviderWorkCounts } from '@/lib/vod-page';
import { getPhotobookHomeItems } from '@/lib/photobook-store';
import PhotobookHomeSection from '@/components/site/PhotobookHomeSection';
import HomeGroupSection from '@/components/site/HomeGroupSection';
import type { HomeGroupItem } from '@/components/site/HomeGroupSection';
import { Space_Grotesk, Space_Mono, Noto_Sans_JP } from 'next/font/google';
import './home-graphic.css';

// トップページのデザイン「C. Graphic Pop」用フォント（home-graphic.css の --pc-* を上書き）。
// next/font でビルド時にセルフホストする（外部CDNへのリクエストなし）。
// 日本語Webフォント（Noto Sans JP）は極太見出し・ロゴ用の 900 のみ。本文は既存のフォントスタックを使う
// （本文用の太さまで読み込むと、ページ内の文字に応じて多数の分割フォントが読み込まれるため）。
const graphicDisplayFont = Space_Grotesk({ subsets: ['latin'], weight: ['700'], display: 'swap' });
const graphicMonoFont = Space_Mono({ subsets: ['latin'], weight: ['400', '700'], display: 'swap' });
const graphicJpFont = Noto_Sans_JP({ subsets: ['latin'], weight: ['900'], display: 'swap', preload: false });
const GRAPHIC_FONT_VARS_CSS = `html:not([data-proto]):has(.oshi-home-graphic){--pc-display:${graphicDisplayFont.style.fontFamily},system-ui,sans-serif;--pc-jp:${graphicJpFont.style.fontFamily},'Hiragino Sans',system-ui,sans-serif;--pc-mono:${graphicMonoFont.style.fontFamily},ui-monospace,monospace;}`;

// Redis への問い合わせ結果を 60 秒間 Vercel Data Cache でキャッシュ
// → 同一デプロイ内でリクエストが集中しても Redis 呼び出しは最大1回/60秒
const getCachedEnrichedData = unstable_cache(
  getAllPersonsEnrichedWithGenres,
  ['home-enriched-data'],
  { revalidate: 60 },
);

// トップページで表示している「人気検索」「人気商品」だけを取得する軽量版。
// 「今人気の人物」「急上昇」「人気作品」「注目の人物」はトップページで表示しないため
// （src/components/site/HomeDiscoverySections.tsx に退避）、それらの集計処理は走らせない。
// キャッシュキーは旧 getRankingData() 用の 'home-ranking-data' と分けている（返却形が異なるため）。
// 管理画面の revalidateTag(RANKING_DATA_CACHE_TAG) による即時失効は引き続き有効。
const getCachedRankingData = unstable_cache(
  getHomeRankingData,
  ['home-ranking-lite-data'],
  { revalidate: 60, tags: [RANKING_DATA_CACHE_TAG] },
);

const getCachedGroupMetas = unstable_cache(
  getAllGroupMetas,
  ['home-group-metas'],
  { revalidate: 60 },
);

// 「配信サービスから探す」の0件provider除外判定専用。トップページでは詳細な
// 人物・作品データまでは取得せず、この件数マップだけを使ってカード表示可否を決める
// （Section 42: 詳細データ取得は各VODページ側で行う）。
// unstable_cache()はJSONシリアライズを行うためMapをそのまま返せず、プレーンな
// オブジェクトに変換してからキャッシュする。
async function getVodProviderWorkCountsObject(): Promise<Record<string, number>> {
  const map = await getVodProviderWorkCounts();
  return Object.fromEntries(map);
}
const getCachedVodProviderWorkCounts = unstable_cache(
  getVodProviderWorkCountsObject,
  ['home-vod-provider-counts'],
  { revalidate: 60 },
);

const HOME_PHOTOBOOK_LIMIT = 8;

async function getHomePhotobookItems(): Promise<{ female: Awaited<ReturnType<typeof getPhotobookHomeItems>>; male: Awaited<ReturnType<typeof getPhotobookHomeItems>> }> {
  const [female, male] = await Promise.all([
    getPhotobookHomeItems('female', HOME_PHOTOBOOK_LIMIT),
    getPhotobookHomeItems('male', HOME_PHOTOBOOK_LIMIT),
  ]);
  return { female, male };
}
const getCachedHomePhotobookItems = unstable_cache(
  getHomePhotobookItems,
  ['home-photobook-items'],
  { revalidate: 60, tags: ['photobook-home'] },
);

const EMPTY_RANKING: HomeRankingData = {
  popularSearches: [],
  popularProducts: [],
};

export const revalidate = 60;

const GENRE_EMOJI: Record<string, string> = {
  '坂道': '🌸', 'アイドル': '⭐', '元アイドル': '🌟', 'タレント': '✨', 'バラエティ': '🎪', '芸人': '😄', 'テレビ': '📺',
  '女優': '🎭', '俳優': '🎬', '声優': '🎙️', 'モデル': '👗', 'グラビア': '📸',
  '歌手': '🎤', 'アーティスト': '🎵', 'バンド': '🎸', 'シンガーソングライター': '🎸',
  '作詞家': '✍️', '作曲家': '🎼', '編曲家': '🎵', '音楽プロデューサー': '🎬', 'DJ': '🎧',
  '作家': '📝', '小説家': '📚', '漫画家': '✏️', '脚本家': '📄', '映画監督': '🎥', '監督': '🎥', 'プロデューサー': '🎬', 'クリエイター': '💡',
  'スポーツ選手': '🏃', 'アスリート': '🏆', 'ダンサー': '💃', 'コーチ': '🏅',
  'アナウンサー': '📢', 'キャスター': '📺', 'コメンテーター': '💬',
  'YouTuber': '▶️', 'インフルエンサー': '📱', '実業家': '💼', '政治家': '🏛️', '研究者': '🔬', '文化人': '🎭', '芸能界引退': '🌙',
};

const GENRE_CATEGORIES: { label: string; icon: string; genres: string[] }[] = [
  { label: 'アイドル・芸能',    icon: '⭐', genres: ['坂道', 'アイドル', '元アイドル', 'タレント', 'バラエティ', '芸人', 'テレビ'] },
  { label: '俳優・女優・モデル', icon: '🎬', genres: ['俳優', '女優', '声優', 'モデル', 'グラビア'] },
  { label: '音楽',              icon: '🎵', genres: ['歌手', 'アーティスト', 'バンド', 'シンガーソングライター', '作詞家', '作曲家', '編曲家', '音楽プロデューサー', 'DJ'] },
  { label: '文化・クリエイター', icon: '✍️', genres: ['作家', '小説家', '漫画家', '脚本家', '映画監督', '監督', 'プロデューサー', 'クリエイター'] },
  { label: 'スポーツ',          icon: '🏃', genres: ['スポーツ選手', 'アスリート', 'ダンサー', 'コーチ'] },
  { label: '報道・メディア',     icon: '📢', genres: ['アナウンサー', 'キャスター', 'コメンテーター'] },
  { label: 'その他',            icon: '💡', genres: ['YouTuber', 'インフルエンサー', '実業家', '政治家', '研究者', '文化人', '芸能界引退'] },
];

// トップページ初期表示で出す主要ジャンル（既存データ上のジャンル名）。これ以外は
// 「すべてのジャンルを見る」（<details>）の中に表示する。
const HOME_PRIMARY_GENRES = ['アイドル', '俳優', '女優', 'タレント', '歌手', 'アーティスト', '声優', 'モデル', '芸人'];

function GenrePill({ genre }: { genre: string }) {
  return (
    <Link
      href={`/genre/${encodeURIComponent(genre)}`}
      className="theme-link-pill"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '6px 12px',
        borderRadius: '999px',
        fontWeight: 600,
        fontSize: '13px',
        textDecoration: 'none',
        minHeight: '34px',
      }}
    >
      <span aria-hidden="true">{GENRE_EMOJI[genre]}</span>
      <span>{genre}</span>
    </Link>
  );
}

// ─── ページ ──────────────────────────────────────────────────────────────────────
export default async function HomePage() {
  // Redis 失敗時も200を返すため allSettled を使用
  const [enrichedResult, rankingResult, groupMetasResult, vodCountsResult, photobookResult] = await Promise.allSettled([
    getCachedEnrichedData(),
    getCachedRankingData(),
    getCachedGroupMetas(),
    getCachedVodProviderWorkCounts(),
    getCachedHomePhotobookItems(),
  ]);

  const { persons, genres: allGenres } = enrichedResult.status === 'fulfilled'
    ? enrichedResult.value
    : { persons: getAllPersonsWithConfig() as unknown as PersonCardData[], genres: Array.from(DEFAULT_GENRE_ORDER) };

  const ranking = rankingResult.status === 'fulfilled' ? rankingResult.value : EMPTY_RANKING;
  // DB取得に失敗した場合は安全側（0件扱い）でフォールバックし、カードを一切表示しない
  // （実在しない可能性のあるproviderへのリンクを誤って出さないため）。
  const vodProviderWorkCounts: Record<string, number> = vodCountsResult.status === 'fulfilled' ? vodCountsResult.value : {};
  const availableVodProviders = VOD_PAGE_PROVIDERS.filter((p) => (vodProviderWorkCounts[p.normalizedSlug] ?? 0) > 0);
  const groupMetaList: GroupMeta[] = groupMetasResult.status === 'fulfilled' ? groupMetasResult.value : [];

  if (enrichedResult.status === 'rejected') console.error('[page] enriched data failed:', enrichedResult.reason);
  if (rankingResult.status === 'rejected') console.error('[page] ranking data failed:', rankingResult.reason);
  if (photobookResult.status === 'rejected') console.error('[page] photobook data failed:', photobookResult.reason);

  const photobookFemale = photobookResult.status === 'fulfilled' ? photobookResult.value.female : [];
  const photobookMale = photobookResult.status === 'fulfilled' ? photobookResult.value.male : [];

  const groups = [...new Set(persons.map((p) => p.group).filter(Boolean))];

  const heroSuggestions: SuggestionItem[] = [
    ...groups.map((g) => ({ label: g, href: groupHrefByName(g, groupMetaList), type: 'group' as const })),
    ...persons.flatMap((p) => [
      { label: p.name, sublabel: p.group || undefined, href: `/person/${encodeURIComponent(p.name)}`, type: 'person' as const },
      ...(p.config.aliases ?? []).map((a) => ({
        label: a, sublabel: p.name, href: `/search?q=${encodeURIComponent(a)}`, type: 'alias' as const,
      })),
    ]),
  ];

  // 「今人気の人物」「急上昇」「人気作品」「注目の人物」はトップページでは表示しない
  // （src/components/site/HomeDiscoverySections.tsx に退避。データ取得も getHomeRankingData() で省略）。
  const { popularSearches, popularProducts } = ranking;

  // ジャンルを大分類カードに振り分け（実データにあるジャンルのみ表示、未分類は「その他」に追加）
  const genreSet = new Set(allGenres);
  const expandedCategories = GENRE_CATEGORIES.map((cat) => ({
    ...cat,
    genres: cat.genres.filter((g) => genreSet.has(g)),
  }));
  const categorizedGenres = new Set(expandedCategories.flatMap((c) => c.genres));
  const uncategorized = allGenres.filter((g) => !categorizedGenres.has(g));
  const visibleCategories = expandedCategories
    .map((cat) =>
      cat.label === 'その他'
        ? { ...cat, genres: [...cat.genres, ...uncategorized] }
        : cat
    )
    .filter((cat) => cat.genres.length > 0);
  const primaryGenres = HOME_PRIMARY_GENRES.filter((g) => genreSet.has(g));
  const primaryGenreSet = new Set(primaryGenres);
  const moreCategories = visibleCategories
    .map((cat) => ({ ...cat, genres: cat.genres.filter((g) => !primaryGenreSet.has(g)) }))
    .filter((cat) => cat.genres.length > 0);

  // 「グループで探す」用。絞り込み分類は HomeGroupSection 内の表示用マッピングで決める（DBの値は使わない）
  const homeGroups: HomeGroupItem[] = groups.map((g) => ({
    name: g,
    href: groupHrefByName(g, groupMetaList),
  }));

  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';
  // サイト全体のWebSite/Organization JSON-LD。個別ページ（Person/Movie等）とは異なり
  // 特定コンテンツの主張ではなくサイト自体の識別情報のため、既存の検索機能（/search?q=）
  // のみを使い、実在しない機能・情報は追加しない。
  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: '推しサーチ',
    url: siteOrigin,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${siteOrigin}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: '推しサーチ',
    url: siteOrigin,
  };

  return (
    // oshi-home-graphic: トップページのデザイン「C. Graphic Pop」（src/app/home-graphic.css）の適用範囲
    <div className="oshi-home-graphic">
      <style dangerouslySetInnerHTML={{ __html: GRAPHIC_FONT_VARS_CSS }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }} />
      {/* ━━━ Hero（メインコピー＋検索） ━━━ */}
      {/* すでに推しがいるユーザーがすぐ検索できるよう、スマホでも検索欄がファーストビューに入る高さに抑える */}
      <section
        style={{
          background: 'linear-gradient(135deg, var(--ds-hero-from) 0%, var(--ds-hero-to) 100%)',
          // 下側はPCで「グループで探す」が早く見えるよう上側より控えめ（スマホ幅では従来どおり32px）
          padding: 'clamp(28px, 7vw, 80px) 16px clamp(32px, 5vw, 56px)',
        }}
      >
        <div style={{ maxWidth: '640px', margin: '0 auto', textAlign: 'center' }}>
          <h1 style={{
            fontSize: 'clamp(22px, 5vw, 38px)',
            fontWeight: 900,
            color: '#fff',
            marginBottom: '10px',
            letterSpacing: '-0.02em',
            lineHeight: 1.25,
          }}>
            {/* 語の途中（「まとめ／て」等）で折れないよう、自然な区切りごとに inline-block でまとめる */}
            <span style={{ display: 'inline-block' }}>推しの出演作・配信先・商品を</span>
            <span style={{ display: 'inline-block' }}>まとめてチェック</span>
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.78)', marginBottom: '20px', fontSize: '15px', lineHeight: 1.65 }}>
            推しの名前・グループ名から探す
          </p>
          {/* 「人気:」キーワードチップはトップページでは非表示（HeroSearchForm 内に固定リストとして残している） */}
          <HeroSearchForm suggestions={heroSuggestions} showPopularKeywords={false} />
        </div>
      </section>

      {/* ━━━ グループ・ジャンルから探す ━━━ */}
      <div style={{ maxWidth: '1152px', margin: '0 auto', padding: 'clamp(24px, 5vw, 48px) 16px' }}>

        {/* グループで探す */}
        <HomeGroupSection groups={homeGroups} />

        {/* ジャンルで探す（主要ジャンルのみ初期表示。残りは <details> で展開。リンクはすべてサーバーHTMLに含まれる） */}
        <section>
          <h2 className="section-heading" style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>ジャンルで探す</h2>
          {primaryGenres.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {primaryGenres.map((genre) => (
                <GenrePill key={genre} genre={genre} />
              ))}
            </div>
          )}
          {moreCategories.length > 0 && (
            <details className="home-genre-more" style={{ marginTop: '12px' }}>
              <summary className="theme-text-link">
                <span className="home-genre-more-open">すべてのジャンルを見る</span>
                <span className="home-genre-more-close">ジャンルを閉じる</span>
              </summary>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: '12px',
                marginTop: '12px',
              }}>
                {moreCategories.map((cat) => (
                  <div
                    key={cat.label}
                    style={{
                      background: 'var(--ds-surface)',
                      border: '1px solid var(--ds-border)',
                      borderRadius: 'var(--ds-radius)',
                      padding: '14px 16px',
                    }}
                  >
                    <p style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      color: 'var(--ds-muted)',
                      marginBottom: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      letterSpacing: '0.02em',
                    }}>
                      <span aria-hidden="true">{cat.icon}</span>
                      {cat.label}
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {cat.genres.map((genre) => (
                        <GenrePill key={genre} genre={genre} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      </div>

      {/* ━━━ 配信サービスから探す ━━━ */}
      {availableVodProviders.length > 0 && (
        <section style={{ background: 'var(--ds-bg)', borderBottom: '1px solid var(--ds-border)', paddingTop: '24px', paddingBottom: '32px' }}>
          <div style={{ maxWidth: '1152px', margin: '0 auto', padding: '0 16px' }}>
            <h2 className="section-heading" style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>配信サービスから探す</h2>
            <p style={{ fontSize: '12px', color: 'var(--ds-muted)', marginBottom: '16px' }}>
              気になる配信サービスから、推しの出演作品を探せます。
            </p>
            <div className="vod-provider-grid">
              {availableVodProviders.map((provider) => (
                <Link
                  key={provider.urlSlug}
                  href={`/vod/${provider.urlSlug}`}
                  className="theme-card vod-provider-card"
                >
                  <span className="vod-provider-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none" />
                    </svg>
                  </span>
                  <span className="vod-provider-text">
                    <span className="vod-provider-name">{provider.displayName}</span>
                    <span className="vod-provider-desc hidden sm:block">出演作品を人物から探す</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ━━━ 🔍 人気検索 ━━━ */}
      {popularSearches.length > 0 && (
        <section style={{ background: 'var(--ds-surface)', borderBottom: '1px solid var(--ds-border)', paddingTop: '24px', paddingBottom: '32px' }}>
          <div style={{ maxWidth: '1152px', margin: '0 auto', padding: '0 16px' }}>
            <h2 className="section-heading" style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🔍 人気検索</h2>
            <div
              className="scrollbar-none"
              style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}
            >
              {popularSearches.map(({ keyword }, i) => (
                <Link
                  key={keyword}
                  href={`/search?q=${encodeURIComponent(keyword)}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    borderRadius: '999px',
                    fontSize: '13px',
                    fontWeight: 600,
                    textDecoration: 'none',
                    border: '1.5px solid var(--ds-border)',
                    background: 'var(--ds-bg)',
                    color: 'var(--ds-text)',
                    transition: 'border-color 0.15s, color 0.15s',
                    minHeight: '36px',
                  }}
                  className="theme-search-chip"
                >
                  <span style={{ fontSize: '10px', color: 'var(--ds-muted)', fontWeight: 500, minWidth: '14px' }}>{i + 1}</span>
                  {keyword}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ━━━ 🛍 人気商品 ━━━ */}
      {popularProducts.length > 0 && (
        <section style={{ background: 'var(--ds-surface)', borderBottom: '1px solid var(--ds-border)', paddingTop: '24px', paddingBottom: '32px' }}>
          <div style={{ maxWidth: '1152px', margin: '0 auto', padding: '0 16px' }}>
            <h2 className="section-heading" style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🛍 人気商品</h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '10px',
            }}
              className="popular-products-grid"
            >
              {popularProducts.map((product) => {
                const href = product.affiliateUrl || (product.personSlug ? `/person/${encodeURIComponent(product.personSlug)}` : '/search');
                const isExternal = !!product.affiliateUrl;
                // 楽天商品名にHTMLエンティティ（&amp; 等）が未デコードのまま混入している
                // 場合があるため、表示直前でデコードする（DBの値は変更しない）
                const displayTitle = getRenderableProductTitle(product.title);
                return (
                  <a
                    key={product.productId}
                    href={href}
                    target={isExternal ? '_blank' : undefined}
                    rel={isExternal ? 'noopener noreferrer sponsored' : undefined}
                    className="theme-card"
                    style={{
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'center',
                      padding: '10px',
                      textDecoration: 'none',
                      borderRadius: 'var(--ds-radius)',
                    }}
                  >
                    {/* 画像 */}
                    <div style={{
                      width: '52px',
                      height: '52px',
                      flexShrink: 0,
                      borderRadius: '8px',
                      overflow: 'hidden',
                      background: 'var(--ds-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {product.imageUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={product.imageUrl}
                          alt={displayTitle}
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '2px' }}
                        />
                      ) : (
                        <span style={{ fontSize: '20px' }}>🛒</span>
                      )}
                    </div>
                    {/* テキスト */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--ds-text)',
                        lineHeight: 1.4,
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical' as const,
                        marginBottom: '3px',
                      }}>
                        {displayTitle}
                      </p>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {product.personSlug && (
                          <span style={{ fontSize: '10px', color: 'var(--ds-muted)' }}>{product.personSlug}</span>
                        )}
                        {product.category && (
                          <span style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            background: 'var(--ds-primary-soft)',
                            color: 'var(--ds-primary)',
                            borderRadius: '4px',
                            padding: '1px 5px',
                          }}>
                            {product.category}
                          </span>
                        )}
                      </div>
                      {isExternal && (
                        <span style={{ fontSize: '9px', color: 'var(--ds-cta)', fontWeight: 600, marginTop: '2px', display: 'block' }}>
                          楽天で見る →
                        </span>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ━━━ 📷 写真集を探す ━━━ */}
      {(photobookFemale.length > 0 || photobookMale.length > 0) && (
        <PhotobookHomeSection femaleItems={photobookFemale} maleItems={photobookMale} />
      )}

      {/* ━━━ スタッツバー（トップページでは優先度を下げ最下部に配置） ━━━ */}
      <div className="hero-stats-bar">
        <div className="hero-stat">
          <span className="hero-stat-num">{persons.length}</span>
          <span className="hero-stat-label">登録タレント</span>
        </div>
        <div className="hero-stat-divider" aria-hidden="true" />
        <div className="hero-stat">
          <span className="hero-stat-num">{groups.length}</span>
          <span className="hero-stat-label">グループ対応</span>
        </div>
        <div className="hero-stat-divider" aria-hidden="true" />
        <div className="hero-stat">
          <span className="hero-stat-num">楽天</span>
          <span className="hero-stat-label">関連商品もまとめてチェック</span>
        </div>
        <div className="hero-stat-divider" aria-hidden="true" />
        <div className="hero-stat">
          <span className="hero-stat-num">VOD</span>
          <span className="hero-stat-label">配信先をまとめて確認</span>
        </div>
      </div>
    </div>
  );
}
