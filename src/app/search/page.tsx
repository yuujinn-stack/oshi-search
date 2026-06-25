import type { Metadata } from 'next';
import Link from 'next/link';
import SearchForm from '@/components/SearchForm';
import PersonCard from '@/components/PersonCard';
import { searchPersonsMerged, getAllPersonsMerged } from '@/lib/persons';
import { getAllGroupMetas } from '@/lib/group-meta';
import type { GroupMeta } from '@/types/group';

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

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = q?.trim() ?? '';

  // GroupMeta を並列取得（旧グループ名検索のため）
  const [basePersons, allGroupMetas] = await Promise.all([
    query ? searchPersonsMerged(query) : getAllPersonsMerged(),
    getAllGroupMetas(),
  ]);

  // クエリが旧グループ名と一致するか確認
  let formerNameMatch: GroupMeta | undefined;
  if (query) {
    formerNameMatch = allGroupMetas.find((g) => {
      const aliases = [...(g.formerNames ?? []), g.renamedFrom].filter(Boolean) as string[];
      return aliases.some(
        (n) => n.toLowerCase().includes(query.toLowerCase()) || query.toLowerCase().includes(n.toLowerCase()),
      );
    });
  }

  // 旧名マッチがあれば新グループのメンバーを追加
  let persons = basePersons;
  if (formerNameMatch && query) {
    const extra = await searchPersonsMerged(formerNameMatch.groupName);
    const seen = new Set(persons.map((p) => p.name));
    for (const p of extra) {
      if (!seen.has(p.name)) persons = [...persons, p];
    }
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
