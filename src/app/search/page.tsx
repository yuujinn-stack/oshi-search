import type { Metadata } from 'next';
import Link from 'next/link';
import SearchForm from '@/components/SearchForm';
import PersonCard from '@/components/PersonCard';
import { getAllPersonsMerged } from '@/lib/persons';
import { getAllGroupMetas } from '@/lib/group-meta';
import { getAllPersonMetas } from '@/lib/person-meta';
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

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = q?.trim() ?? '';

  const [allPersons, allGroupMetas, personMetaMap] = await Promise.all([
    getAllPersonsMerged(),
    getAllGroupMetas(),
    query ? getAllPersonMetas() : Promise.resolve({} as ReturnType<typeof getAllPersonMetas> extends Promise<infer T> ? T : never),
  ]);

  // ── 拡張検索 ─────────────────────────────────────────────────────────────
  let persons: PersonWithConfig[];
  let formerNameMatch: GroupMeta | undefined;

  if (query) {
    const q = query.toLowerCase();
    // "元XXX" → formerGroupNames の "XXX" を検索
    const formerGroupQ = query.startsWith('元') ? query.slice(1).toLowerCase() : null;
    // クエリが活動状態ラベルに一致するか
    const matchedStatus = Object.entries(QUERY_TO_STATUS).find(
      ([label]) => label === query || label.includes(query) || query.includes(label),
    )?.[1];

    persons = allPersons.filter((p) => {
      // 基本検索（名前・グループ・ジャンル・aliases）
      if (p.name.toLowerCase().includes(q)) return true;
      if (p.group.toLowerCase().includes(q)) return true;
      if (p.genre.toLowerCase().includes(q)) return true;
      if ((p.config.aliases ?? []).some((a) => a.toLowerCase().includes(q))) return true;

      const meta = personMetaMap[p.name];
      if (!meta) return false;

      // 期別検索（例: "3期生", "1期"）
      if (meta.generation?.toLowerCase().includes(q)) return true;

      // 活動状態検索（例: "卒業", "現役"）
      if (matchedStatus && meta.activityStatus === matchedStatus) return true;

      // 旧グループ名検索（例: "元欅坂46" → formerGroupNames に "欅坂46" を含む）
      if (formerGroupQ && (meta.formerGroupNames ?? []).some(
        (g) => g.toLowerCase().includes(formerGroupQ),
      )) return true;

      return false;
    });

    // GroupMeta の旧名からも一致するグループを検索
    formerNameMatch = allGroupMetas.find((g) => {
      const aliases = [...(g.formerNames ?? []), g.renamedFrom].filter(Boolean) as string[];
      return aliases.some(
        (n) => n.toLowerCase().includes(q) || q.includes(n.toLowerCase()),
      );
    });

    // 旧名マッチがあれば新グループのメンバーを追加（重複なし）
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

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6 max-w-2xl">
        <SearchForm defaultValue={query} />
      </div>

      {/* 旧グループ名バナー */}
      {formerNameMatch && query && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm text-blue-700">
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
            className="text-sm font-semibold text-blue-600 hover:underline ml-auto"
          >
            {formerNameMatch.groupName} のページへ →
          </Link>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">
          {query ? (
            <>
              「{query}」の検索結果{' '}
              <span className="text-gray-500 font-normal text-base">{persons.length}件</span>
            </>
          ) : (
            <>
              全員一覧{' '}
              <span className="text-gray-500 font-normal text-base">{persons.length}件</span>
            </>
          )}
        </h1>
      </div>

      {persons.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <p className="text-5xl mb-4">🔍</p>
          <p className="text-lg font-medium">「{query}」に一致する人物が見つかりませんでした</p>
          <p className="text-sm mt-2">別のキーワードで検索してみてください</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {persons.map((person) => (
            <PersonCard key={person.name} person={person} />
          ))}
        </div>
      )}
    </div>
  );
}
