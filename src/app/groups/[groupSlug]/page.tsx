import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { getAllPersonsMerged } from '@/lib/persons';
import { getPublishedWorks } from '@/lib/work-store';
import { getAllStoredProducts, CATEGORIES } from '@/lib/product-store';
import { getAllVerdicts } from '@/lib/judgment-store';
import { deduplicateProviders, isConfirmedVodAvailability, normalizeProviderName } from '@/lib/vod-dedup';
import { getInactiveProviderSlugs } from '@/lib/provider-store';
import { getAllPersonMetas } from '@/lib/person-meta';
import { getAllGroupMetasOrThrow, getAllGroupMetas } from '@/lib/group-meta';
import { groupHref, groupHrefByName, resolveGroupFromSlug, resolveGroupName, canonicalGroupSlug, SLUG_TO_GROUP_NAME } from '@/lib/group-slug';
import RedisErrorBanner from '@/components/admin/RedisErrorBanner';
import PersonCard from '@/components/PersonCard';
import MemberSection from '@/components/site/MemberSection';
import type { GroupMemberCardData } from '@/components/site/GroupMemberCard';
import WorkCard from '@/components/WorkCard';
import ProviderLogo from '@/components/ProviderLogo';
import type { WorkRecord } from '@/types/work';
import type { RakutenItem } from '@/types/rakuten';
import type { ProductCategory, ActivityStatus } from '@/types/person';
import type { VodProvider } from '@/types/vod';
import type { PersonMeta } from '@/app/api/admin/person-meta/route';
import type { PersonWithConfig } from '@/types/person';
import type { GroupMeta } from '@/types/group';
import PageViewTracker from '@/components/site/PageViewTracker';
import { getGroupHeroGradient } from '@/lib/groupHeroGradient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ groupSlug: string }>;
}

// ─── 定数 ──────────────────────────────────────────────────────────────────────
const MAX_PRODUCTS_PER_SECTION = 12;
const MAX_WORKS_PER_PROVIDER = 6;

// ─── 活動状態 ──────────────────────────────────────────────────────────────────
const ACTIVITY_LABEL: Record<ActivityStatus, string> = {
  active: '現役',
  graduated: '卒業',
  withdrawn: '脱退',
  hiatus: '休止中',
  retired: '引退',
  unknown: '不明',
};
const ACTIVITY_BADGE_CLS: Record<ActivityStatus, string> = {
  active: 'bg-green-100 text-green-700',
  graduated: 'bg-blue-100 text-blue-700',
  withdrawn: 'bg-red-100 text-red-600',
  hiatus: 'bg-amber-100 text-amber-700',
  retired: 'bg-gray-200 text-gray-500',
  unknown: 'bg-gray-100 text-gray-400',
};

type EnrichedMember = PersonWithConfig & {
  meta: PersonMeta;
  effectiveStatus: ActivityStatus;
};

function toCardData(m: EnrichedMember): GroupMemberCardData {
  return {
    name: m.name,
    group: m.group,
    genre: m.genre,
    generation: m.meta.generation,
    activityStatus: m.effectiveStatus,
    leftAt: m.meta.leftAt,
  };
}

const GENRE_BADGE: Record<string, string> = {
  '坂道': 'bg-pink-100 text-pink-700',
  '芸人': 'bg-yellow-100 text-yellow-700',
  'テレビ': 'bg-blue-100 text-blue-700',
  'アーティスト': 'bg-purple-100 text-purple-700',
  '俳優': 'bg-green-100 text-green-700',
};

const PRODUCT_DISPLAY: Array<{
  label: string;
  icon: string;
  cats: ProductCategory[];
  usedKeywords: string[];
}> = [
  { label: '本・写真集', icon: '📷', cats: ['写真集', '本・雑誌'], usedKeywords: ['写真集', 'フォトブック', 'ムック'] },
  { label: 'CD',         icon: '💿', cats: ['CD'],           usedKeywords: ['CD', 'シングル', 'アルバム'] },
  { label: 'Blu-ray・DVD', icon: '📀', cats: ['Blu-ray・DVD'], usedKeywords: ['DVD', 'Blu-ray', 'ブルーレイ', 'ライブ', 'コンサート'] },
  { label: 'グッズ',     icon: '🎁', cats: ['グッズ'],        usedKeywords: ['グッズ', 'カレンダー', 'ポスター', 'トレカ'] },
];

