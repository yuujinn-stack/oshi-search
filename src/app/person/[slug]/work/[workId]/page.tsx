import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPersonWithConfigMerged, getAllPersonsMerged } from '@/lib/persons';
import { getWork, getPublishedWorks } from '@/lib/work-store';
import { getAllStoredProducts } from '@/lib/product-store';
import { getAllVerdicts } from '@/lib/judgment-store';
import type { VodProvider } from '@/types/vod';
import type { ProductCategory } from '@/types/person';
import type { RakutenItem } from '@/types/rakuten';
import { deduplicateProviders, normalizeProviderName } from '@/lib/vod-dedup';
import ProviderLogo from '@/components/ProviderLogo';

interface Props {
  params: Promise<{ slug: string; workId: string }>;
}

export const dynamic = 'force-dynamic';

// ─── TMDb からジャンルを取得（force-cache で重複呼び出し防止）────────────────
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

// ─── 同じ workId を持つ登録済みの他の出演者を並列取得 ────────────────────────
async function getCoStars(
  workId: string,
  excludePerson: string,
): Promise<Array<{ name: string; group: string; roleName?: string }>> {
  const persons = (await getAllPersonsMerged()).filter((p) => p.name !== excludePerson);
  const works = await Promise.all(persons.map((p) => getWork(p.name, workId)));
  return persons
    .map((p, i) => ({ ...p, work: works[i] }))
    .filter(({ work }) => work !== null && work?.status === 'auto_published')
    .map(({ name, group, work }) => ({ name, group, roleName: work?.roleName }));
}

// ─── 楽天の保存済み商品から作品名に関連するものを取得 ────────────────────────
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

// ─── メタデータ ────────────────────────────────────────────────────────────────
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, workId: rawWorkId } = await params;
  const personName = decodeURIComponent(slug);
  const workId = decodeURIComponent(rawWorkId);
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

// ─── VOD 種別ごとの表示設定 ──────────────────────────────────────────────────
const VOD_TYPE_CONFIG: Record<string, {
  icon: string;
  label: string;
  btnLabel: string;
  border: string;
  bg: string;
  btn: string;
  labelColor: string;
}> = {
  flatrate: { icon: '🟢', label: '見放題',      btnLabel: '今すぐ見る',   border: 'border-green-200',  bg: 'bg-green-50',  btn: 'bg-green-600 hover:bg-green-700',   labelColor: 'text-green-700' },
  free:     { icon: '🟢', label: '無料',         btnLabel: '無料で見る',   border: 'border-green-200',  bg: 'bg-green-50',  btn: 'bg-green-600 hover:bg-green-700',   labelColor: 'text-green-700' },
  ads:      { icon: '🟡', label: '広告付き無料', btnLabel: '無料で見る',   border: 'border-yellow-200', bg: 'bg-yellow-50', btn: 'bg-yellow-600 hover:bg-yellow-700', labelColor: 'text-yellow-700' },
  rent:     { icon: '🟠', label: 'レンタル',     btnLabel: 'レンタルする', border: 'border-orange-200', bg: 'bg-orange-50', btn: 'bg-orange-600 hover:bg-orange-700', labelColor: 'text-orange-700' },
  buy:      { icon: '🔵', label: '購入',         btnLabel: '購入する',     border: 'border-blue-200',   bg: 'bg-blue-50',   btn: 'bg-blue-600 hover:bg-blue-700',     labelColor: 'text-blue-700' },
  unknown:  { icon: '⬜', label: '配信',         btnLabel: '詳細を見る',   border: 'border-gray-200',   bg: 'bg-gray-50',   btn: 'bg-gray-600 hover:bg-gray-700',     labelColor: 'text-gray-600' },
};

// ─── 配信サービス公式 URL マッピング（p.link がない場合のフォールバック）──────
const VOD_OFFICIAL_URLS: Record<string, string> = {
  'lemino':             'https://lemino.docomo.ne.jp/',
  'hulu':               'https://www.hulu.jp/',
  'unext':              'https://video.unext.jp/',
  'netflix':            'https://www.netflix.com/jp/',
  'primevideo':         'https://www.amazon.co.jp/gp/video/storefront',
  'amazonprimevideo':   'https://www.amazon.co.jp/gp/video/storefront',
  'disneyplus':         'https://www.disneyplus.com/ja-jp',
  'abema':              'https://abema.tv/',
  'abemat':             'https://abema.tv/',
  'fod':                'https://fod.fujitv.co.jp/',
  'telasa':             'https://telasa.jp/',
  'dmmtv':              'https://tv.dmm.com/',
  'rakutentv':          'https://tv.rakuten.co.jp/',
  'tversionrakuten':    'https://tv.rakuten.co.jp/',
  'nhkondemand':        'https://www.nhk-ondemand.jp/',
  'paravi':             'https://www.paravi.jp/',
  'tver':               'https://tver.jp/',
  'wowow':              'https://www.wowow.co.jp/',
  'bandaichannel':      'https://www.b-ch.com/',
  'niconico':           'https://www.nicovideo.jp/',
  'gyao':               'https://gyao.yahoo.co.jp/',
  'hikari':             'https://hikaritv.net/',
  'jcomtv':             'https://v.jcom.co.jp/',
};

