import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAllPersonsMerged } from '@/lib/persons';
import { getPublishedWorks } from '@/lib/work-store';
import { getAllStoredProducts, CATEGORIES } from '@/lib/product-store';
import { getAllVerdicts } from '@/lib/judgment-store';
import { deduplicateProviders } from '@/lib/vod-dedup';
import { getRedis } from '@/lib/redis';
import { getAllGroupMetas } from '@/lib/group-meta';
import PersonCard from '@/components/PersonCard';
import WorkCard from '@/components/WorkCard';
import ProviderLogo from '@/components/ProviderLogo';
import type { WorkRecord } from '@/types/work';
import type { RakutenItem } from '@/types/rakuten';
import type { ProductCategory, ActivityStatus } from '@/types/person';
import type { VodProvider } from '@/types/vod';
import type { PersonMeta } from '@/app/api/admin/person-meta/route';
import type { PersonWithConfig } from '@/types/person';
import type { GroupMeta } from '@/types/group';

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

// ─── 卒業・脱退メンバー用コンパクトカード ─────────────────────────────────────
function FormerMemberChip({ member }: { member: EnrichedMember }) {
  const { meta, effectiveStatus } = member;
  return (
    <Link href={`/person/${encodeURIComponent(member.name)}`}>
      <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-100 rounded-xl hover:border-gray-300 transition-colors group">
        <span className="text-sm font-medium text-slate-600 group-hover:text-indigo-600 transition-colors">
          {member.name}
        </span>
        {meta.generation && (
          <span className="text-[10px] text-gray-400">{meta.generation}</span>
        )}
        {effectiveStatus !== 'active' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ACTIVITY_BADGE_CLS[effectiveStatus]}`}>
            {ACTIVITY_LABEL[effectiveStatus]}
          </span>
        )}
        {meta.leftAt && (
          <span className="text-[10px] text-gray-300">{meta.leftAt.slice(0, 7)}</span>
        )}
      </div>
    </Link>
  );
}

const GENRE_GRADIENT: Record<string, string> = {
  '坂道':       'from-pink-500 to-rose-600',
  '芸人':       'from-amber-500 to-orange-600',
  'テレビ':     'from-sky-500 to-blue-600',
  'アーティスト': 'from-violet-500 to-purple-700',
  '俳優':       'from-emerald-500 to-green-700',
};
const GENRE_BADGE: Record<string, string> = {
  '坂道':       'bg-pink-100 text-pink-700',
  '芸人':       'bg-yellow-100 text-yellow-700',
  'テレビ':     'bg-blue-100 text-blue-700',
  'アーティスト': 'bg-purple-100 text-purple-700',
  '俳優':       'bg-green-100 text-green-700',
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
function getPublicProviders(work: WorkRecord): VodProvider[] {
  return deduplicateProviders(
    (work.vodProviders ?? []).filter((p) => {
      const isAi = p.source === 'openai_supplement' || p.source === 'openai_web_search';
      return !isAi || p.confidence !== 'low';
    }),
  );
}

// ─── 作品コンパクトリンク（詳細ページへの内部リンク） ──────────────────────────
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

// ─── 商品カード（グループページ用） ────────────────────────────────────────────
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

// ─── メタデータ ────────────────────────────────────────────────────────────────
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { groupSlug } = await params;
  const groupName = decodeURIComponent(groupSlug);
  const allPersons = await getAllPersonsMerged();
  const members = allPersons.filter((p) => p.group === groupName);
  if (members.length === 0) return {};

  const memberCount = allPersons.filter((p) => p.group === groupName).length;
  const title = `${groupName} | メンバー・出演作品・グッズ・配信情報まとめ`;
  const description = `${groupName}のメンバー${memberCount}人の出演作品・配信中作品・写真集・CD・Blu-ray・グッズをまとめて掲載。楽天で購入・VODで視聴できます。`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
  };
}

// ─── 改名リダイレクトページ ────────────────────────────────────────────────────
function RenameNoticePage({
  groupName,
  renamedTo,
  endedAt,
}: {
  groupName: string;
  renamedTo: string;
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
          href={`/group/${encodeURIComponent(renamedTo)}`}
          className="inline-block px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
        >
          {renamedTo} のページへ →
        </Link>
      </div>
    </div>
  );
}

// ─── ページ ────────────────────────────────────────────────────────────────────
export default async function GroupPage({ params }: Props) {
  const { groupSlug } = await params;
  const groupName  = decodeURIComponent(groupSlug);
  const allPersons = await getAllPersonsMerged();
  const members    = allPersons.filter((p) => p.group === groupName);

  // GroupMeta を先に取得（改名/解散リダイレクトの判定に使用）
  const allGroupMetas = await getAllGroupMetas();
  const groupMeta: GroupMeta | null = allGroupMetas.find((g) => g.groupName === groupName) ?? null;

  if (members.length === 0) {
    // このグループ名が別グループの旧名として登録されているか確認
    const successorGroup = allGroupMetas.find(
      (g) => (g.formerNames ?? []).includes(groupName) || g.renamedFrom === groupName,
    );
    if (groupMeta?.activityStatus === 'renamed' && groupMeta.renamedTo) {
      return <RenameNoticePage groupName={groupName} renamedTo={groupMeta.renamedTo} endedAt={groupMeta.endedAt} />;
    }
    if (successorGroup) {
      return <RenameNoticePage groupName={groupName} renamedTo={successorGroup.groupName} />;
    }
    notFound();
  }

  const genre = members[0]?.genre;

  // ── 全メンバーのデータ + PersonMeta を並列取得 ──
  const [memberDataList, personMetaMap] = await Promise.all([
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
    (async (): Promise<Record<string, PersonMeta>> => {
      try {
        const redis = getRedis();
        if (!redis) return {};
        const raw = await redis.hgetall('admin:person-meta');
        if (!raw) return {};
        const map: Record<string, PersonMeta> = {};
        for (const [k, v] of Object.entries(raw)) {
          try { map[k] = (typeof v === 'string' ? JSON.parse(v) : v) as PersonMeta; } catch { /* skip */ }
        }
        return map;
      } catch { return {}; }
    })(),
  ]);

  // ── メンバー分類 ──────────────────────────────────────────────────────────────
  const enrichedMembers: EnrichedMember[] = members.map((m) => {
    const meta = personMetaMap[m.name] ?? {};
    const effectiveStatus: ActivityStatus = meta.activityStatus ?? 'active';
    return { ...m, meta, effectiveStatus };
  });

  // 別グループ所属だが formerGroupNames にこのグループが含まれる元メンバー
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

  // 期別グループ（数値キー順 → 未設定を末尾）
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

  // 歴代メンバー（現役 + 卒業/脱退 = 全員）
  const allTimeMembers: EnrichedMember[] = [...enrichedMembers, ...formerMembersFromOther];

  // ── 作品を workId で重複排除（最初の出現を保持）──
  const workMap = new Map<string, WorkRecord>();
  for (const { works } of memberDataList) {
    for (const w of works) {
      if (!workMap.has(w.id)) workMap.set(w.id, w);
    }
  }
  const allWorks = [...workMap.values()].sort(
    (a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0),
  );

  // ── 各作品の公開 VOD プロバイダーを計算 ──
  const workProviders = new Map<string, VodProvider[]>();
  for (const work of allWorks) {
    workProviders.set(work.id, getPublicProviders(work));
  }

  // ── 配信中の作品 ──
  const streamingWorks = allWorks.filter((w) =>
    (workProviders.get(w.id) ?? []).some((p) => ['flatrate', 'free', 'ads'].includes(p.type)),
  );

  // ── 年代別 ──
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

  // ── タイプ別（映画 / ドラマ）──
  const movieWorks = allWorks.filter((w) => w.type === 'movie');
  const tvWorks = allWorks.filter((w) => w.type === 'tv');

  // ── 配信サービス別（見放題・無料のみ）──
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

  // ── 商品を全メンバーから集約・重複排除 ──
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

  // ── 商品セクション別整形 ──
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

  // ── 関連グループ（同ジャンル・別グループ）──
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
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.vercel.app';
  const groupUrl = `${siteOrigin}/group/${encodeURIComponent(groupName)}`;

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

  const gradient = GENRE_GRADIENT[genre] ?? 'from-indigo-500 to-indigo-700';
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

      <div className="min-h-screen bg-gray-50">

        {/* パンくずリスト */}
        <nav aria-label="パンくずリスト" className="bg-white border-b border-gray-200">
          <div className="max-w-4xl mx-auto px-4 py-2.5 flex items-center gap-1.5 text-xs text-gray-500">
            <Link href="/" className="hover:text-indigo-600 transition-colors">ホーム</Link>
            <span className="text-gray-300">›</span>
            <span className="text-slate-700 font-medium">{groupName}</span>
          </div>
        </nav>

        {/* ヒーロー */}
        <div className={`bg-gradient-to-br ${gradient} py-10 px-4`}>
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
                  sub: hasStatusData && allFormerMembers.length > 0
                    ? `卒業 ${allFormerMembers.length}人`
                    : undefined,
                },
                { label: '出演作品', value: allWorks.length, unit: '件' },
                { label: '配信中',   value: streamingWorks.length, unit: '件' },
                { label: '関連商品', value: totalProductCount, unit: '件' },
              ].map(({ label, value, unit, sub }) => (
                <div key={label} className="bg-white/15 backdrop-blur-sm rounded-xl px-3 py-2.5 text-center">
                  <p className="text-white/70 text-[11px]">{label}</p>
                  {value > 0 ? (
                    <p className="text-white font-black text-xl mt-0.5 leading-none">
                      {value.toLocaleString()}
                      <span className="text-sm font-medium ml-0.5">{unit}</span>
                    </p>
                  ) : (
                    <p className="text-white/50 text-sm mt-1">確認中</p>
                  )}
                  {sub && (
                    <p className="text-white/50 text-[10px] mt-0.5">{sub}</p>
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
                href={`/group/${encodeURIComponent(groupMeta.renamedTo)}`}
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
          <section className="space-y-5">

            {/* 現役メンバー（または全メンバー一覧） */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-800">
                  {hasStatusData && allFormerMembers.length > 0 ? '現役メンバー' : 'メンバー一覧'}
                </h2>
                <span className="text-xs text-gray-400">
                  {hasStatusData && allFormerMembers.length > 0 ? activeMembers.length : members.length}人
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {(hasStatusData && allFormerMembers.length > 0 ? activeMembers : members).map((m) => (
                  <PersonCard key={m.name} person={m} />
                ))}
              </div>
            </div>

            {/* 卒業・脱退メンバー */}
            {allFormerMembers.length > 0 && (
              <details className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors [list-style:none] [&::-webkit-details-marker]:hidden">
                  <span className="font-semibold text-slate-700 text-sm">卒業・脱退メンバー</span>
                  <span className="text-xs text-gray-400">{allFormerMembers.length}人</span>
                </summary>
                <div className="border-t border-gray-50 p-4">
                  <div className="flex flex-wrap gap-2">
                    {allFormerMembers.map((m) => (
                      <FormerMemberChip key={m.name} member={m} />
                    ))}
                  </div>
                </div>
              </details>
            )}

            {/* 期別メンバー */}
            {hasGenerationData && (
              <details className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors [list-style:none] [&::-webkit-details-marker]:hidden">
                  <span className="font-semibold text-slate-700 text-sm">期別メンバー</span>
                  <span className="text-xs text-gray-400">{generationGroups.length}期</span>
                </summary>
                <div className="border-t border-gray-50 p-4 space-y-4">
                  {generationGroups.map(([gen, genMembers]) => (
                    <div key={gen}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                          {gen}
                        </span>
                        <span className="text-xs text-gray-400">{genMembers.length}人</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {genMembers.map((m) => (
                          <Link
                            key={m.name}
                            href={`/person/${encodeURIComponent(m.name)}`}
                            className="flex items-center gap-1 px-2.5 py-1 bg-gray-50 hover:bg-indigo-50 border border-gray-100 hover:border-indigo-200 rounded-lg text-xs font-medium text-slate-700 hover:text-indigo-600 transition-colors"
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

            {/* 歴代メンバー（卒業/脱退メンバーが存在する場合のみ） */}
            {allFormerMembers.length > 0 && (
              <details className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
                <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors [list-style:none] [&::-webkit-details-marker]:hidden">
                  <span className="font-semibold text-slate-700 text-sm">歴代メンバー</span>
                  <span className="text-xs text-gray-400">全{allTimeMembers.length}人</span>
                </summary>
                <div className="border-t border-gray-50 p-4">
                  <div className="flex flex-wrap gap-1.5">
                    {allTimeMembers.map((m) => (
                      <Link
                        key={m.name}
                        href={`/person/${encodeURIComponent(m.name)}`}
                        className="flex items-center gap-1 px-2.5 py-1 bg-gray-50 hover:bg-indigo-50 border border-gray-100 hover:border-indigo-200 rounded-lg text-xs font-medium text-slate-700 hover:text-indigo-600 transition-colors"
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
              </details>
            )}

          </section>

          {/* ━━━ 2. 配信中の出演作品 ━━━ */}
          <section>
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-base font-bold text-slate-800">配信中の出演作品</h2>
              {streamingWorks.length > 0 && (
                <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  🟢 {streamingWorks.length}件
                </span>
              )}
            </div>
            {streamingWorks.length > 0 ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {streamingWorks.slice(0, 12).map((work) => (
                    <WorkCard key={work.id} work={work} />
                  ))}
                </div>
                {streamingWorks.length > 12 && (
                  <p className="text-xs text-gray-400 text-center mt-3">
                    他 {streamingWorks.length - 12}件の配信中作品あり
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500 bg-white rounded-xl border border-gray-100 px-4 py-3">
                現在、配信情報を確認中です
              </p>
            )}
          </section>

          {/* ━━━ 3. 年代別作品 ━━━ */}
          {allWorks.length > 0 && (
            <section>
              <h2 className="text-base font-bold text-slate-800 mb-4">年代別作品</h2>
              <div className="space-y-2.5">
                {decades.map(([decade, works], idx) => (
                  <details
                    key={decade}
                    open={idx === 0}
                    className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
                  >
                    <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors [list-style:none] [&::-webkit-details-marker]:hidden">
                      <span className="font-semibold text-slate-700 text-sm">{decade}</span>
                      <span className="text-xs text-gray-400">{works.length}件</span>
                    </summary>
                    <div className="border-t border-gray-50 p-4">
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

          {/* ━━━ 4. ジャンル別（映画 / ドラマ）━━━ */}
          {allWorks.length > 0 && (
            <section>
              <h2 className="text-base font-bold text-slate-800 mb-4">映画・ドラマ別</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { label: '映画', icon: '🎬', works: movieWorks },
                  { label: 'ドラマ・TV', icon: '📺', works: tvWorks },
                ].map(({ label, icon, works: typeWorks }) => (
                  <details
                    key={label}
                    className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
                  >
                    <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors [list-style:none] [&::-webkit-details-marker]:hidden">
                      <span className="font-semibold text-slate-700 text-sm">
                        {icon} {label}
                      </span>
                      <span className="text-xs text-gray-400">{typeWorks.length}件</span>
                    </summary>
                    <div className="border-t border-gray-50 p-4">
                      {typeWorks.length > 0 ? (
                        <>
                          <div className="grid grid-cols-1 gap-1">
                            {typeWorks.slice(0, 10).map((work) => (
                              <CompactWorkLink key={work.id} work={work} />
                            ))}
                          </div>
                          {typeWorks.length > 10 && (
                            <p className="text-xs text-gray-400 text-center mt-2">
                              他 {typeWorks.length - 10}件
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-gray-400">出演作品を整理中です</p>
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
              <h2 className="text-base font-bold text-slate-800 mb-4">配信サービス別作品</h2>
              <div className="space-y-2.5">
                {providerGroups.map(([providerName, { logoPath, works: pWorks }]) => (
                  <details
                    key={providerName}
                    className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
                  >
                    <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors [list-style:none] [&::-webkit-details-marker]:hidden">
                      <ProviderLogo
                        providerName={providerName}
                        logoPath={logoPath}
                        size="md"
                      />
                      <span className="font-semibold text-slate-700 text-sm flex-1">
                        {providerName}
                      </span>
                      <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                        {pWorks.length}件
                      </span>
                    </summary>
                    <div className="border-t border-gray-50 p-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                        {pWorks.slice(0, MAX_WORKS_PER_PROVIDER).map((work) => (
                          <CompactWorkLink key={work.id} work={work} />
                        ))}
                      </div>
                      {pWorks.length > MAX_WORKS_PER_PROVIDER && (
                        <p className="text-xs text-gray-400 text-center mt-2">
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
            <h2 className="text-base font-bold text-slate-800 mb-4">関連商品</h2>
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
                        <h3 className="text-sm font-semibold text-slate-700">
                          {icon} {label}
                        </h3>
                        <span className="text-xs text-gray-400">{totalCount}件</span>
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
                        <p className="text-xs text-gray-400 text-center mt-2">
                          他 {totalCount - displayed}件
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500 bg-white rounded-xl border border-gray-100 px-4 py-3">
                関連商品は確認中です
              </p>
            )}
          </section>

          {/* ━━━ 7. 関連グループ ━━━ */}
          {relatedGroupNames.length > 0 && (
            <section>
              <h2 className="text-base font-bold text-slate-800 mb-4">関連グループ</h2>
              <div className="flex flex-wrap gap-2.5">
                {relatedGroupNames.map((g) => (
                  <Link
                    key={g}
                    href={`/group/${encodeURIComponent(g)}`}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-white border border-gray-200 rounded-xl hover:border-indigo-400 hover:text-indigo-600 transition-colors text-sm font-medium text-slate-700 shadow-sm"
                  >
                    {g}
                    <span className="text-gray-300 text-xs">›</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ━━━ 8. FAQ ━━━ */}
          <section>
            <h2 className="text-base font-bold text-slate-800 mb-4">よくある質問</h2>
            <div className="space-y-2">
              {faqItems.map(({ q, a }) => (
                <details
                  key={q}
                  className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
                >
                  <summary className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors [list-style:none] [&::-webkit-details-marker]:hidden">
                    <span className="text-indigo-500 font-black text-sm flex-shrink-0 w-5 text-center">Q</span>
                    <span className="font-semibold text-slate-700 text-sm flex-1">{q}</span>
                    <span className="text-gray-300 text-xs flex-shrink-0">›</span>
                  </summary>
                  <div className="border-t border-gray-50 px-4 py-3.5">
                    <div className="flex gap-3">
                      <span className="text-emerald-500 font-black text-sm flex-shrink-0 w-5 text-center">A</span>
                      <p className="text-sm text-gray-600 leading-relaxed">{a}</p>
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