// ─── ユーティリティ ────────────────────────────────────────────────────────────
function getPublicProviders(work: WorkRecord, terminatedSlugs: Set<string>): VodProvider[] {
  return deduplicateProviders(
    (work.vodProviders ?? []).filter((p) => isConfirmedVodAvailability(p, terminatedSlugs)),
  );
}

// ─── 作品コンパクトリンク ──────────────────────────────────────────────────────
function CompactWorkLink({ work }: { work: WorkRecord }) {
  const href = `/person/${encodeURIComponent(work.personName)}/work/${encodeURIComponent(work.id)}`;
  return (
    <Link href={href} className="flex items-center gap-2 p-2 rounded-lg hover:bg-indigo-50 transition-colors group">
      {work.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={work.posterUrl}
          alt={work.title}
          className="w-10 h-14 object-cover rounded-lg flex-shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-10 h-14 bg-gray-100 rounded-lg flex items-center justify-center text-gray-300 text-base flex-shrink-0">
          🎬
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-700 line-clamp-2 group-hover:text-indigo-600 transition-colors leading-tight">
          {work.title}
        </p>
        {work.releaseYear && (
          <p className="text-[10px] text-gray-400 mt-0.5">{work.releaseYear}年</p>
        )}
      </div>
    </Link>
  );
}

// ─── 商品カード ────────────────────────────────────────────────────────────────
function MiniProductCard({ product, used }: { product: RakutenItem; used?: boolean }) {
  return (
    <a
      href={product.affiliateUrl || product.itemUrl}
      target="_blank"
      rel="noopener noreferrer sponsored"
      className="mini-product-link overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all block"
      style={{
        background: 'var(--ds-surface)',
        border: `1px solid ${used ? '#fcd34d' : 'var(--ds-border)'}`,
        borderRadius: 'var(--ds-radius)',
      }}
    >
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.imageUrl}
          alt={product.title}
          className="w-full aspect-square object-contain p-1.5"
          style={{ background: '#f8f9fa' }}
          loading="lazy"
        />
      ) : (
        <div
          className="w-full aspect-square flex items-center justify-center text-2xl"
          style={{ background: '#f8f9fa', color: '#d1d5db' }}
        >
          🛒
        </div>
      )}
      <div className="p-2">
        {used && (
          <span className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
            中古
          </span>
        )}
        <p
          className="mini-product-name text-[11px] font-medium line-clamp-2 mt-1 transition-colors"
          style={{ color: 'var(--ds-text)' }}
        >
          {product.title.replace(/^【中古】\s*/, '')}
        </p>
        {product.price > 0 && (
          <p className="text-xs font-black mt-1" style={{ color: 'var(--ds-cta)' }}>
            ¥{product.price.toLocaleString()}
          </p>
        )}
      </div>
    </a>
  );
}

// ─── 改名通知ページ ────────────────────────────────────────────────────────────
function RenameNoticePage({
  groupName,
  renamedTo,
  renamedToHref,
  endedAt,
}: {
  groupName: string;
  renamedTo: string;
  renamedToHref: string;
  endedAt?: string;
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4">→</div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">{groupName}</h1>
        <p className="text-gray-500 mb-1">
          このグループは <strong className="text-slate-700">{renamedTo}</strong> に改名されました
        </p>
        {endedAt && (
          <p className="text-sm text-gray-400 mb-6">{endedAt}</p>
        )}
        <Link
          href={renamedToHref}
          className="inline-block px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
        >
          {renamedTo} のページへ →
        </Link>
      </div>
    </div>
  );
}

// ─── メタデータ ────────────────────────────────────────────────────────────────
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { groupSlug } = await params;
  const allGroupMetas = await getAllGroupMetas();
  const meta = resolveGroupFromSlug(groupSlug, allGroupMetas);
  // resolveGroupName: GroupMeta なし・slug 未設定でも固定マッピングでグループ名を解決
  const groupName = resolveGroupName(groupSlug, allGroupMetas) ?? decodeURIComponent(groupSlug);

  const allPersons = await getAllPersonsMerged();
  const memberCount = allPersons.filter((p) => p.group === groupName).length;
  if (memberCount === 0) return {};

  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';
  // meta なしでも: groupSlug が固定マッピングにあればそれが canonical slug、なければエンコード
  const slug = meta
    ? canonicalGroupSlug(meta)
    : (SLUG_TO_GROUP_NAME[groupSlug] ? groupSlug : encodeURIComponent(groupName));

  const title = `${groupName} | メンバー・出演作品・グッズ・配信情報まとめ`;
  const description = `${groupName}のメンバー${memberCount}人の出演作品・配信中作品・写真集・CD・Blu-ray・グッズをまとめて掲載。楽天で購入・VODで視聴できます。`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    alternates: {
      canonical: `${siteOrigin}/groups/${slug}`,
    },
  };
}

