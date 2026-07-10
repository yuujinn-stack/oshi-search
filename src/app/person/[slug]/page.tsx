import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPersonWithConfigMerged, getPersonsByGroupMerged } from '@/lib/persons';
import { getAllStoredProductsOrThrow, type StoredCategoryData } from '@/lib/product-store';
import { getAllVerdictsOrThrow } from '@/lib/judgment-store';
import { getPublishedWorksOrThrow } from '@/lib/work-store';
import { getRedis } from '@/lib/redis';
import { getGroupMeta } from '@/lib/group-meta';
import { groupHref } from '@/lib/group-slug';
import { deduplicateProviders } from '@/lib/vod-dedup';
import ProductTabList, { type ProductWithSection } from '@/components/ProductTabList';
import PersonCard from '@/components/PersonCard';
import WorkCard from '@/components/WorkCard';
import ProviderLogo from '@/components/ProviderLogo';
import PageViewTracker from '@/components/site/PageViewTracker';
import type { ProductCategory, ApiResult, RakutenItem } from '@/types/rakuten';
import type { ActivityStatus } from '@/types/person';
import type { PersonMeta } from '@/app/api/admin/person-meta/route';
import { getGroupHeroGradient } from '@/lib/groupHeroGradient';
import { getAllDisplayOrders } from '@/lib/product-order-store';
import { shadowReadPersonPage } from '@/lib/shadow-read';
import {
  sortProductsByPerson,
  calcDisplayTier,
  calcDisplayScore,
  type PersonDisplayContext,
} from '@/lib/product-display-score';
import type { WorkRecord } from '@/types/work';
import type { VodProvider } from '@/types/vod';

// ─── 定数 ──────────────────────────────────────────────────────────────────────
const ACTIVITY_LABEL: Record<ActivityStatus, string> = {
  active: '現役',
  graduated: '卒業',
  withdrawn: '脱退',
  hiatus: '活動休止',
  retired: '引退',
  unknown: '不明',
};
const ACTIVITY_BADGE_CLS: Record<ActivityStatus, string> = {
  active:    'bg-green-100 text-green-700',
  graduated: 'bg-blue-100 text-blue-700',
  withdrawn: 'bg-red-100 text-red-600',
  hiatus:    'bg-amber-100 text-amber-700',
  retired:   'bg-gray-200 text-gray-500',
  unknown:   'bg-gray-100 text-gray-400',
};
const GENRE_BADGE: Record<string, string> = {
  '坂道':        'bg-pink-100 text-pink-700',
  '芸人':        'bg-yellow-100 text-yellow-700',
  'テレビ':      'bg-blue-100 text-blue-700',
  'アーティスト': 'bg-purple-100 text-purple-700',
  '俳優':        'bg-green-100 text-green-700',
};
const GENRE_GRADIENT: Record<string, string> = {
  '坂道':        'from-pink-600 to-rose-700',
  '芸人':        'from-amber-500 to-orange-600',
  'テレビ':      'from-sky-600 to-blue-700',
  'アーティスト': 'from-violet-600 to-purple-800',
  '俳優':        'from-emerald-600 to-green-800',
};

// ─── 商品ソート（既存ロジック・変更禁止） ─────────────────────────────────────
// ─ 中古カテゴリ商品（'中古'カテゴリ）をティア＋スコア順にソート ──────────────
// 本人名入り → 期別 → グループ → その他 の順。
// これらはすでに「新品」セクションの後に表示されるため tier 3-6 内でのソートになる。
function sortUsedProducts(products: RakutenItem[], ctx: PersonDisplayContext): RakutenItem[] {
  return [...products].sort((a, b) => {
    const ta = calcDisplayTier(a, ctx);
    const tb = calcDisplayTier(b, ctx);
    if (ta !== tb) return ta - tb;
    const sa = calcDisplayScore(a, ctx);
    const sb = calcDisplayScore(b, ctx);
    if (sb !== sa) return sb - sa;
    const aImg = a.imageUrl ? 0 : 1;
    const bImg = b.imageUrl ? 0 : 1;
    if (aImg !== bImg) return aImg - bImg;
    return (b.reviewCount * (b.reviewAverage || 0)) - (a.reviewCount * (a.reviewAverage || 0));
  });
}

