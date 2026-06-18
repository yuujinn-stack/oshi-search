import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPersonWithConfig, getAllPersons } from '@/lib/persons';
import { getWork, getPublishedWorks } from '@/lib/work-store';
import { getAllStoredProducts } from '@/lib/product-store';
import { getAllVerdicts } from '@/lib/judgment-store';
import { VOD_TYPE_LABEL } from '@/types/vod';
import type { VodProvider } from '@/types/vod';
import type { ProductCategory } from '@/types/person';
import type { RakutenItem } from '@/types/rakuten';
import { deduplicateProviders } from '@/lib/vod-dedup';

interface Props {
  params: Promise<{ slug: string; workId: string }>;
}

export const dynamic = 'force-dynamic';

// ─── TMDb から詳細情報（ジャンル）を取得 ─────────────────────
async function fetchTmdbDetails(
  tmdbId: number,
  type: 'movie' | 'tv',
): Promise<{ genres: string[] }> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return { genres: [] };
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${apiKey}&language=ja-JP`,
      { cache: 'force-cache' },
    );
    if (!res.ok) return { genres: [] };
    const data = await res.json() as { genres?: Array<{ id: number; name: string }> };
    return { genres: (data.genres ?? []).map((g) => g.name) };
  } catch {
    return { genres: [] };
  }
}

// ─── 同じ workId を持つ登録済みの他の出演者を並列取得 ─────────────────────
async function getCoStars(
  workId: string,
  excludePerson: string,
): Promise<Array<{ name: string; group: string; roleName?: string }>> {
  const persons = getAllPersons().filter((p) => p.name !== excludePerson);
  const works = await Promise.all(persons.map((p) => getWork(p.name, workId)));
  return persons
    .map((p, i) => ({ ...p, work: works[i] }))
    .filter(({ work }) => work !== null && work?.status === 'auto_published')
    .map(({ name, group, work }) => ({ name, group, roleName: work?.roleName }));
}

// ─── 楽天の保存済み商品から作品名に関連するものを取得 ────────────────────
async function getRelatedProducts(
  personName: string,
  workTitle: string,
): Promise<RakutenItem[]> {
  const [storedData, verdicts] = await Promise.all([
    getAllStoredProducts(personName),
    getAllVerdicts(personName),
  ]);
  const titleNorm = workTitle.toLowerCase().replace(/[　\s]/g, '');
  const targetCats: ProductCategory[] = ['Blu-ray・DVD', 'CD', '本・雑誌'];
  return targetCats
    .flatMap((cat) => storedData[cat]?.products ?? [])
    .filter((p) => {
      if (verdicts[p.id]?.verdict !== 'related') return false;
      const pTitle = p.title.toLowerCase().replace(/[　\s]/g, '');
      return pTitle.includes(titleNorm);
    })
    .slice(0, 6);
}

// ─── メタデータ ────────────────────────────────────────────────
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, workId } = await params;
  const personName = decodeURIComponent(slug);
  const work = await getWork(personName, workId);
  if (!work) return {};
  const year = work.releaseYear ? `${work.releaseYear}年` : '';
  return {
    title: `${work.title} 配信情報・出演者一覧 | ${personName}`,
    description: `${work.title}（${year}）の配信サービス、出演者、関連商品を掲載。${personName}出演作品。`,
    openGraph: {
      title: `${work.title} 配信情報・出演者一覧`,
      description: `${work.title}の配信サービス・出演者・関連商品情報`,
      images: work.posterUrl ? [{ url: work.posterUrl }] : [],
      type: 'article',
    },
  };
}

// ─── 定数 ─────────────────────────────────────────────────────
const SOURCE_LABEL: Record<string, string> = {
  tmdb_watch_provider: 'TMDb',
  openai_supplement: 'AI補完',
  openai_web_search: 'AI Web検索',
  manual: '手動',
  manual_csv: 'CSV調査',
};

const SOURCE_BADGE: Record<string, string> = {
  tmdb_watch_provider: 'bg-blue-100 text-blue-700',
  openai_supplement: 'bg-purple-100 text-purple-700',
  openai_web_search: 'bg-violet-100 text-violet-700',
  manual: 'bg-green-100 text-green-700',
  manual_csv: 'bg-orange-100 text-orange-700',
};

const CONFIDENCE_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };
const CONFIDENCE_COLOR: Record<string, string> = {
  high: 'text-green-600',
  medium: 'text-yellow-600',
  low: 'text-red-500',
};

const TYPE_ORDER: Record<string, number> = { flatrate: 0, free: 1, ads: 2, rent: 3, buy: 4, unknown: 5 };
const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w45';

const CATEGORY_ICON: Record<string, string> = {
  'Blu-ray・DVD': '📀',
  'CD': '💿',
  '本・雑誌': '📖',
  '写真集': '📷',
  'グッズ': '🎁',
};

function formatDate(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ─── ページ本体 ────────────────────────────────────────────────
export default async function WorkDetailPage({ params }: Props) {
  const { slug, workId } = await params;
  const personName = decodeURIComponent(slug);
  const person = getPersonWithConfig(personName);
  if (!person) notFound();

  const work = await getWork(personName, workId);
  if (!work || work.status !== 'auto_published') notFound();

  // 並列データ取得
  const [tmdbDetails, coStars, allWorks, relatedProducts] = await Promise.all([
    work.tmdbId ? fetchTmdbDetails(work.tmdbId, work.type) : Promise.resolve({ genres: [] }),
    getCoStars(workId, personName),
    getPublishedWorks(personName),
    getRelatedProducts(personName, work.title),
  ]);

  const relatedWorks = allWorks.filter((w) => w.id !== workId).slice(0, 6);

  // 公開用 VOD フィルタ + 重複除去
  const publicProviders = deduplicateProviders(
    (work.vodProviders ?? []).filter((p) => {
      const isAiSource = p.source === 'openai_supplement' || p.source === 'openai_web_search';
      if (isAiSource && p.confidence === 'low') return false;
      return true;
    }),
  );

  const sortedProviders = publicProviders
    .slice()
    .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));

  const streamingProviders = sortedProviders.filter((p) => ['flatrate', 'free', 'ads'].includes(p.type));
  const purchaseProviders = sortedProviders.filter((p) => ['buy', 'rent'].includes(p.type));

  const tmdbUrl = work.tmdbId
    ? `https://www.themoviedb.org/${work.type}/${work.tmdbId}`
    : undefined;

  const jwLink = sortedProviders.find((p) => p.link)?.link;

  const hasAi = sortedProviders.some(
    (p) => p.source === 'openai_supplement' || p.source === 'openai_web_search',
  );

  const lowConfidenceCount = (work.vodProviders ?? []).filter((p) => {
    const isAiSource = p.source === 'openai_supplement' || p.source === 'openai_web_search';
    return isAiSource && p.confidence === 'low';
  }).length;

  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.vercel.app';

  // 構造化データ（JSON-LD）
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': work.type === 'movie' ? 'Movie' : 'TVSeries',
    name: work.title,
    ...(work.originalTitle && work.originalTitle !== work.title && { alternateName: work.originalTitle }),
    ...(work.releaseYear && { datePublished: String(work.releaseYear) }),
    ...(work.overview && { description: work.overview }),
    ...(work.posterUrl && { image: work.posterUrl }),
    ...(tmdbDetails.genres.length > 0 && { genre: tmdbDetails.genres }),
    actor: [
      { '@type': 'Person', name: personName, url: `${siteOrigin}/person/${encodeURIComponent(personName)}` },
      ...coStars.map((s) => ({
        '@type': 'Person',
        name: s.name,
        url: `${siteOrigin}/person/${encodeURIComponent(s.name)}`,
      })),
    ],
  };

  // ─── サブコンポーネント ──
  function ProviderRow({ p }: { p: VodProvider }) {
    return (
      <div className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
        <div className="w-10 h-10 flex-shrink-0 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
          {p.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${TMDB_LOGO_BASE}${p.logoPath}`} alt={p.providerName} className="w-10 h-10 object-contain" />
          ) : (
            <span className="text-xs text-gray-400 text-center px-1 leading-tight">{p.providerName.slice(0, 4)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-sm">{p.providerName}</p>
          <p className="text-xs text-gray-500">{VOD_TYPE_LABEL[p.type] ?? p.type}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SOURCE_BADGE[p.source] ?? 'bg-gray-100 text-gray-500'}`}>
            {SOURCE_LABEL[p.source] ?? p.source}
          </span>
          {p.confidence && (
            <span className={`text-[10px] ${CONFIDENCE_COLOR[p.confidence] ?? ''}`}>
              確度: {CONFIDENCE_LABEL[p.confidence] ?? p.confidence}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="min-h-screen bg-gray-50">
        {/* ヘッダー */}
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-lg mx-auto px-4 py-3">
            <Link
              href={`/person/${encodeURIComponent(personName)}`}
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              ← {personName}の出演作品一覧
            </Link>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

          {/* ━━━ 基本情報 ━━━ */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="flex gap-4 p-4">
              {/* ポスター */}
              <div className="w-24 flex-shrink-0">
                {work.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={work.posterUrl.replace('/w500', '/w300')}
                    alt={work.title}
                    className="w-24 aspect-[2/3] object-cover rounded-xl"
                  />
                ) : (
                  <div className="w-24 aspect-[2/3] bg-gray-100 rounded-xl flex items-center justify-center text-gray-300 text-2xl">
                    🎬
                  </div>
                )}
              </div>

              {/* テキスト情報 */}
              <div className="flex-1 min-w-0 space-y-1.5">
                <h1 className="font-bold text-slate-800 text-lg leading-snug">{work.title}</h1>
                {work.originalTitle && work.originalTitle !== work.title && (
                  <p className="text-sm text-gray-400">{work.originalTitle}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  {work.releaseYear && <span>{work.releaseYear}年</span>}
                  <span className="bg-gray-100 px-2 py-0.5 rounded-full">
                    {work.type === 'movie' ? '映画' : 'ドラマ・TV'}
                  </span>
                  {work.roleName && <span className="text-indigo-500">役: {work.roleName}</span>}
                </div>

                {/* ジャンル */}
                {tmdbDetails.genres.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tmdbDetails.genres.map((g) => (
                      <span key={g} className="text-[11px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                        {g}
                      </span>
                    ))}
                  </div>
                )}

                {work.overview && (
                  <p className="text-xs text-gray-500 line-clamp-4 mt-1 leading-relaxed">{work.overview}</p>
                )}
              </div>
            </div>
          </div>

          {/* ━━━ 配信情報 ━━━ */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">配信サービス</h2>
              {work.vodUpdatedAt && (
                <span className="text-[11px] text-gray-400">
                  確認日: {formatDate(work.vodUpdatedAt)}
                </span>
              )}
            </div>

            <div className="px-4">
              {sortedProviders.length > 0 ? (
                <>
                  {streamingProviders.length > 0 && (
                    <div>
                      <p className="text-[11px] text-gray-400 pt-3 pb-1 font-medium">見放題・無料</p>
                      {streamingProviders.map((p, i) => (
                        <ProviderRow key={`${p.providerId}-${p.type}-${i}`} p={p} />
                      ))}
                    </div>
                  )}
                  {purchaseProviders.length > 0 && (
                    <div>
                      <p className="text-[11px] text-gray-400 pt-3 pb-1 font-medium">レンタル・購入</p>
                      {purchaseProviders.map((p, i) => (
                        <ProviderRow key={`${p.providerId}-${p.type}-${i}`} p={p} />
                      ))}
                    </div>
                  )}
                  {lowConfidenceCount > 0 && (
                    <p className="text-[11px] text-gray-400 pt-2 pb-3">
                      ※ 確度が低い情報 {lowConfidenceCount}件は表示を省略しています
                    </p>
                  )}
                  <div className="py-1" />
                </>
              ) : (
                <div className="py-6 text-center">
                  <p className="text-sm text-gray-500">配信情報は現在確認できません。</p>
                  {lowConfidenceCount > 0 && (
                    <p className="text-xs text-orange-400 mt-1">
                      AI補完情報 {lowConfidenceCount}件がありますが、確度が低いため表示を省略しています
                    </p>
                  )}
                  {work.vodUpdatedAt && (
                    <p className="text-xs text-gray-400 mt-1">
                      最終確認: {formatDate(work.vodUpdatedAt)}
                    </p>
                  )}
                  {tmdbUrl && (
                    <a
                      href={tmdbUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-3 text-sm font-semibold text-indigo-600 border border-indigo-300 px-4 py-2 rounded-xl hover:bg-indigo-50 transition-colors"
                    >
                      TMDbで詳細を見る
                    </a>
                  )}
                </div>
              )}
            </div>

            <div className="px-4 pb-4">
              <p className="text-[11px] text-gray-400 leading-relaxed bg-gray-50 rounded-xl px-3 py-2">
                ※配信状況は変更される可能性があります。最新の配信状況は各公式サイトでご確認ください。
                {hasAi && <> AI補完による情報を含む場合があります。正確性は保証されません。</>}
              </p>
            </div>
          </div>

          {/* ━━━ アクションボタン ━━━ */}
          <div className="space-y-2">
            {jwLink && (
              <a
                href={jwLink}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center font-bold bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl transition-colors"
              >
                視聴先を探す（JustWatch）
              </a>
            )}
            {tmdbUrl && (
              <a
                href={tmdbUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-sm text-gray-500 hover:text-indigo-600 py-2 rounded-2xl border border-gray-200 hover:border-indigo-300 transition-colors"
              >
                TMDbで詳細を見る
              </a>
            )}
          </div>

          {/* ━━━ 出演者 ━━━ */}
          {(coStars.length > 0 || true) && (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-bold text-slate-800">出演者（当サイト登録）</h2>
              </div>
              <div className="p-4">
                {/* 現在の人物 */}
                <Link
                  href={`/person/${encodeURIComponent(personName)}`}
                  className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-indigo-50 transition-colors group"
                >
                  <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm flex-shrink-0">
                    {personName[0]}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 group-hover:text-indigo-700 transition-colors">
                      {personName}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {person.group}
                      {work.roleName && ` · 役: ${work.roleName}`}
                    </p>
                  </div>
                  <span className="ml-auto text-indigo-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                </Link>

                {/* 共演者 */}
                {coStars.map((star) => (
                  <Link
                    key={star.name}
                    href={`/person/${encodeURIComponent(star.name)}`}
                    className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-indigo-50 transition-colors group"
                  >
                    <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-bold text-sm flex-shrink-0">
                      {star.name[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 group-hover:text-indigo-700 transition-colors">
                        {star.name}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {star.group}
                        {star.roleName && ` · 役: ${star.roleName}`}
                      </p>
                    </div>
                    <span className="ml-auto text-indigo-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
                  </Link>
                ))}

                {coStars.length === 0 && (
                  <p className="text-xs text-gray-400 px-3 py-1">
                    当サイトに登録された共演者はいません
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ━━━ 関連作品 ━━━ */}
          {relatedWorks.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-bold text-slate-800">{personName}の他の出演作品</h2>
                <Link
                  href={`/person/${encodeURIComponent(personName)}`}
                  className="text-xs text-indigo-500 hover:text-indigo-700"
                >
                  一覧を見る →
                </Link>
              </div>
              <div className="p-4 grid grid-cols-3 gap-2.5">
                {relatedWorks.map((w) => (
                  <Link
                    key={w.id}
                    href={`/person/${encodeURIComponent(personName)}/work/${encodeURIComponent(w.id)}`}
                    className="group"
                  >
                    <div className="aspect-[2/3] rounded-lg overflow-hidden bg-gray-100 mb-1">
                      {w.posterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={w.posterUrl}
                          alt={w.title}
                          className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-200 text-2xl">
                          🎬
                        </div>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-700 line-clamp-2 leading-tight group-hover:text-indigo-600 transition-colors">
                      {w.title}
                    </p>
                    {w.releaseYear && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{w.releaseYear}年</p>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* ━━━ 関連商品 ━━━ */}
          {relatedProducts.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-bold text-slate-800">関連商品</h2>
                <p className="text-[11px] text-gray-400 mt-0.5">楽天市場の商品情報</p>
              </div>
              <div className="p-4 space-y-2.5">
                {relatedProducts.map((product) => (
                  <a
                    key={product.id}
                    href={product.affiliateUrl || product.itemUrl}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="flex items-center gap-3 hover:bg-gray-50 rounded-xl p-2 -mx-2 transition-colors group"
                  >
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.imageUrl}
                        alt={product.title}
                        className="w-12 h-14 object-cover rounded-lg flex-shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-12 h-14 bg-gray-100 rounded-lg flex-shrink-0 flex items-center justify-center text-lg">
                        {CATEGORY_ICON[product.category] ?? '🛒'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 line-clamp-2 group-hover:text-indigo-600 transition-colors">
                        {product.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                          {CATEGORY_ICON[product.category]} {product.category}
                        </span>
                        {product.price > 0 && (
                          <span className="text-[11px] text-slate-600 font-medium">
                            ¥{product.price.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-gray-300 group-hover:text-indigo-400 transition-colors flex-shrink-0">→</span>
                  </a>
                ))}
              </div>
              <p className="text-[10px] text-gray-300 px-4 pb-3">
                ※楽天市場の商品情報です。価格・在庫は変動する場合があります。
              </p>
            </div>
          )}

          {/* AI補完ソース情報 */}
          {hasAi && (
            <div className="text-[11px] text-gray-400 text-center space-y-1">
              {sortedProviders
                .filter((p) => p.source === 'openai_supplement' && p.sourceUrl)
                .map((p, i) => (
                  <p key={i}>
                    参照:{' '}
                    <a
                      href={p.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {p.sourceUrl}
                    </a>
                  </p>
                ))}
              {work.vodAiCheckedAt && (
                <p>AI補完確認日: {formatDate(work.vodAiCheckedAt)}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