// ─── ページ ────────────────────────────────────────────────────────────────────
export default async function GroupsPage({ params }: Props) {
  const { groupSlug } = await params;

  // ── GroupMeta 取得 ──
  let allGroupMetas: GroupMeta[] = [];
  let groupMetaRedisError = false;
  try {
    allGroupMetas = await getAllGroupMetasOrThrow();
  } catch {
    groupMetaRedisError = true;
  }

  // ── スラッグ解決 & canonical リダイレクト ──
  const resolvedMeta = resolveGroupFromSlug(groupSlug, allGroupMetas);

  if (resolvedMeta) {
    const canonical = canonicalGroupSlug(resolvedMeta);
    if (groupSlug !== canonical) {
      permanentRedirect(`/groups/${canonical}`);
    }
  }

  // resolveGroupName: GroupMeta.slug 未設定でも固定マッピングでグループ名を解決
  const groupName = resolvedMeta?.groupName
    ?? resolveGroupName(groupSlug, allGroupMetas)
    ?? decodeURIComponent(groupSlug);
  const groupMeta: GroupMeta | null = resolvedMeta ?? null;

  // ── メンバー取得 ──
  const allPersons = await getAllPersonsMerged();
  const members = allPersons.filter((p) => p.group === groupName);

  void groupMetaRedisError;

  if (members.length === 0) {
    if (groupMetaRedisError && !resolvedMeta) {
      return (
        <RedisErrorBanner
          title="グループ情報を一時的に取得できません"
          detail="Redisのリクエスト制限または接続エラーにより、グループの改名・解散情報を確認できませんでした。データは保持されています。"
        />
      );
    }
    const successorGroup = allGroupMetas.find(
      (g) => (g.formerNames ?? []).includes(groupName) || g.renamedFrom === groupName,
    );
    if (groupMeta?.activityStatus === 'renamed' && groupMeta.renamedTo) {
      return (
        <RenameNoticePage
          groupName={groupName}
          renamedTo={groupMeta.renamedTo}
          renamedToHref={groupHrefByName(groupMeta.renamedTo, allGroupMetas)}
          endedAt={groupMeta.endedAt}
        />
      );
    }
    if (successorGroup) {
      return (
        <RenameNoticePage
          groupName={groupName}
          renamedTo={successorGroup.groupName}
          renamedToHref={groupHref(successorGroup)}
        />
      );
    }
    notFound();
  }

  const genre = members[0]?.genre;

  // ── 全メンバーのデータ + PersonMeta + 終了済みVODスラグ を並列取得 ──
  const [memberDataList, personMetaMap, terminatedSlugs] = await Promise.all([
    Promise.all(
      members.map(async (m) => {
        const [works, storedProducts, verdicts] = await Promise.all([
          getPublishedWorks(m.name),
          getAllStoredProducts(m.name),
          getAllVerdicts(m.name),
        ]);
        return { member: m, works, storedProducts, verdicts };
      }),
    ),
    getAllPersonMetas().catch(() => ({} as Record<string, PersonMeta>)),
    getInactiveProviderSlugs(),
  ]);

  // ── メンバー分類 ──────────────────────────────────────────────────────────────
  const enrichedMembers: EnrichedMember[] = members.map((m) => {
    const meta = personMetaMap[m.name] ?? {};
    const effectiveStatus: ActivityStatus = meta.activityStatus ?? 'active';
    return { ...m, meta, effectiveStatus };
  });

  const formerMembersFromOther: EnrichedMember[] = allPersons
    .filter((p) => p.group !== groupName)
    .filter((p) => (personMetaMap[p.name]?.formerGroupNames ?? []).includes(groupName))
    .map((p) => ({
      ...p,
      meta: personMetaMap[p.name] ?? {},
      effectiveStatus: (personMetaMap[p.name]?.activityStatus ?? 'unknown') as ActivityStatus,
    }));

  const activeMembers = enrichedMembers.filter(
    (m) => m.effectiveStatus === 'active' || m.effectiveStatus === 'hiatus',
  );
  const formerMembersInGroup = enrichedMembers.filter((m) =>
    ['graduated', 'withdrawn', 'retired'].includes(m.effectiveStatus),
  );
  const allFormerMembers: EnrichedMember[] = [...formerMembersInGroup, ...formerMembersFromOther];

  const hasStatusData = enrichedMembers.some((m) => m.meta.activityStatus);
  const hasGenerationData = [...enrichedMembers, ...formerMembersFromOther].some(
    (m) => m.meta.generation,
  );

  const generationMap = new Map<string, EnrichedMember[]>();
  for (const m of [...enrichedMembers, ...formerMembersFromOther]) {
    const gen = m.meta.generation ?? '未設定';
    if (!generationMap.has(gen)) generationMap.set(gen, []);
    generationMap.get(gen)!.push(m);
  }
  const generationGroups = [...generationMap.entries()].sort(([a], [b]) => {
    if (a === '未設定') return 1;
    if (b === '未設定') return -1;
    return parseInt(a) - parseInt(b);
  });

  const allTimeMembers: EnrichedMember[] = [...enrichedMembers, ...formerMembersFromOther];

  // ── 作品を workId で重複排除 ──
  const workMap = new Map<string, WorkRecord>();
  for (const { works } of memberDataList) {
    for (const w of works) {
      if (!workMap.has(w.id)) workMap.set(w.id, w);
    }
  }
  const allWorks = [...workMap.values()].sort(
    (a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0),
  );

  const workProviders = new Map<string, VodProvider[]>();
  for (const work of allWorks) {
    workProviders.set(work.id, getPublicProviders(work, terminatedSlugs));
  }

  const streamingWorks = allWorks.filter((w) =>
    (workProviders.get(w.id) ?? []).some((p) => ['flatrate', 'free', 'ads'].includes(p.type)),
  );

  // WorkCard（クライアント）へ渡す前に終了済みサービスを除去
  const streamingWorksForClient = terminatedSlugs.size > 0
    ? streamingWorks.map((w) => ({
        ...w,
        vodProviders: (w.vodProviders ?? []).filter(
          (p) => !terminatedSlugs.has(normalizeProviderName(p.providerName ?? '')),
        ),
      }))
    : streamingWorks;

  const decadeMap = new Map<string, WorkRecord[]>();
  for (const work of allWorks) {
    const year = work.releaseYear;
    const key = year ? `${Math.floor(year / 10) * 10}年代` : '年代不明';
    if (!decadeMap.has(key)) decadeMap.set(key, []);
    decadeMap.get(key)!.push(work);
  }
  const decades = [...decadeMap.entries()].sort(([a], [b]) => {
    if (a === '年代不明') return 1;
    if (b === '年代不明') return -1;
    return parseInt(b) - parseInt(a);
  });

  const movieWorks = allWorks.filter((w) => w.type === 'movie');
  const tvWorks = allWorks.filter((w) => w.type === 'tv');

  const providerWorkMap = new Map<string, { logoPath?: string; works: WorkRecord[] }>();
  for (const work of allWorks) {
    for (const p of workProviders.get(work.id) ?? []) {
      if (!['flatrate', 'free', 'ads'].includes(p.type)) continue;
      if (!providerWorkMap.has(p.providerName)) {
        providerWorkMap.set(p.providerName, { logoPath: p.logoPath, works: [] });
      }
      providerWorkMap.get(p.providerName)!.works.push(work);
    }
  }
  const providerGroups = [...providerWorkMap.entries()].sort(([a], [b]) =>
    a.localeCompare(b, 'ja'),
  );

  // ── 商品集約 ──
  const newProductMap = new Map<string, RakutenItem>();
  const usedProductMap = new Map<string, RakutenItem>();

  for (const { storedProducts, verdicts } of memberDataList) {
    for (const cat of CATEGORIES) {
      const catData = storedProducts[cat];
      if (!catData) continue;
      for (const p of catData.products) {
        const v = verdicts[p.id];
        if (!v || v.verdict !== 'related') continue;
        if (v.source !== 'manual' && v.score < 70) continue;
        if (p.isUsed || cat === '中古') {
          if (!usedProductMap.has(p.id)) usedProductMap.set(p.id, p);
        } else {
          if (!newProductMap.has(p.id)) newProductMap.set(p.id, p);
        }
      }
    }
  }

  const productSections = PRODUCT_DISPLAY.map(({ label, icon, cats, usedKeywords }) => {
    const newProducts = [...newProductMap.values()]
      .filter((p) => cats.includes(p.category))
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    const usedProducts = [...usedProductMap.values()]
      .filter((p) => {
        const t = p.title.replace(/^【中古】\s*/, '');
        return usedKeywords.some((kw) => t.includes(kw));
      })
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

    return { label, icon, newProducts, usedProducts };
  });

  const totalProductCount = newProductMap.size + usedProductMap.size;

  // ── 関連グループ ──
  const allGroups = [...new Set(allPersons.map((p) => p.group).filter(Boolean))];
  const relatedGroupNames = allGroups.filter((g) => {
    if (g === groupName) return false;
    return allPersons.filter((p) => p.group === g).some((p) => p.genre === genre);
  });

  // ── FAQ ──
  const topProviders = providerGroups.slice(0, 3).map(([name]) => name);
  const faqItems = [
    {
      q: `${groupName}のメンバーは何人ですか？`,
      a: hasStatusData && allFormerMembers.length > 0
        ? `現役メンバーは${activeMembers.length}人です。卒業・脱退メンバーを含めた歴代メンバーは${allTimeMembers.length}人います。`
        : `${members.length}人のメンバーが登録されています。`,
    },
    {
      q: `${groupName}はどこで視聴できますか？`,
      a: streamingWorks.length > 0
        ? `${streamingWorks.length}件の出演作品が配信中です。${topProviders.length > 0 ? `${topProviders.join('・')}などで視聴できます。` : ''}`
        : '現在、配信情報を確認中です。各VODサービスで検索してみてください。',
    },
    {
      q: `${groupName}の写真集・グッズはどこで買えますか？`,
      a: totalProductCount > 0
        ? `このページから楽天市場・楽天ブックスで${totalProductCount}件の関連商品を購入できます。写真集・CD・Blu-ray・グッズなどを掲載しています。`
        : '楽天市場・楽天ブックスで関連商品を検索できます。',
    },
  ];

  // ── JSON-LD ──
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';
  const slug = groupMeta
    ? canonicalGroupSlug(groupMeta)
    : (SLUG_TO_GROUP_NAME[groupSlug] ? groupSlug : encodeURIComponent(groupName));
  const groupUrl = `${siteOrigin}/groups/${slug}`;

  const orgJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: groupName,
    url: groupUrl,
    member: members.map((m) => ({
      '@type': 'Person',
      name: m.name,
      url: `${siteOrigin}/person/${encodeURIComponent(m.name)}`,
    })),
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: siteOrigin },
      { '@type': 'ListItem', position: 2, name: groupName, item: groupUrl },
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

  const heroBackground = getGroupHeroGradient(groupName, genre);
  const badge = GENRE_BADGE[genre] ?? 'bg-gray-100 text-gray-600';

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <PageViewTracker entity="group" slug={groupSlug} />

      <div className="page-bg">

        {/* パンくずリスト */}
        <nav aria-label="パンくずリスト" className="breadcrumb-bar">
          <div className="max-w-4xl mx-auto px-4 py-2.5 flex items-center gap-1.5 text-xs" style={{ color: 'var(--ds-muted)' }}>
            <Link href="/" className="theme-text-link">ホーム</Link>
            <span style={{ opacity: 0.4 }}>›</span>
            <span className="font-medium" style={{ color: 'var(--ds-text)' }}>{groupName}</span>
          </div>
        </nav>

        {/* ヒーロー */}
        <div className="py-10 px-4" style={{ background: heroBackground }}>
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-white text-3xl font-black flex-shrink-0 select-none">
                {groupName[0]}
              </div>
              <div>
                <h1 className="text-3xl font-black text-white">{groupName}</h1>
                <span className={`inline-block mt-1.5 text-xs px-3 py-1 rounded-full font-bold ${badge}`}>
                  {genre}
                </span>
                {groupMeta?.note && (
                  <p className="text-white/70 text-sm mt-2 leading-relaxed max-w-sm">
                    {groupMeta.note}
                  </p>
                )}
              </div>
            </div>

            {/* 統計バー */}
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                {
                  label: hasStatusData ? '現役メンバー' : 'メンバー',
                  value: hasStatusData ? activeMembers.length : members.length,
                  unit: '人',
                },
                {
                  label: '卒業・脱退',
                  value: hasStatusData ? allFormerMembers.length : 0,
                  unit: '人',
                  hidden: !hasStatusData,
                },
                { label: '出演作品', value: allWorks.length, unit: '件' },
                { label: '関連商品', value: totalProductCount, unit: '件' },
              ].map(({ label, value, unit, hidden }) => (
                hidden ? null :
                <div key={label} className="bg-white/15 backdrop-blur-sm rounded-xl px-3 py-2.5 text-center">
                  <p className="text-white/70 text-[11px]">{label}</p>
                  {value > 0 ? (
                    <p className="text-white font-black text-xl mt-0.5 leading-none">
                      {value.toLocaleString()}
                      <span className="text-sm font-medium ml-0.5">{unit}</span>
                    </p>
                  ) : (
                    <p className="text-white/50 text-sm mt-1">なし</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 py-8 space-y-10">

          {/* ━━━ 改名・解散バナー ━━━ */}
          {groupMeta?.activityStatus === 'renamed' && groupMeta.renamedTo && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
              <span className="text-blue-700 text-sm">
                このグループは <strong>{groupMeta.renamedTo}</strong> に改名されました
                {groupMeta.endedAt && ` （${groupMeta.endedAt}）`}
              </span>
              <Link
                href={groupHrefByName(groupMeta.renamedTo, allGroupMetas)}
                className="text-sm font-semibold text-blue-600 hover:underline ml-auto"
              >
                {groupMeta.renamedTo} のページへ →
              </Link>
            </div>
          )}
          {groupMeta?.activityStatus === 'disbanded' && (
            <div className="bg-gray-100 border border-gray-200 rounded-xl px-4 py-3">
              <span className="text-gray-600 text-sm">
                このグループは解散しました
                {groupMeta.endedAt && ` （${groupMeta.endedAt}）`}
              </span>
              {groupMeta.note && (
                <span className="text-gray-400 text-xs ml-2">{groupMeta.note}</span>
              )}
            </div>
          )}
          {groupMeta?.renamedFrom && (
            <div className="bg-white border border-gray-100 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm text-gray-500">
              <span className="text-gray-400 text-xs">旧グループ名:</span>
              <span className="font-medium text-slate-600">{groupMeta.renamedFrom}</span>
              {(groupMeta.formerNames ?? []).filter((n) => n !== groupMeta.renamedFrom).map((n) => (
                <span key={n} className="font-medium text-slate-600">/ {n}</span>
              ))}
            </div>
          )}

          {/* ━━━ 1. メンバー ━━━ */}
          <section className="space-y-8">

            {hasStatusData && allFormerMembers.length > 0 ? (
              <MemberSection
                title="現役メンバー"
                members={activeMembers.map(toCardData)}
              />
            ) : (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>メンバー一覧</h2>
                  <span className="text-xs" style={{ color: 'var(--ds-muted)' }}>{members.length}人</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {members.map((m) => (
                    <PersonCard key={m.name} person={m} />
                  ))}
                </div>
              </div>
            )}

            {allFormerMembers.length > 0 && (
              <MemberSection
                title="卒業・脱退メンバー"
                members={allFormerMembers.map(toCardData)}
              />
            )}

            {hasGenerationData && (
              <details className="theme-card overflow-hidden">
                <summary className="flex items-center justify-between px-4 py-3 cursor-pointer transition-colors [list-style:none] [&::-webkit-details-marker]:hidden" style={{ background: 'var(--ds-surface)' }}>
                  <span className="font-semibold text-sm" style={{ color: 'var(--ds-text)' }}>期別メンバー</span>
                  <span className="text-xs" style={{ color: 'var(--ds-muted)' }}>{generationGroups.length}期</span>
                </summary>
                <div className="p-4 space-y-4" style={{ borderTop: '1px solid var(--ds-border)' }}>
                  {generationGroups.map(([gen, genMembers]) => (
                    <div key={gen}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--ds-primary-soft)', color: 'var(--ds-primary)' }}>
                          {gen}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--ds-muted)' }}>{genMembers.length}人</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {genMembers.map((m) => (
                          <Link
                            key={m.name}
                            href={`/person/${encodeURIComponent(m.name)}`}
                            className="theme-group-chip flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
                            style={{ textDecoration: 'none' }}
                          >
                            {m.name}
                            {m.effectiveStatus !== 'active' && (
                              <span className={`text-[9px] px-1 py-0.5 rounded-full ${ACTIVITY_BADGE_CLS[m.effectiveStatus]}`}>
                                {ACTIVITY_LABEL[m.effectiveStatus]}
                              </span>
                            )}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}

          </section>

          {/* ━━━ 2. 配信中の出演作品 ━━━ */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-base font-bold" style={{ color: 'var(--ds-text)' }}>配信中の出演作品</h2>
              {streamingWorks.length > 0 && (
                <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  🟢 {streamingWorks.length}件
                </span>
              )}
            </div>
            {streamingWorks.length > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {streamingWorksForClient.slice(0, 12).map((work) => (
                    <WorkCard key={work.id} work={work} />
                  ))}
                </div>
                {streamingWorks.length > 12 && (
                  <p className="text-xs text-center mt-3" style={{ color: 'var(--ds-muted)' }}>
                    他 {streamingWorks.length - 12}件の配信中作品あり
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm px-4 py-3 rounded-xl" style={{ color: 'var(--ds-muted)', background: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}>
                現在、配信情報を確認中です
              </p>
            )}
          </section>

          {/* ━━━ 3. 年代別作品 ━━━ */}
          {allWorks.length > 0 && (
            <section>
              <h2 className="text-base font-bold mb-4" style={{ color: 'var(--ds-text)' }}>年代別作品</h2>
              <div className="space-y-2.5">
                {decades.map(([decade, works], idx) => (
                  <details
                    key={decade}
                    open={idx === 0}
                    className="theme-card overflow-hidden"
                  >
                    <summary className="flex items-center justify-between px-4 py-3 cursor-pointer transition-colors [list-style:none] [&::-webkit-details-marker]:hidden">
                      <span className="font-semibold text-sm" style={{ color: 'var(--ds-text)' }}>{decade}</span>
                      <span className="text-xs" style={{ color: 'var(--ds-muted)' }}>{works.length}件</span>
                    </summary>
                    <div className="p-4" style={{ borderTop: '1px solid var(--ds-border)' }}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {works.map((work) => (
                          <CompactWorkLink key={work.id} work={work} />
                        ))}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* ━━━ 4. ジャンル別 ━━━ */}
          {allWorks.length > 0 && (
            <section>
              <h2 className="text-base font-bold mb-4" style={{ color: 'var(--ds-text)' }}>映画・ドラマ別</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { label: '映画', icon: '🎬', works: movieWorks },
                  { label: 'ドラマ・TV', icon: '📺', works: tvWorks },
                ].map(({ label, icon, works: typeWorks }) => (
                  <details
                    key={label}
                    className="theme-card overflow-hidden"
                  >
                    <summary className="flex items-center justify-between px-4 py-3 cursor-pointer transition-colors [list-style:none] [&::-webkit-details-marker]:hidden">
                      <span className="font-semibold text-sm" style={{ color: 'var(--ds-text)' }}>
                        {icon} {label}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--ds-muted)' }}>{typeWorks.length}件</span>
                    </summary>
                    <div className="p-4" style={{ borderTop: '1px solid var(--ds-border)' }}>
                      {typeWorks.length > 0 ? (
                        <>
                          <div className="grid grid-cols-1 gap-1">
                            {typeWorks.slice(0, 10).map((work) => (
                              <CompactWorkLink key={work.id} work={work} />
                            ))}
                          </div>
                          {typeWorks.length > 10 && (
                            <p className="text-xs text-center mt-2" style={{ color: 'var(--ds-muted)' }}>
                              他 {typeWorks.length - 10}件
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs" style={{ color: 'var(--ds-muted)' }}>出演作品を整理中です</p>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* ━━━ 5. 配信サービス別作品 ━━━ */}
          {providerGroups.length > 0 && (
            <section>
              <h2 className="text-base font-bold mb-4" style={{ color: 'var(--ds-text)' }}>配信サービス別作品</h2>
              <div className="space-y-2.5">
                {providerGroups.map(([providerName, { logoPath, works: pWorks }]) => (
                  <details
                    key={providerName}
                    className="theme-card overflow-hidden"
                  >
                    <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors [list-style:none] [&::-webkit-details-marker]:hidden">
                      <ProviderLogo
                        providerName={providerName}
                        logoPath={logoPath}
                        size="md"
                      />
                      <span className="font-semibold text-sm flex-1" style={{ color: 'var(--ds-text)' }}>
                        {providerName}
                      </span>
                      <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                        {pWorks.length}件
                      </span>
                    </summary>
                    <div className="p-4" style={{ borderTop: '1px solid var(--ds-border)' }}>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                        {pWorks.slice(0, MAX_WORKS_PER_PROVIDER).map((work) => (
                          <CompactWorkLink key={work.id} work={work} />
                        ))}
                      </div>
                      {pWorks.length > MAX_WORKS_PER_PROVIDER && (
                        <p className="text-xs text-center mt-2" style={{ color: 'var(--ds-muted)' }}>
                          他 {pWorks.length - MAX_WORKS_PER_PROVIDER}件
                        </p>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* ━━━ 6. 関連商品 ━━━ */}
          <section>
            <h2 className="text-base font-bold mb-4" style={{ color: 'var(--ds-text)' }}>関連商品</h2>
            {productSections.some((s) => s.newProducts.length > 0 || s.usedProducts.length > 0) ? (
              <div className="space-y-7">
                {productSections.map(({ label, icon, newProducts, usedProducts }) => {
                  if (newProducts.length === 0 && usedProducts.length === 0) return null;
                  const totalCount = newProducts.length + usedProducts.length;
                  const maxNew = MAX_PRODUCTS_PER_SECTION;
                  const displayNew = newProducts.slice(0, maxNew);
                  const remaining = maxNew - displayNew.length;
                  const displayUsed = usedProducts.slice(0, remaining);
                  const displayed = displayNew.length + displayUsed.length;

                  return (
                    <div key={label}>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--ds-text)' }}>
                          {icon} {label}
                        </h3>
                        <span className="text-xs" style={{ color: 'var(--ds-muted)' }}>{totalCount}件</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {displayNew.map((p) => (
                          <MiniProductCard key={p.id} product={p} />
                        ))}
                        {displayUsed.map((p) => (
                          <MiniProductCard key={p.id} product={p} used />
                        ))}
                      </div>
                      {totalCount > displayed && (
                        <p className="text-xs text-center mt-2" style={{ color: 'var(--ds-muted)' }}>
                          他 {totalCount - displayed}件
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm px-4 py-3 rounded-xl" style={{ color: 'var(--ds-muted)', background: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}>
                関連商品は確認中です
              </p>
            )}
          </section>

          {/* ━━━ 7. 関連グループ ━━━ */}
          {relatedGroupNames.length > 0 && (
            <section>
              <h2 className="text-base font-bold mb-4" style={{ color: 'var(--ds-text)' }}>関連グループ</h2>
              <div className="flex flex-wrap gap-2.5">
                {relatedGroupNames.map((g) => (
                  <Link
                    key={g}
                    href={groupHrefByName(g, allGroupMetas)}
                    className="theme-group-chip flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium shadow-sm"
                    style={{ textDecoration: 'none', minHeight: '44px' }}
                  >
                    {g}
                    <span className="text-xs" style={{ color: 'var(--ds-muted)', opacity: 0.5 }}>›</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ━━━ 8. FAQ ━━━ */}
          <section>
            <h2 className="text-base font-bold mb-4" style={{ color: 'var(--ds-text)' }}>よくある質問</h2>
            <div className="space-y-2">
              {faqItems.map(({ q, a }) => (
                <details
                  key={q}
                  className="theme-card overflow-hidden"
                >
                  <summary className="flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors [list-style:none] [&::-webkit-details-marker]:hidden" style={{ background: 'var(--ds-surface)' }}>
                    <span className="font-black text-sm flex-shrink-0 w-5 text-center" style={{ color: 'var(--ds-primary)' }}>Q</span>
                    <span className="font-semibold text-sm flex-1" style={{ color: 'var(--ds-text)' }}>{q}</span>
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--ds-muted)' }}>›</span>
                  </summary>
                  <div className="px-4 py-3.5" style={{ borderTop: '1px solid var(--ds-border)' }}>
                    <div className="flex gap-3">
                      <span className="text-emerald-500 font-black text-sm flex-shrink-0 w-5 text-center">A</span>
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