// ─ 新品商品をティア優先でソート（savedOrder は同一ティア内のみ優先） ──────────
// 【中古】タイトルの商品が savedOrder に保存されていても、ティア 3+ に分類されるため
// ティア 0-2（通常新品）の下に必ず来る。
function applyDisplayOrder(
  products: RakutenItem[],
  savedOrder: string[],
  ctx: PersonDisplayContext,
): RakutenItem[] {
  // 1. tier 別にグループ化
  const tierMap = new Map<number, RakutenItem[]>();
  for (const p of products) {
    const t = calcDisplayTier(p, ctx);
    if (!tierMap.has(t)) tierMap.set(t, []);
    tierMap.get(t)!.push(p);
  }

  // 2. 各 tier を tier 昇順に並べ、tier 内は savedOrder → スコア降順
  const result: RakutenItem[] = [];
  for (const tier of [...tierMap.keys()].sort((a, b) => a - b)) {
    const group = tierMap.get(tier)!;
    if (savedOrder.length === 0) {
      group.sort((a, b) => calcDisplayScore(b, ctx) - calcDisplayScore(a, ctx));
      result.push(...group);
    } else {
      const added = new Set<string>();
      const inOrder: RakutenItem[] = [];
      for (const id of savedOrder) {
        const p = group.find((x) => x.id === id);
        if (p && !added.has(p.id)) { inOrder.push(p); added.add(p.id); }
      }
      const rest = group
        .filter((p) => !added.has(p.id))
        .sort((a, b) => calcDisplayScore(b, ctx) - calcDisplayScore(a, ctx));
      result.push(...inOrder, ...rest);
    }
  }
  return result;
}

// ─── 商品タイトルによるカテゴリ振り分け ────────────────────────────────────
// 判定順: CD → Blu-ray・DVD → 写真集・書籍（タイトル判定） → グッズ
// 管理カテゴリは CD・Blu-ray・DVD・中古 以外では使用しない。

// 写真集・書籍と判定するタイトルキーワード
const BOOK_TITLE_KEYWORDS: string[] = [
  '写真集', 'フォトブック',
  'PHOTOBOOK', 'Photobook', 'photobook', 'PHOTO BOOK', 'Photo Book',
  'BOOK', 'BOOKS',
  '書籍', '単行本', '雑誌', 'ムック', 'ガイド', 'コミック', '楽譜', '小説',
  '図鑑', '絵本', 'エッセイ',
  '乃木撮', '日向撮', '櫻撮',
  'B.L.T.', 'BRODY', 'EX大衆', 'anan', 'アップトゥボーイ', 'UTB',
  'Platinum FLASH', 'BUBKA', '東京カレンダー', 'TRIANGLE',
];

// タイトルと管理カテゴリから表示セクションラベルを返す
// CD・Blu-ray・DVD のみ管理カテゴリを使用。それ以外はタイトル判定のみ。
function classifyProduct(title: string, adminCat: ProductCategory): string {
  if (adminCat === 'CD') return 'CD';
  if (adminCat === 'Blu-ray・DVD') return 'Blu-ray・DVD';
  // タイトルに書籍キーワードが含まれるか（管理カテゴリ不使用）
  for (const kw of BOOK_TITLE_KEYWORDS) {
    if (title.includes(kw)) return '写真集・書籍';
  }
  // 書籍キーワード未一致はすべてグッズ（管理カテゴリに関わらず）
  return 'グッズ';
}

