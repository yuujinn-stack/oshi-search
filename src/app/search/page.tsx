import type { Metadata } from 'next';
import Link from 'next/link';
import SearchForm from '@/components/SearchForm';
import SearchResults, { type PersonStats } from './SearchResults';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllGroupMetas } from '@/lib/group-meta';
import { getAllPersonMetas } from '@/lib/person-meta';
import { getPublishedWorks } from '@/lib/work-store';
import { getAllStoredProducts } from '@/lib/product-store';
import type { GroupMeta } from '@/types/group';
import type { ActivityStatus, PersonWithConfig } from '@/types/person';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: q ? `「${q}」の検索結果` : '全員一覧',
    robots: 'noindex',
  };
}

// 活動状態ラベル → ActivityStatus のマッピング
const QUERY_TO_STATUS: Record<string, ActivityStatus> = {
  '現役': 'active',
  'アクティブ': 'active',
  '卒業': 'graduated',
  '脱退': 'withdrawn',
  '休止': 'hiatus',
  '休止中': 'hiatus',
  '活動休止': 'hiatus',
  '引退': 'retired',
  '不明': 'unknown',
};

// 人物スタッツを取得する最大件数（これ以下の時のみ Redis を叩く）
const STATS_THRESHOLD = 15;

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = q?.trim() ?? '';

  // 全データ並行取得（personMetaMap は常に取得・単一 HGETALL のため軽量）
  const [allPersons, allGroupMetas, personMetaMap] = await Promise.all([
    getAllPersonsMerged(),
    getAllGroupMetas(),
    getAllPersonMetas(),
  ]);

  // ── 人物フィルタ ──────────────────────────────────────────────────────────
  let persons: PersonWithConfig[];
  let formerNameMatch: GroupMeta | undefined;

  if (query) {
    const ql = query.toLowerCase();
    const formerGroupQ = query.startsWith('元') ? query.slice(1).toLowerCase() : null;
    const matchedStatus = Object.entries(QUERY_TO_STATUS).find(
      ([label]) => label === query || label.includes(query) || query.includes(label),
    )?.[1];

    persons = allPersons.filter((p) => {
      if (p.name.toLowerCase().includes(ql)) return true;
      if (p.group.toLowerCase().includes(ql)) return true;
      if (p.genre.toLowerCase().includes(ql)) return true;
      if ((p.config.aliases ?? []).some((a) => a.toLowerCase().includes(ql))) return true;

      const meta = personMetaMap[p.name];
      if (!meta) return false;

      if (meta.generation?.toLowerCase().includes(ql)) return true;
      if (matchedStatus && meta.activityStatus === matchedStatus) return true;
      if (
        formerGroupQ &&
        (meta.formerGroupNames ?? []).some((g) => g.toLowerCase().includes(formerGroupQ))
      )
        return true;

      return false;
    });

    // GroupMeta の旧名マッチ
    formerNameMatch = allGroupMetas.find((g) => {
      const aliases = [...(g.formerNames ?? []), g.renamedFrom].filter(Boolean) as string[];
      return aliases.some(
        (n) => n.toLowerCase().includes(ql) || ql.includes(n.toLowerCase()),
      );
    });

    // 旧名マッチがあれば新グループのメンバーを追加
    if (formerNameMatch) {
      const seen = new Set(persons.map((p) => p.name));
      const extra = allPersons.filter(
        (p) => p.group === formerNameMatch!.groupName && !seen.has(p.name),
      );
      persons = [...persons, ...extra];
    }
  } else {
    persons = allPersons;
  }

  // ── グループ検索 ──────────────────────────────────────────────────────────
  // primary source: allPersons の group フィールド（admin:groups 未登録でも検出）
  // secondary:      allGroupMetas の formerNames / renamedFrom
  const matchingGroups: GroupMeta[] = (() => {
    if (!query) return [];
    const ql = query.toLowerCase();

    // 1. personsのgroupフィールドから一致するグループ名を収集
    const matched = new Set<string>();
    for (const p of allPersons) {
      if (p.group && p.group.toLowerCase().includes(ql)) {
        matched.add(p.group);
      }
    }

    // 2. allGroupMetas の旧名・改名元からも補完
    for (const g of allGroupMetas) {
      if (
        (g.formerNames ?? []).some((n) => n.toLowerCase().includes(ql)) ||
        g.renamedFrom?.toLowerCase().includes(ql)
      ) {
        matched.add(g.groupName);
      }
    }

    // 3. 各グループ名に GroupMeta を付与（メタがなければ最小構造で生成）
    const metaByName = new Map(allGroupMetas.map((g) => [g.groupName, g]));
    return [...matched].map(
      (name) =>
        metaByName.get(name) ?? {
          groupName: name,
          slug: encodeURIComponent(name),
          activityStatus: 'active' as const,
        },
    );
  })();

  // デバッグログ（Vercel Functions ログで確認可能）
  console.log(`[search] query="${query}" persons=${persons.length} allGroupMetas=${allGroupMetas.length} matchingGroups=${matchingGroups.length}`);
  if (matchingGroups.length > 0) {
    console.log('[search] matchingGroups:', matchingGroups.map((g) => g.groupName));
  }

  // ── グループ別メンバー数 ──────────────────────────────────────────────────
  const memberCountMap: Record<string, { active: number; former: number }> = {};
  for (const group of matchingGroups) {
    const members = allPersons.filter((p) => p.group === group.groupName);
    const active = members.filter((p) => {
      const s = personMetaMap[p.name]?.activityStatus;
      return !s || s === 'active' || s === 'hiatus' || s === 'unknown';
    }).length;
    memberCountMap[group.groupName] = { active, former: members.length - active };
  }

  // ── 人物スタッツ（小さい検索結果のみ Redis から取得） ────────────────────
  let personStatsMap: Record<string, PersonStats> = {};
  if (query && persons.length > 0 && persons.length <= STATS_THRESHOLD) {
    const entries = await Promise.all(
      persons.map(async (p) => {
        const [products, works] = await Promise.all([
          getAllStoredProducts(p.name),
          getPublishedWorks(p.name),
        ]);
        const productCount = Object.values(products).reduce(
          (sum, cat) => sum + (cat?.products ?? []).length,
          0,
        );
        const workCount = works.length;
        const streamingCount = works.filter((w) =>
          (w.vodProviders ?? []).some((vp) =>
            ['flatrate', 'free', 'ads'].includes(vp.type),
          ),
        ).length;
        return [p.name, { productCount, workCount, streamingCount }] as const;
      }),
    );
    personStatsMap = Object.fromEntries(entries);
  }

  const totalCount = persons.length + matchingGroups.length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* 検索フォーム */}
      <div className="mb-6 max-w-2xl">
        <SearchForm defaultValue={query} />
      </div>

      {/* 旧グループ名バナー（テーマ対応） */}
      {formerNameMatch && query && (
        <div
          className="mb-4 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap"
          style={{
            background: 'var(--ds-primary-soft)',
            border: '1px solid var(--ds-border)',
          }}
        >
          <span className="text-sm" style={{ color: 'var(--ds-primary)' }}>
            「{query}」は現在{' '}
            <Link
              href={`/group/${encodeURIComponent(formerNameMatch.groupName)}`}
              className="font-semibold hover:underline"
            >
              {formerNameMatch.groupName}
            </Link>
            {' '}として活動しています
          </span>
          <Link
            href={`/group/${encodeURIComponent(formerNameMatch.groupName)}`}
            className="text-sm font-semibold hover:underline ml-auto"
            style={{ color: 'var(--ds-primary)' }}
          >
            {formerNameMatch.groupName} のページへ →
          </Link>
        </div>
      )}

      {/* 見出し */}
      <div className="mb-4">
        <h1 className="text-xl font-bold" style={{ color: 'var(--ds-text)' }}>
          {query ? `「${query}」の検索結果` : '全員一覧'}
          {' '}
          <span className="text-base font-normal" style={{ color: 'var(--ds-muted)' }}>
            {totalCount.toLocaleString()}件
          </span>
        </h1>
      </div>

      {/* 検索結果（タブ・ソート・カード） */}
      <SearchResults
        query={query}
        persons={persons}
        personMetaMap={personMetaMap}
        matchingGroups={matchingGroups}
        memberCountMap={memberCountMap}
        personStatsMap={personStatsMap}
      />
    </div>
  );
}
