import type { Metadata } from 'next';
import Link from 'next/link';
import SearchForm from '@/components/SearchForm';
import SearchResults, { type PersonStats } from './SearchResults';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllGroupMetasOrThrow } from '@/lib/group-meta';
import { getAllPersonMetasOrThrow } from '@/lib/person-meta';
import { getAllPersonsWithConfig } from '@/lib/persons';
import { getPublishedWorks } from '@/lib/work-store';
import { getAllStoredProducts } from '@/lib/product-store';
import type { GroupMeta } from '@/types/group';
import type { ActivityStatus, PersonWithConfig } from '@/types/person';
import type { SuggestionItem } from '@/types/search';
import { shadowReadSearchPage } from '@/lib/shadow-read';
import { groupHrefByName } from '@/lib/group-slug';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  if (q) {
    return {
      title: `「${q}」の検索結果 | 推しサーチ`,
      robots: 'noindex',
    };
  }
  return {
    title: '推し・有名人を検索 | 推しサーチ',
    description:
      'アイドル・俳優・芸人・タレントなどの人物情報、出演作品、関連商品、配信情報をまとめて検索できます。',
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

  // 全データ並行取得（meta系はOrThrowで取得し、Redis失敗を検知する）
  const [personsResult, groupMetasResult, personMetasResult] = await Promise.allSettled([
    getAllPersonsMerged(),
    getAllGroupMetasOrThrow(),
    getAllPersonMetasOrThrow(),
  ]);
  const allPersons =
    personsResult.status === 'fulfilled' ? personsResult.value : getAllPersonsWithConfig();
  const allGroupMetas =
    groupMetasResult.status === 'fulfilled' ? groupMetasResult.value : [];
  const personMetaMap =
    personMetasResult.status === 'fulfilled' ? personMetasResult.value : {};
  const redisError =
    groupMetasResult.status === 'rejected' || personMetasResult.status === 'rejected';

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

  // クエリなし時は最大 100 件に制限（全件レンダリングによる遅延防止）
  const DISPLAY_LIMIT = 100;
  const totalPersonCount = persons.length;
  if (!query && persons.length > DISPLAY_LIMIT) {
    persons = persons.slice(0, DISPLAY_LIMIT);
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

  // シャドーリード: DB件数をRedisと比較してログ出力（ユーザー表示に影響しない）
  await shadowReadSearchPage({
    personMetaCount: Object.keys(personMetaMap).length,
    groupMetaCount: allGroupMetas.length,
  });

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
            !vp.hidden && ['flatrate', 'free', 'ads'].includes(vp.type),
          ),
        ).length;
        return [p.name, { productCount, workCount, streamingCount }] as const;
      }),
    );
    personStatsMap = Object.fromEntries(entries);
  }

  const totalCount = persons.length + matchingGroups.length;

  // サジェスト候補を構築
  const suggestions: SuggestionItem[] = [
    ...[...new Set(allPersons.map((p) => p.group).filter(Boolean) as string[])].map((g) => ({
      label: g,
      href: groupHrefByName(g, allGroupMetas),
      type: 'group' as const,
    })),
    ...allPersons.flatMap((p) => [
      { label: p.name, sublabel: p.group || undefined, href: `/person/${encodeURIComponent(p.name)}`, type: 'person' as const },
      ...(p.config.aliases ?? []).map((a) => ({
        label: a, sublabel: p.name, href: `/search?q=${encodeURIComponent(a)}`, type: 'alias' as const,
      })),
    ]),
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* 検索フォーム */}
      <div className="mb-6 max-w-2xl">
        <SearchForm defaultValue={query} suggestions={suggestions} />
      </div>

      {/* Redis 一時エラー警告 */}
      {redisError && (
        <div className="mb-4 rounded-xl px-4 py-3 text-sm text-amber-700 bg-amber-50 border border-amber-200">
          一部の検索機能（活動状態・世代・旧グループ名など）を一時的に取得できません。
          人物・グループの基本検索は引き続き利用できます。
        </div>
      )}

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
              href={groupHrefByName(formerNameMatch.groupName, allGroupMetas)}
              className="font-semibold hover:underline"
            >
              {formerNameMatch.groupName}
            </Link>
            {' '}として活動しています
          </span>
          <Link
            href={groupHrefByName(formerNameMatch.groupName, allGroupMetas)}
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
            {query
              ? `${totalCount.toLocaleString()}件`
              : `${totalPersonCount.toLocaleString()}人`}
          </span>
        </h1>
        {!query && totalPersonCount > persons.length && (
          <p className="text-xs mt-1" style={{ color: 'var(--ds-muted)' }}>
            上位 {persons.length} 人を表示中 — 名前・読みで検索するとすべて表示されます
          </p>
        )}
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

      {/* 検索結果0件時のナビゲーション */}
      {persons.length === 0 && matchingGroups.length === 0 && query && (
        <div className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--ds-border)' }}>
          <p className="text-sm mb-3" style={{ color: 'var(--ds-muted)' }}>別の探し方：</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { href: '/search', label: '全員一覧' },
                { href: `/genre/${encodeURIComponent('坂道')}`, label: '🌸 坂道' },
                { href: `/genre/${encodeURIComponent('芸人')}`, label: '😄 芸人' },
                { href: `/genre/${encodeURIComponent('女優')}`, label: '🎭 女優' },
                { href: `/genre/${encodeURIComponent('俳優')}`, label: '🎬 俳優' },
                { href: `/genre/${encodeURIComponent('アーティスト')}`, label: '🎵 アーティスト' },
                { href: '/', label: '← トップ' },
              ] as { href: string; label: string }[]
            ).map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-xs px-3 py-1.5 rounded-lg hover:opacity-80 transition-opacity"
                style={{
                  background: 'var(--ds-surface)',
                  border: '1px solid var(--ds-border)',
                  color: 'var(--ds-text)',
                  textDecoration: 'none',
                  minHeight: '32px',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