// ─── 表示セクション定義 ───────────────────────────────────────────────────────
const DISPLAY_SECTIONS: Array<{
  label: string;
  icon: string;
  sources: ProductCategory[]; // hasAnyData 判定 & 並び順キーに使用
  usedKeywords: string[];
}> = [
  {
    label: '写真集・書籍',
    icon: '📷',
    sources: ['写真集', '本・雑誌'],
    usedKeywords: [
      '写真集', 'フォトブック', 'PHOTOBOOK', 'Photobook', 'BOOK', 'BOOKS',
      '書籍', '単行本', '雑誌', 'ムック', 'ガイド', 'コミック', '小説', '楽譜',
      '乃木撮', '日向撮', '櫻撮', 'B.L.T.', 'BRODY', 'EX大衆', 'anan',
    ],
  },
  {
    label: 'CD',
    icon: '💿',
    sources: ['CD'],
    usedKeywords: ['CD', 'シングル', 'アルバム', 'ALBUM', 'SINGLE', 'ベストアルバム'],
  },
  {
    label: 'Blu-ray・DVD',
    icon: '📀',
    sources: ['Blu-ray・DVD'],
    usedKeywords: ['DVD', 'Blu-ray', 'ブルーレイ', 'ライブ', 'コンサート', 'ツアー'],
  },
  {
    label: 'グッズ',
    icon: '🎁',
    sources: ['グッズ'],
    usedKeywords: [
      'アクリルスタンド', 'アクスタ', '缶バッジ', '生写真', 'キーホルダー',
      'タオル', 'Tシャツ', 'ペンライト', 'クリアファイル', 'ステッカー',
      'ぬいぐるみ', 'キーチェーン', 'うちわ', 'ストラップ', 'ブロマイド',
      'グッズ', 'カレンダー', 'ポスター', 'トレカ', 'フィギュア',
    ],
  },
];

// ─── VOD フィルタ（WorkCard と同一ロジック） ──────────────────────────────────
function getStreamingProviders(work: WorkRecord): VodProvider[] {
  return deduplicateProviders(
    (work.vodProviders ?? []).filter((p) => {
      if (p.hidden) return false;
      const isAi = p.source === 'openai_supplement' || p.source === 'openai_web_search';
      return !isAi || p.confidence !== 'low';
    }),
  ).filter((p) => ['flatrate', 'free', 'ads'].includes(p.type));
}

interface Props { params: Promise<{ slug: string }> }

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const name = decodeURIComponent(slug);
  const person = await getPersonWithConfigMerged(name);
  if (!person) return {};
  const groupText = person.group ? `（${person.group}）` : '';
  const title = `${person.name}${groupText}の写真集・グッズ・出演作品・配信情報まとめ`;
  const description = `${person.name}の写真集・CD・Blu-ray・グッズを楽天で検索。出演ドラマ・映画・配信サービスもまとめて確認。`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'profile' },
  };
}

