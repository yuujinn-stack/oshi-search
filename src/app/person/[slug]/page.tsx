import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPersonWithConfigMerged, getPersonsByGroupMerged } from '@/lib/persons';
import { getAllStoredProductsOrThrow, type StoredCategoryData } from '@/lib/product-store';
import { getAllVerdictsOrThrow } from '@/lib/judgment-store';
import { getPublishedWorksOrThrow } from '@/lib/work-store';
import { getPersonMeta } from '@/lib/person-meta';
import { getGroupMeta } from '@/lib/group-meta';
import { groupHref } from '@/lib/group-slug';
import { deduplicateProviders, isConfirmedVodAvailability, normalizeProviderName, getVodProviderDisplayInfo } from '@/lib/vod-dedup';
import { getWorkPublicUrl } from '@/lib/work-url';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import ProductTabList, { type ProductWithSection } from '@/components/ProductTabList';
import PersonCard from '@/components/PersonCard';
import WorksSection from '@/components/WorksSection';
import ProviderLogo from '@/components/ProviderLogo';
import PageViewTracker from '@/components/site/PageViewTracker';
import AffiliateSlot from '@/components/site/AffiliateSlot';
import PersonHero from '@/components/site/PersonHero';
import PersonQuickNav from '@/components/site/PersonQuickNav';
import StreamingNowSection from '@/components/site/StreamingNowSection';
import FeaturedProductsSection from '@/components/site/FeaturedProductsSection';
import type { ProductCategory, ApiResult, RakutenItem } from '@/types/rakuten';
import type { PersonMeta } from '@/app/api/admin/person-meta/route';
import { getGroupHeroGradient } from '@/lib/groupHeroGradient';
import { getAllDisplayOrders } from '@/lib/product-order-store';
import {
  sortProductsByPerson,
  calcDisplayTier,
  calcDisplayScore,
  type PersonDisplayContext,
} from '@/lib/product-display-score';
import type { WorkRecord } from '@/types/work';
import type { VodProvider } from '@/types/vod';
import { buildHeroBadgeTitles, buildInfoGenreList, normalizeTag } from '@/lib/person-display-tags';
import { ACTIVITY_LABEL } from '@/lib/person-badges';

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
function getStreamingProviders(work: WorkRecord, terminatedSlugs: Set<string>): VodProvider[] {
  return deduplicateProviders(
    (work.vodProviders ?? []).filter((p) => isConfirmedVodAvailability(p, terminatedSlugs)),
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
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';

  return {
    title,
    description,
    alternates: {
      canonical: `${siteOrigin}/person/${encodeURIComponent(name)}`,
    },
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

  const [storedResult, verdictsResult, worksResult, personMetaResult, groupMetaResult, displayOrdersResult, terminatedSlugs] =
    await Promise.allSettled([
      getAllStoredProductsOrThrow(person.name),
      getAllVerdictsOrThrow(person.name),
      getPublishedWorksOrThrow(person.name),
      getPersonMeta(person.name),
      person.group ? getGroupMeta(person.group) : Promise.resolve(null),
      getAllDisplayOrders(person.name),
      getInactiveProviderSlugs(),
    ]);

  const storedData: Partial<Record<ProductCategory, StoredCategoryData>> =
    storedResult.status === 'fulfilled' ? storedResult.value : {};
  const verdicts = verdictsResult.status === 'fulfilled' ? verdictsResult.value : {};
  const publishedWorks = worksResult.status === 'fulfilled' ? worksResult.value : [];
  const personMeta = personMetaResult.status === 'fulfilled' ? personMetaResult.value : null;
  const groupMeta = groupMetaResult.status === 'fulfilled' ? groupMetaResult.value : null;
  const displayOrders = displayOrdersResult.status === 'fulfilled' ? displayOrdersResult.value : {};
  const inactiveSlugs: Set<string> = terminatedSlugs.status === 'fulfilled' ? terminatedSlugs.value : new Set();
  const redisError =
    storedResult.status === 'rejected' ||
    worksResult.status === 'rejected' ||
    verdictsResult.status === 'rejected';

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
  // WorksSection（クライアント）へ渡す前に終了済みサービスを除去しておく
  const publishedWorksForClient = inactiveSlugs.size > 0
    ? publishedWorks.map((w) => ({
        ...w,
        vodProviders: (w.vodProviders ?? []).filter(
          (p) => !inactiveSlugs.has(normalizeProviderName(p.providerName ?? '')),
        ),
      }))
    : publishedWorks;

  const streamingWorks = publishedWorks.filter((w) => getStreamingProviders(w, inactiveSlugs).length > 0);
  const providerWorkMap = new Map<string, { logoPath?: string; works: WorkRecord[] }>();
  for (const work of streamingWorks) {
    for (const p of getStreamingProviders(work, inactiveSlugs)) {
      const providerKey = normalizeProviderName(p.providerName);
      if (!providerWorkMap.has(providerKey)) {
        providerWorkMap.set(providerKey, { logoPath: p.logoPath, works: [] });
      }
      providerWorkMap.get(providerKey)!.works.push(work);
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

  // groupPagePath はJSON-LD・プロフィール・パンくず等、複数箇所で使うため先に計算する
  // （groupMeta・person.group のみに依存し、以降の値には依存しないため安全に前倒しできる）
  const groupPagePath = person.group
    ? (groupMeta ? groupHref(groupMeta) : `/groups/${encodeURIComponent(person.group)}`)
    : null;

  // ── プロフィール情報行（クイックナビでの表示要否を先に判定する必要があるため
  //    レンダリング前に計算しておく。中身のロジック自体は変更していない） ──────
  const profileInfoRows: { label: string; value: ReactNode }[] = [];
  {
    const groupLink = personMeta?.currentGroupName || person.group || null;
    if (groupLink) {
      const href = groupLink === person.group && groupPagePath
        ? groupPagePath
        : `/groups/${encodeURIComponent(groupLink)}`;
      profileInfoRows.push({
        label: '所属',
        value: <Link href={href} className="theme-text-link">{groupLink}</Link>,
      });
    }

    if (personMeta?.generation) {
      profileInfoRows.push({ label: '期別', value: personMeta.generation });
    }

    if (personMeta?.activityStatus && personMeta.activityStatus !== 'unknown') {
      profileInfoRows.push({ label: '活動状況', value: ACTIVITY_LABEL[personMeta.activityStatus] });
    }

    if (person.config.reading) {
      profileInfoRows.push({ label: '読み', value: person.config.reading });
    }

    const genres = buildInfoGenreList({
      genre: person.genre,
      primaryGenre: personMeta?.primaryGenre,
      genres: personMeta?.genres,
    });
    if (genres.length > 0) {
      profileInfoRows.push({ label: 'ジャンル', value: genres.join(' / ') });
    }

    if (personMeta?.titles && personMeta.titles.length > 0) {
      profileInfoRows.push({ label: '肩書き', value: personMeta.titles.join(' / ') });
    }

    if (personMeta?.publicRoles && personMeta.publicRoles.length > 0) {
      profileInfoRows.push({ label: '役職', value: personMeta.publicRoles.join(' / ') });
    }

    if (personMeta?.joinedAt) {
      profileInfoRows.push({ label: '加入日', value: personMeta.joinedAt.slice(0, 7) });
    }

    if (personMeta?.leftAt) {
      const statusLabel = personMeta.activityStatus === 'withdrawn' ? '脱退日' : '卒業日';
      profileInfoRows.push({ label: statusLabel, value: personMeta.leftAt.slice(0, 7) });
    }

    if (personMeta?.formerGroupNames && personMeta.formerGroupNames.length > 0) {
      profileInfoRows.push({ label: '旧所属', value: personMeta.formerGroupNames.join(' / ') });
    }

    if (person.config.aliases && person.config.aliases.length > 0) {
      profileInfoRows.push({ label: '別名・愛称', value: person.config.aliases.join(' / ') });
    }

    if (personMeta?.awards && personMeta.awards.length > 0) {
      profileInfoRows.push({ label: '受賞歴', value: personMeta.awards.join(' / ') });
    }

    if (personMeta?.membershipNote) {
      profileInfoRows.push({ label: '備考', value: personMeta.membershipNote });
    }
  }
  const hasProfileInfo = profileInfoRows.length > 0;

  // ── FAQ ──
  const topProviders = providerGroups.slice(0, 3).map(([n]) => getVodProviderDisplayInfo(n).displayName);
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

  // ── ファーストビューの数字サマリー（配信中を最優先に表示） ──────────────────
  const heroStats = [
    { label: '配信中',     value: streamingWorks.length,  unit: '件', href: '#streaming-now' },
    { label: '出演作品',   value: publishedWorks.length,  unit: '件', href: '#works' },
    { label: '関連商品',   value: totalProductCount,      unit: '件', href: '#products' },
    { label: '配信サービス', value: providerWorkMap.size, unit: '社', href: '#vod' },
  ];

  // ── 数字付きクイックナビ（実際にそのセクションが表示される場合のみ掲載） ──────
  const quickNavItems = [
    hasVod && { label: '今すぐ見る', icon: '▶', count: streamingWorks.length, href: '#streaming-now' },
    hasWorks && { label: '出演作品', icon: '🎬', count: publishedWorks.length, href: '#works' },
    hasProducts && { label: '商品', icon: '🛍', count: totalProductCount, href: '#products' },
    hasProfileInfo && { label: 'プロフィール', icon: '👤', count: null, href: '#profile' },
  ].filter((v): v is { label: string; icon: string; count: number | null; href: string } => !!v);

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

        {/* ─── ファーストビュー ─── */}
        <PersonHero
          person={person}
          personMeta={personMeta}
          groupMeta={groupMeta}
          groupPagePath={groupPagePath}
          heroBackground={heroBackground}
          stats={heroStats}
        />

        {/* ─── 数字付きクイックナビ ─── */}
        {quickNavItems.length > 0 && <PersonQuickNav items={quickNavItems} />}

        {/* ─── メインコンテンツ ─── */}
        <div className="max-w-4xl mx-auto px-4 py-8 space-y-10">

          {/* ━━━ 今すぐ見られる作品 ━━━ */}
          <StreamingNowSection works={streamingWorks} terminatedSlugs={inactiveSlugs} />

          {/* ━━━ VODサービス比較 ━━━ */}
          {providerGroups.length > 0 && (
            <section id="vod" aria-labelledby="vod-heading">
              <div className="flex items-center gap-2 mb-4">
                <h2 id="vod-heading" className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>▶ 配信中の出演作品</h2>
                <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  🟢 {streamingWorks.length}件
                </span>
              </div>

              <div className="space-y-2.5">
                {providerGroups.map(([providerName, { logoPath, works: pWorks }]) => {
                  const pInfo = getVodProviderDisplayInfo(providerName);
                  return (
                  <details
                    key={providerName}
                    className="theme-card overflow-hidden"
                  >
                    <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors [list-style:none] [&::-webkit-details-marker]:hidden" style={{ background: 'var(--ds-surface)' }}>
                      <ProviderLogo providerName={providerName} logoPath={logoPath} size="md" />
                      <span className="font-semibold text-sm flex-1" style={{ color: 'var(--ds-text)' }}>
                        {pInfo.displayName}
                        {pInfo.badgeLabel && (
                          <span className="ml-1.5 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full align-middle">
                            {pInfo.badgeLabel}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex-shrink-0">
                        {pWorks.length}件
                      </span>
                    </summary>
                    <div className="px-4 py-3" style={{ borderTop: '1px solid var(--ds-border)' }}>
                      {/* サービス比較後に外部VODへ進むCTA。既存のAffiliateSlotをそのまま再利用し、
                          「今すぐ見られる作品」の各作品CTAと同じ work_provider スロットを参照する
                          （このスロットに実際のアフィリエイト登録があるサービスのみ表示される。
                          未登録サービスは何も表示されず、既存のfallbackも生成しない）。 */}
                      <AffiliateSlot vodService={normalizeProviderName(providerName)} slotKey="work_provider" className="mb-3" />
                      <div className="space-y-2">
                        {pWorks.slice(0, 8).map((work) => (
                          <Link
                            key={work.id}
                            href={getWorkPublicUrl({ workId: work.id, personName: work.personName }) ?? '#'}
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
                  );
                })}
              </div>
            </section>
          )}

          {/* ━━━ 関連商品ピックアップ（プレビュー） ━━━ */}
          <FeaturedProductsSection
            sectionResults={sectionResults}
            personSlug={name}
            totalProductCount={totalProductCount}
          />

          {/* ━━━ 関連商品 ━━━ */}
          <section id="products" aria-labelledby="products-heading">
            <div className="flex items-center gap-2 mb-5">
              <h2 id="products-heading" className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>🛍 関連商品</h2>
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
            <section id="works" aria-labelledby="works-heading">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h2 id="works-heading" className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>🎬 出演作品</h2>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--ds-primary-soft)', color: 'var(--ds-primary)' }}>
                    {publishedWorks.length}件
                  </span>
                </div>
                {hasVod && (
                  <a href="#vod" className="text-xs text-green-600 font-medium hover:underline flex items-center gap-1">
                    ▶ 配信中を見る
                  </a>
                )}
              </div>
              <WorksSection works={publishedWorksForClient} />
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

          {/* ━━━ プロフィール ━━━ */}
          {hasProfileInfo && (
            <section id="profile" aria-labelledby="profile-heading">
              <h2 id="profile-heading" className="text-base font-bold mb-4" style={{ color: 'var(--ds-text)' }}>プロフィール</h2>
              <div className="theme-card overflow-hidden">
                <dl className="divide-y" style={{ borderColor: 'var(--ds-border)' }}>
                  {profileInfoRows.map(({ label, value }) => (
                    <div
                      key={label}
                      className="grid grid-cols-[7rem_1fr] sm:grid-cols-[9rem_1fr] gap-3 px-4 py-3"
                      style={{ background: 'var(--ds-surface)' }}
                    >
                      <dt className="text-xs font-semibold self-start pt-0.5" style={{ color: 'var(--ds-muted)' }}>
                        {label}
                      </dt>
                      <dd className="text-sm font-medium" style={{ color: 'var(--ds-text)' }}>
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
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