function getVodLink(p: VodProvider): string | undefined {
  if (p.link) return p.link;
  const norm = normalizeProviderName(p.providerName);
  return VOD_OFFICIAL_URLS[norm];
}

// ─── その他の定数 ──────────────────────────────────────────────────────────────
const TYPE_ORDER: Record<string, number> = { flatrate: 0, free: 1, ads: 2, rent: 3, buy: 4, unknown: 5 };

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

// ─── ページ本体 ────────────────────────────────────────────────────────────────
export default async function WorkDetailPage({ params }: Props) {
  const { slug, workId: rawWorkId } = await params;
  const personName = decodeURIComponent(slug);
  const workId = decodeURIComponent(rawWorkId);
  const person = await getPersonWithConfigMerged(personName);
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

  const hasAi = sortedProviders.some(
    (p) => p.source === 'openai_supplement' || p.source === 'openai_web_search',
  );

  const lowConfidenceCount = (work.vodProviders ?? []).filter((p) => {
    const isAiSource = p.source === 'openai_supplement' || p.source === 'openai_web_search';
    return isAiSource && p.confidence === 'low';
  }).length;

  const tmdbUrl = work.tmdbId
    ? `https://www.themoviedb.org/${work.type}/${work.tmdbId}`
    : undefined;

  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.vercel.app';
  const workUrl = `${siteOrigin}/person/${encodeURIComponent(personName)}/work/${encodeURIComponent(workId)}`;
  const personUrl = `${siteOrigin}/person/${encodeURIComponent(personName)}`;
  const groupUrl = person.group ? `${siteOrigin}/group/${encodeURIComponent(person.group)}` : null;

  // ─── JSON-LD: Movie / TVSeries ──
  const workJsonLd = {
    '@context': 'https://schema.org',
    '@type': work.type === 'movie' ? 'Movie' : 'TVSeries',
    name: work.title,
    ...(work.originalTitle && work.originalTitle !== work.title && { alternateName: work.originalTitle }),
    ...(work.releaseYear && { datePublished: String(work.releaseYear) }),
    ...(work.overview && { description: work.overview }),
    ...(work.posterUrl && { image: work.posterUrl }),
    ...(tmdbDetails.genres.length > 0 && { genre: tmdbDetails.genres }),
    url: workUrl,
    actor: [
      { '@type': 'Person', name: personName, url: personUrl },
      ...coStars.map((s) => ({
        '@type': 'Person',
        name: s.name,
        url: `${siteOrigin}/person/${encodeURIComponent(s.name)}`,
      })),
    ],
  };

  // ─── JSON-LD: BreadcrumbList ──
  const breadcrumbItems: Array<{ '@type': string; position: number; name: string; item: string }> = [
    { '@type': 'ListItem', position: 1, name: 'ホーム', item: siteOrigin },
  ];
  if (person.group && groupUrl) {
    breadcrumbItems.push({ '@type': 'ListItem', position: 2, name: person.group, item: groupUrl });
    breadcrumbItems.push({ '@type': 'ListItem', position: 3, name: personName, item: personUrl });
    breadcrumbItems.push({ '@type': 'ListItem', position: 4, name: work.title, item: workUrl });
  } else {
    breadcrumbItems.push({ '@type': 'ListItem', position: 2, name: personName, item: personUrl });
    breadcrumbItems.push({ '@type': 'ListItem', position: 3, name: work.title, item: workUrl });
  }
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbItems,
  };

  return (
    <>
      {/* JSON-LD */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(workJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <div className="min-h-screen bg-gray-50">

        {/* ━━━ パンくずリスト ━━━ */}
        <nav aria-label="パンくずリスト" className="bg-white border-b border-gray-200">
          <div className="max-w-lg mx-auto px-4 py-2.5 flex items-center gap-1.5 text-xs text-gray-500 overflow-x-auto whitespace-nowrap">
            <Link href="/" className="hover:text-indigo-600 transition-colors shrink-0">ホーム</Link>
            {person.group && (
              <>
                <span className="text-gray-300 shrink-0">›</span>
                <Link href={`/group/${encodeURIComponent(person.group)}`} className="hover:text-indigo-600 transition-colors shrink-0">
                  {person.group}
                </Link>
              </>
            )}
            <span className="text-gray-300 shrink-0">›</span>
            <Link href={`/person/${encodeURIComponent(personName)}`} className="hover:text-indigo-600 transition-colors shrink-0">
              {personName}
            </Link>
            <span className="text-gray-300 shrink-0">›</span>
            <span className="text-slate-700 truncate">{work.title}</span>
          </div>
        </nav>

        <div className="max-w-lg mx-auto px-4 py-5 space-y-5">

          {/* ━━━ ファーストビュー（基本情報 + サマリー統計） ━━━ */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="flex gap-4 p-4">
              {/* ポスター */}
              <div className="w-24 flex-shrink-0">
                {work.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={work.posterUrl.replace('/w500', '/w300')}
                    alt={work.title}
                    className="w-24 aspect-[2/3] object-cover rounded-xl shadow-sm"
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
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                  <span className="bg-gray-100 px-2 py-0.5 rounded-full">
                    {work.type === 'movie' ? '映画' : 'ドラマ・TV'}
                  </span>
                  {work.releaseYear && <span>{work.releaseYear}年</span>}
                  {work.roleName && <span className="text-indigo-500">役: {work.roleName}</span>}
                </div>

                {/* ジャンル */}
                {tmdbDetails.genres.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tmdbDetails.genres.map((g) => (
                      <span key={g} className="text-[11px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                        {g}
                      </span>
                    ))}
                  </div>
                )}

                {/* サマリー統計 */}
                <div className="flex items-center gap-3 pt-1 border-t border-gray-100 mt-2">
                  <div className="text-center">
                    <p className="text-base font-bold text-slate-800 leading-none">{1 + coStars.length}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">出演者</p>
                  </div>
                  <div className="w-px h-6 bg-gray-100" />
                  <div className="text-center">
                    <p className="text-base font-bold text-slate-800 leading-none">{sortedProviders.length}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">配信</p>
                  </div>
                  {relatedProducts.length > 0 && (
                    <>
                      <div className="w-px h-6 bg-gray-100" />
                      <div className="text-center">
                        <p className="text-base font-bold text-slate-800 leading-none">{relatedProducts.length}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">関連商品</p>
                      </div>
                    </>
                  )}
                  {/* 配信ステータスバッジ */}
                  <div className="ml-auto">
                    {streamingProviders.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-green-100 text-green-700 px-2.5 py-1 rounded-full">
                        🟢 配信中
                      </span>
                    ) : sortedProviders.length > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full">
                        🟠 レンタル・購入
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
                        配信情報なし
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* あらすじ */}
            {work.overview && (
              <div className="px-4 pb-4 border-t border-gray-50">
                <p className="text-xs text-gray-500 leading-relaxed line-clamp-4 pt-3">{work.overview}</p>
              </div>
            )}
          </div>

          {/* ━━━ 配信情報（色分けカード + 直接リンク） ━━━ */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">配信情報</h2>
              {work.vodUpdatedAt && (
                <span className="text-[11px] text-gray-400">確認: {formatDate(work.vodUpdatedAt)}</span>
              )}
            </div>

            {sortedProviders.length > 0 ? (
              <div className="p-4 space-y-3">
                {sortedProviders.map((p, i) => {
                  const cfg = VOD_TYPE_CONFIG[p.type] ?? VOD_TYPE_CONFIG.unknown;
                  const link = getVodLink(p);
                  const isAi = p.source === 'openai_supplement' || p.source === 'openai_web_search';
                  return (
                    <div key={`${p.providerId}-${p.type}-${i}`} className={`rounded-xl border ${cfg.border} ${cfg.bg} p-3`}>
                      <div className="flex items-center gap-3">
                        {/* ロゴ */}
                        <ProviderLogo
                          providerName={p.providerName}
                          logoPath={p.logoPath}
                          size="xl"
                          className="rounded-xl shadow-sm"
                        />
                        {/* サービス名・種別 */}
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-slate-800 text-sm leading-tight">{p.providerName}</p>
                          <p className={`text-xs font-semibold mt-0.5 ${cfg.labelColor}`}>
                            {cfg.icon} {cfg.label}
                          </p>
                        </div>
                        {/* AI マーク */}
                        {isAi && (
                          <span className="text-[9px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full flex-shrink-0 font-medium">
                            AI
                          </span>
                        )}
                      </div>
                      {/* アクションボタン */}
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`mt-3 flex items-center justify-center gap-1.5 w-full text-sm font-bold text-white py-2.5 rounded-xl transition-colors ${cfg.btn}`}
                        >
                          {p.providerName}で{cfg.btnLabel} →
                        </a>
                      ) : (
                        <p className="mt-3 text-xs text-center text-gray-400 py-1.5 bg-white/60 rounded-lg">
                          {p.providerName}で視聴可能（公式サイトでご確認ください）
                        </p>
                      )}
                    </div>
                  );
                })}

                {lowConfidenceCount > 0 && (
                  <p className="text-[11px] text-gray-400 text-center">
                    ※ 確度が低い情報 {lowConfidenceCount}件は表示を省略しています
                  </p>
                )}
              </div>
            ) : (
              <div className="py-6 text-center px-4">
                <p className="text-2xl mb-2">😔</p>
                <p className="text-sm font-medium text-gray-600">現在配信情報が確認できません</p>
                {lowConfidenceCount > 0 && (
                  <p className="text-xs text-orange-400 mt-2">
                    AI補完情報 {lowConfidenceCount}件がありますが、確度が低いため省略しています
                  </p>
                )}
                {work.vodUpdatedAt && (
                  <p className="text-xs text-gray-400 mt-1">最終確認: {formatDate(work.vodUpdatedAt)}</p>
                )}
                {tmdbUrl && (
                  <a
                    href={tmdbUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-3 text-sm font-semibold text-indigo-600 border border-indigo-300 px-4 py-2 rounded-xl hover:bg-indigo-50 transition-colors"
                  >
                    TMDbで最新情報を確認する →
                  </a>
                )}
              </div>
            )}

            <div className="px-4 pb-4">
              <p className="text-[11px] text-gray-400 leading-relaxed bg-gray-50 rounded-xl px-3 py-2">
                ※配信状況は変更される可能性があります。最新の配信状況は各公式サイトでご確認ください。
                {hasAi && <> AI補完による情報を含む場合があります。正確性は保証されません。</>}
              </p>
            </div>
          </div>

          {/* ━━━ TMDb リンク（配信情報ありの場合は補足として） ━━━ */}
          {tmdbUrl && sortedProviders.length > 0 && (
            <a
              href={tmdbUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-xs text-gray-400 hover:text-indigo-500 py-2 transition-colors"
            >
              TMDbで詳細・最新の配信情報を確認する →
            </a>
          )}

          {/* ━━━ 出演者（当サイト登録） ━━━ */}
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">出演者（当サイト登録）</h2>
              {person.group && (
                <Link
                  href={`/group/${encodeURIComponent(person.group)}`}
                  className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
                >
                  {person.group}へ →
                </Link>
              )}
            </div>
            <div className="p-4 space-y-1">
              {/* 現在の人物 */}
              <Link
                href={`/person/${encodeURIComponent(personName)}`}
                className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-indigo-50 transition-colors group"
              >
                <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm flex-shrink-0">
                  {personName[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800 group-hover:text-indigo-700 transition-colors">
                    {personName}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {person.group ? (
                      <span className="text-[11px] text-gray-400">{person.group}</span>
                    ) : null}
                    {work.roleName && (
                      <span className="text-[11px] text-indigo-400">· 役: {work.roleName}</span>
                    )}
                  </div>
                </div>
                <span className="text-indigo-300 text-sm">›</span>
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
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 group-hover:text-indigo-700 transition-colors">
                      {star.name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {star.group ? (
                        <span className="text-[11px] text-gray-400">{star.group}</span>
                      ) : null}
                      {star.roleName && (
                        <span className="text-[11px] text-indigo-400">· 役: {star.roleName}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-indigo-300 text-sm">›</span>
                </Link>
              ))}

              {coStars.length === 0 && (
                <p className="text-xs text-gray-400 px-3 py-1">当サイトに登録された共演者はいません</p>
              )}
            </div>
          </div>

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
                        <div className="w-full h-full flex items-center justify-center text-gray-200 text-2xl">🎬</div>
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
                    <span className="text-gray-300 group-hover:text-indigo-400 transition-colors flex-shrink-0 text-sm">›</span>
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
                    <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
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