export default async function PersonPage({ params }: Props) {
  const { slug } = await params;
  const name = decodeURIComponent(slug);
  const person = await getPersonWithConfigMerged(name);
  if (!person) notFound();

  const groupMembers = person.group ? await getPersonsByGroupMerged(person.group) : [];
  const related = groupMembers.filter((p) => p.name !== person.name).slice(0, 4);

  const [storedResult, verdictsResult, worksResult, personMetaResult, groupMetaResult, displayOrdersResult] =
    await Promise.allSettled([
      getAllStoredProductsOrThrow(person.name),
      getAllVerdictsOrThrow(person.name),
      getPublishedWorksOrThrow(person.name),
      (async (): Promise<PersonMeta | null> => {
        try {
          const redis = getRedis();
          if (!redis) return null;
          const raw = await redis.hget<string>('admin:person-meta', person.name);
          if (!raw) return null;
          return (typeof raw === 'string' ? JSON.parse(raw) : raw) as PersonMeta;
        } catch { return null; }
      })(),
      person.group ? getGroupMeta(person.group) : Promise.resolve(null),
      getAllDisplayOrders(person.name),
    ]);

  const storedData: Partial<Record<ProductCategory, StoredCategoryData>> =
    storedResult.status === 'fulfilled' ? storedResult.value : {};
  const verdicts = verdictsResult.status === 'fulfilled' ? verdictsResult.value : {};
  const publishedWorks = worksResult.status === 'fulfilled' ? worksResult.value : [];
  const personMeta = personMetaResult.status === 'fulfilled' ? personMetaResult.value : null;
  const groupMeta = groupMetaResult.status === 'fulfilled' ? groupMetaResult.value : null;
  const displayOrders = displayOrdersResult.status === 'fulfilled' ? displayOrdersResult.value : {};
  const redisError =
    storedResult.status === 'rejected' ||
    worksResult.status === 'rejected' ||
    verdictsResult.status === 'rejected';

  // シャドーリード: DB件数をRedisと比較してログ出力（ユーザー表示に影響しない）
  await shadowReadPersonPage(name, {
    productCategories: Object.keys(storedData).length,
    verdicts: Object.keys(verdicts).length,
    publishedWorks: publishedWorks.length,
    hasPersonMeta: personMeta !== null,
  });

  // ── 中古商品 ──
  const usedCatData = storedData['中古'];
  const usedProducts: RakutenItem[] = [];
  if (usedCatData && Array.isArray(usedCatData.products)) {
    for (const p of usedCatData.products) {
      const v = verdicts[p.id];
      if (!v || v.verdict !== 'related') continue;
      usedProducts.push(p);
    }
  }

  // ── 新商品をタイトルで振り分け ──────────────────────────────────────────
  // ① 全カテゴリ（中古除く）の関連商品を収集
  // ② classifyProduct でタイトル判定してセクション振り分け
  const NEW_PRODUCT_CATS: ProductCategory[] = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD'];

  const bookProducts: RakutenItem[] = [];
  const cdProducts: RakutenItem[] = [];
  const blurayProducts: RakutenItem[] = [];
  const goodsProducts: RakutenItem[] = [];
  const globalSeen = new Set<string>();
  let anyDataFetched = false;

  for (const cat of NEW_PRODUCT_CATS) {
    const catData = storedData[cat];
    if (!catData) continue;
    anyDataFetched = true;
    if (!Array.isArray(catData.products)) continue;
    for (const p of catData.products) {
      if (globalSeen.has(p.id)) continue;
      const v = verdicts[p.id];
      if (!v || v.verdict !== 'related') continue;
      globalSeen.add(p.id);
      const section = classifyProduct(p.title, cat);
      if (section === '写真集・書籍') bookProducts.push(p);
      else if (section === 'CD') cdProducts.push(p);
      else if (section === 'Blu-ray・DVD') blurayProducts.push(p);
      else goodsProducts.push(p);
    }
  }

  const sectionProductLookup: Record<string, RakutenItem[]> = {
    '写真集・書籍': bookProducts,
    'CD': cdProducts,
    'Blu-ray・DVD': blurayProducts,
    'グッズ': goodsProducts,
  };

  // 人物コンテキスト（表示スコア計算用）
  // aliases は3文字未満を除外（短い別名の誤爆対策）
  const personCtx: PersonDisplayContext = {
    name: person.name,
    groupName: person.group ?? '',
    aliases: (person.config.aliases ?? []).filter((a) => a.length >= 3),
    generation: personMeta?.generation ?? '',
  };

  // ── セクション別商品 ──────────────────────────────────────────────────────
  const sectionResults = DISPLAY_SECTIONS.map(({ label, icon, sources, usedKeywords }) => {
    const newProducts = sectionProductLookup[label] ?? [];
    const hasAnyData = newProducts.length > 0 ||
      anyDataFetched ||
      sources.some((cat) => !!storedData[cat]);

    const sectionUsed = usedProducts.filter((p) => {
      const title = p.title.replace(/^【中古】\s*/, '');
      return usedKeywords.some((kw) => title.includes(kw));
    });

    const savedOrder = sources.flatMap((cat) => displayOrders[cat] ?? []);
    const sortedNew  = applyDisplayOrder(newProducts, savedOrder, personCtx);
    const sortedUsed = sortUsedProducts(sectionUsed, personCtx);

    const newResult: ApiResult = !hasAnyData
      ? { status: 'no_data' as const }
      : sortedNew.length > 0
      ? { status: 'ok' as const, products: sortedNew }
      : { status: 'empty' as const };
    return { label, icon, newResult, usedProducts: sortedUsed };
  });

  // ── 全商品フラット化（ProductTabList 用）─────────────────────────────────
  // フィルタ済み sectionResults を再利用する（公開条件・verdict ロジックは変更しない）
  const allProductItems: ProductWithSection[] = sectionResults.flatMap(
    ({ label, newResult, usedProducts: su }) => [
      ...(newResult.status === 'ok'
        ? newResult.products.map((p) => ({ product: p, sectionLabel: label, isUsed: false }))
        : []),
      ...su.map((p) => ({ product: p, sectionLabel: label, isUsed: true })),
    ],
  );

  // ── VOD データ ──
  const streamingWorks = publishedWorks.filter((w) => getStreamingProviders(w).length > 0);
  const providerWorkMap = new Map<string, { logoPath?: string; works: WorkRecord[] }>();
  for (const work of streamingWorks) {
    for (const p of getStreamingProviders(work)) {
      if (!providerWorkMap.has(p.providerName)) {
        providerWorkMap.set(p.providerName, { logoPath: p.logoPath, works: [] });
      }
      providerWorkMap.get(p.providerName)!.works.push(work);
    }
  }
  const providerGroups = [...providerWorkMap.entries()].sort(([a], [b]) => a.localeCompare(b, 'ja'));

  // ── Stats ──
  let totalProductCount = 0;
  for (const { newResult, usedProducts: su } of sectionResults) {
    if (newResult.status === 'ok') totalProductCount += newResult.products.length;
    totalProductCount += su.length;
  }
  const hasProducts = totalProductCount > 0;
  const hasWorks   = publishedWorks.length > 0;
  const hasVod     = streamingWorks.length > 0;

  // ── FAQ ──
  const topProviders = providerGroups.slice(0, 3).map(([n]) => n);
  const faqItems = [
    {
      q: `${person.name}の写真集・グッズはどこで買えますか？`,
      a: hasProducts
        ? `楽天市場・楽天ブックスで${totalProductCount}件の関連商品を掲載中です。写真集・CD・Blu-ray・グッズなど、このページからまとめてご確認いただけます。`
        : '楽天市場・楽天ブックスで関連商品をご確認ください。',
    },
    {
      q: `${person.name}の出演作品はどこで見られますか？`,
      a: hasVod
        ? `${streamingWorks.length}件の作品が配信中です。${topProviders.length > 0 ? `${topProviders.join('・')}などで視聴できます。` : ''}このページの「配信情報」セクションでご確認ください。`
        : hasWorks
        ? `出演作品を${publishedWorks.length}件掲載しています。各VODサービスでご確認ください。`
        : '配信情報は現在確認中です。',
    },
    {
      q: `${person.name}は${person.group ?? 'どのグループ'}のメンバーですか？`,
      a: person.group
        ? `${person.name}は${person.group}のメンバーです。${personMeta?.generation ? `${personMeta.generation}所属。` : ''}グループページでは全メンバーや関連情報をご確認いただけます。`
        : `${person.name}はソロアーティストです。`,
    },
  ];

  // ── JSON-LD ──
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';
  const personUrl  = `${siteOrigin}/person/${encodeURIComponent(person.name)}`;
  const groupPagePath = person.group
    ? (groupMeta ? groupHref(groupMeta) : `/groups/${encodeURIComponent(person.group)}`)
    : null;
  const personJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: person.name,
    url: personUrl,
    ...(person.group && groupPagePath
      ? { memberOf: { '@type': 'Organization', name: person.group, url: `${siteOrigin}${groupPagePath}` } }
      : {}),
  };
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: siteOrigin },
      ...(person.group && groupPagePath
        ? [{ '@type': 'ListItem', position: 2, name: person.group, item: `${siteOrigin}${groupPagePath}` }]
        : []),
      { '@type': 'ListItem', position: person.group ? 3 : 2, name: person.name, item: personUrl },
    ],
  };
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };

  const heroBackground = getGroupHeroGradient(person.group, person.genre);

  return (
    <>
      {/* ─── JSON-LD ─── */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      {/* ─── 閲覧数記録（30分以内は重複カウントしない） ─── */}
      <PageViewTracker entity="person" slug={name} />

      <div className="page-bg">

        {/* ─── パンくず ─── */}
        <nav aria-label="パンくずリスト" className="breadcrumb-bar">
          <div className="max-w-4xl mx-auto px-4 py-2.5 flex items-center gap-1.5 text-xs flex-wrap" style={{ color: 'var(--ds-muted)' }}>
            <Link href="/" className="theme-text-link">ホーム</Link>
            <span style={{ opacity: 0.4 }}>›</span>
            <Link href={`/genre/${encodeURIComponent(person.genre)}`} className="theme-text-link">
              {person.genre}
            </Link>
            {person.group && groupPagePath && (
              <>
                <span style={{ opacity: 0.4 }}>›</span>
                <Link href={groupPagePath} className="theme-text-link">
                  {person.group}
                </Link>
              </>
            )}
            <span style={{ opacity: 0.4 }}>›</span>
            <span className="font-medium" style={{ color: 'var(--ds-text)' }}>{person.name}</span>
          </div>
        </nav>

        {/* ─── Hero ─── */}
        <div className="py-8 px-4" style={{ background: heroBackground }}>
          <div className="max-w-4xl mx-auto">

            {/* 人物情報 */}
            <div className="flex items-start gap-4 mb-6">
              {/* アバター */}
              <div
                className="w-20 h-20 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white text-4xl font-black flex-shrink-0 select-none border border-white/20"
                aria-hidden="true"
              >
                {person.name[0]}
              </div>

              {/* テキスト情報 */}
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl sm:text-3xl font-black text-white leading-tight">{person.name}</h1>

                {/* メイン肩書き（primaryGenre優先）+ グループリンク */}
                {(() => {
                  const groupLink = personMeta?.currentGroupName || person.group || null;
                  if (personMeta?.primaryGenre) {
                    return (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-white/80 text-sm font-medium">{personMeta.primaryGenre}</span>
                        {groupLink && (
                          <Link
                            href={groupLink === person.group && groupPagePath ? groupPagePath : `/groups/${encodeURIComponent(groupLink)}`}
                            className="text-white/50 hover:text-white/80 text-xs transition-colors underline underline-offset-2 decoration-white/20"
                          >
                            {groupLink}
                          </Link>
                        )}
                      </div>
                    );
                  }
                  if (groupLink) {
                    return (
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Link
                          href={groupLink === person.group && groupPagePath ? groupPagePath : `/groups/${encodeURIComponent(groupLink)}`}
                          className="text-white/80 hover:text-white text-sm font-medium transition-colors underline underline-offset-2 decoration-white/40 hover:decoration-white"
                        >
                          {groupLink}
                        </Link>
                        {groupMeta?.activityStatus === 'renamed' && groupMeta.renamedTo && (
                          <Link
                            href={`/groups/${encodeURIComponent(groupMeta.renamedTo)}`}
                            className="text-[11px] text-white/60 hover:text-white transition-colors"
                          >
                            （現: {groupMeta.renamedTo}）
                          </Link>
                        )}
                      </div>
                    );
                  }
                  return <p className="text-white/70 mt-1 text-sm">ソロ活動</p>;
                })()}

                {/* バッジ群 */}
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {/* titles: primaryGenreと同一の値は除外（メインラベルで表示済み） */}
                  {personMeta?.titles && personMeta.titles.length > 0 &&
                    personMeta.titles
                      .filter((t) => t !== personMeta?.primaryGenre)
                      .map((t) => (
                        <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-white/25 text-white font-medium">
                          {t}
                        </span>
                      ))}
                  {/* primaryGenreはメインラベルで表示済みのためここでは表示しない */}
                  <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${GENRE_BADGE[person.genre] ?? 'bg-gray-100 text-gray-600'}`}>
                    {person.genre}
                  </span>
                  {personMeta?.activityStatus && personMeta.activityStatus !== 'unknown' && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${ACTIVITY_BADGE_CLS[personMeta.activityStatus]}`}>
                      {ACTIVITY_LABEL[personMeta.activityStatus]}
                    </span>
                  )}
                  {personMeta?.generation && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/20 text-white font-medium">
                      {personMeta.generation}
                    </span>
                  )}
                  {personMeta?.joinedAt && (
                    <span className="text-[11px] text-white/60">
                      {personMeta.joinedAt.slice(0, 7)} 加入
                    </span>
                  )}
                  {personMeta?.leftAt && (
                    <span className="text-[11px] text-white/60">
                      → {personMeta.leftAt.slice(0, 7)} 卒業
                    </span>
                  )}
                </div>

                {/* 旧グループ / 補足メモ */}
                {((personMeta?.formerGroupNames?.length ?? 0) > 0 || personMeta?.membershipNote) && (
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {personMeta?.formerGroupNames?.map((g) => (
                      <span key={g} className="text-[11px] text-white/60">元{g}</span>
                    ))}
                    {personMeta?.membershipNote && (
                      <span className="text-[11px] text-white/60 italic">{personMeta.membershipNote}</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Stats バー */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: '関連商品',   value: totalProductCount, unit: '件', href: '#products' },
                { label: '出演作品',   value: publishedWorks.length, unit: '件', href: '#works' },
                { label: '配信中',     value: streamingWorks.length, unit: '件', href: '#vod' },
                { label: '配信サービス', value: providerWorkMap.size, unit: '社', href: '#vod' },
              ].map(({ label, value, unit, href }) => (
                <a
                  key={label}
                  href={href}
                  className="bg-white/15 backdrop-blur-sm rounded-xl px-3 py-2.5 text-center hover:bg-white/25 transition-colors block"
                >
                  <p className="text-white/70 text-[10px] font-medium">{label}</p>
                  {value > 0 ? (
                    <p className="text-white font-black text-xl mt-0.5 leading-none">
                      {value.toLocaleString()}
                      <span className="text-xs font-medium ml-0.5">{unit}</span>
                    </p>
                  ) : (
                    <p className="text-white/40 text-sm mt-1">—</p>
                  )}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* ─── CTA ─── */}
        <div className="breadcrumb-bar shadow-sm">
          <div className="max-w-4xl mx-auto px-4 py-3">
            <div className="flex gap-2.5 overflow-x-auto scrollbar-none pb-0.5">
              {hasProducts && (
                <a
                  href="#products"
                  className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold rounded-xl transition-colors min-h-[44px]"
                  style={{ background: 'var(--ds-cta)', color: 'var(--ds-cta-text)' }}
                >
                  🛍 関連商品を見る
                  {totalProductCount > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.25)' }}>{totalProductCount}</span>
                  )}
                </a>
              )}
              {hasWorks && (
                <a
                  href="#works"
                  className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold rounded-xl transition-colors min-h-[44px]"
                  style={{ background: 'var(--ds-surface)', color: 'var(--ds-text)', border: '1px solid var(--ds-border)' }}
                >
                  🎬 出演作品を見る
                  {publishedWorks.length > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'var(--ds-primary-soft)', color: 'var(--ds-primary)' }}>{publishedWorks.length}</span>
                  )}
                </a>
              )}
              {hasVod && (
                <a
                  href="#vod"
                  className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold rounded-xl transition-colors min-h-[44px] bg-green-600 hover:bg-green-700 text-white"
                >
                  ▶ 配信を見る
                  <span className="text-xs bg-white/25 px-1.5 py-0.5 rounded-full">{streamingWorks.length}件</span>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* ─── メインコンテンツ ─── */}
        <div className="max-w-4xl mx-auto px-4 py-8 space-y-10">

          {/* ━━━ 商品セクション ━━━ */}
          <section id="products">
            <div className="flex items-center gap-2 mb-5">
              <h2 className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>🛍 関連商品</h2>
              {hasProducts && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--ds-primary-soft)', color: 'var(--ds-primary)' }}>
                  {totalProductCount}件
                </span>
              )}
            </div>

            {/* カテゴリタブ + ソート付き商品一覧 */}
            {sectionResults.every((r) => r.newResult.status === 'no_data' && r.usedProducts.length === 0) ? (
              <p
                className="text-sm rounded-xl border px-4 py-4"
                style={{
                  color: 'var(--ds-muted)',
                  background: 'var(--ds-surface)',
                  borderColor: 'var(--ds-border)',
                }}
              >
                {redisError
                  ? '商品情報を一時的に取得できません。データは保持されています。時間をおいて再度お試しください。'
                  : '関連商品は現在取得中です。しばらくお待ちください。'}
              </p>
            ) : (
              <ProductTabList items={allProductItems} personSlug={name} />
            )}
          </section>

          {/* ━━━ 出演作品 ━━━ */}
          {publishedWorks.length > 0 ? (
            <section id="works">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>🎬 出演作品</h2>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--ds-primary-soft)', color: 'var(--ds-primary)' }}>
                    {publishedWorks.length}件
                  </span>
                </div>
                {hasVod && (
                  <a href="#vod" className="text-xs text-green-600 font-medium hover:underline flex items-center gap-1">
                    ▶ 配信中を絞り込む
                  </a>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {publishedWorks.map((work) => (
                  <WorkCard key={work.id} work={work} />
                ))}
              </div>
            </section>
          ) : redisError ? (
            <section id="works">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>🎬 出演作品</h2>
              </div>
              <p
                className="text-sm rounded-xl border px-4 py-4"
                style={{ color: 'var(--ds-muted)', background: 'var(--ds-surface)', borderColor: 'var(--ds-border)' }}
              >
                作品情報を一時的に取得できません。データは保持されています。時間をおいて再度お試しください。
              </p>
            </section>
          ) : null}

          {/* ━━━ VOD配信情報 ━━━ */}
          {providerGroups.length > 0 && (
            <section id="vod">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>▶ 配信情報</h2>
                <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  🟢 {streamingWorks.length}件配信中
                </span>
              </div>

              <div className="space-y-2.5">
                {providerGroups.map(([providerName, { logoPath, works: pWorks }]) => (
                  <details
                    key={providerName}
                    className="theme-card overflow-hidden"
                  >
                    <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors [list-style:none] [&::-webkit-details-marker]:hidden" style={{ background: 'var(--ds-surface)' }}>
                      <ProviderLogo providerName={providerName} logoPath={logoPath} size="md" />
                      <span className="font-semibold text-sm flex-1" style={{ color: 'var(--ds-text)' }}>{providerName}</span>
                      <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex-shrink-0">
                        {pWorks.length}件
                      </span>
                    </summary>
                    <div className="px-4 py-3" style={{ borderTop: '1px solid var(--ds-border)' }}>
                      <div className="space-y-2">
                        {pWorks.slice(0, 8).map((work) => (
                          <Link
                            key={work.id}
                            href={`/person/${encodeURIComponent(work.personName)}/work/${encodeURIComponent(work.id)}`}
                            className="flex items-center gap-2 py-1 transition-colors group theme-text-link"
                            style={{ color: 'var(--ds-text)', textDecoration: 'none' }}
                          >
                            {work.posterUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={work.posterUrl}
                                alt={work.title}
                                className="w-8 h-12 object-cover rounded flex-shrink-0"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-8 h-12 rounded flex items-center justify-center text-sm flex-shrink-0" style={{ background: 'var(--ds-primary-soft)', color: 'var(--ds-muted)' }}>
                                🎬
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-medium line-clamp-2 leading-tight transition-colors" style={{ color: 'var(--ds-text)' }}>
                                {work.title}
                              </p>
                              {work.releaseYear && (
                                <p className="text-[10px] mt-0.5" style={{ color: 'var(--ds-muted)' }}>{work.releaseYear}年</p>
                              )}
                            </div>
                          </Link>
                        ))}
                        {pWorks.length > 8 && (
                          <p className="text-xs text-center pt-1" style={{ color: 'var(--ds-muted)' }}>他 {pWorks.length - 8}件</p>
                        )}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* ━━━ 関連メンバー ━━━ */}
          {related.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>
                  {person.group} のメンバー
                </h2>
                <Link
                  href={groupPagePath ?? `/groups/${encodeURIComponent(person.group)}`}
                  className="theme-text-link text-sm font-medium"
                  style={{ textDecoration: 'none' }}
                >
                  グループページへ →
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {related.map((p) => (
                  <PersonCard key={p.name} person={p} />
                ))}
              </div>
            </section>
          )}

          {/* ━━━ FAQ ━━━ */}
          <section>
            <h2 className="text-base font-bold mb-4" style={{ color: 'var(--ds-text)' }}>よくある質問</h2>
            <div className="space-y-2">
              {faqItems.map(({ q, a }) => (
                <details
                  key={q}
                  className="theme-card overflow-hidden"
                >
                  <summary className="flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors [list-style:none] [&::-webkit-details-marker]:hidden" style={{ background: 'var(--ds-surface)' }}>
                    <span className="font-black text-sm w-5 text-center flex-shrink-0" style={{ color: 'var(--ds-primary)' }}>Q</span>
                    <span className="font-semibold text-sm flex-1" style={{ color: 'var(--ds-text)' }}>{q}</span>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--ds-muted)' }}>›</span>
                  </summary>
                  <div className="px-4 py-3.5" style={{ borderTop: '1px solid var(--ds-border)' }}>
                    <div className="flex gap-3">
                      <span className="text-emerald-500 font-black text-sm w-5 text-center flex-shrink-0">A</span>
                      <p className="text-sm leading-relaxed" style={{ color: 'var(--ds-muted)' }}>{a}</p>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </section>

        </div>
      </div>
    </>
  );
}
