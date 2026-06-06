import type { Metadata } from 'next';
import SearchForm from '@/components/SearchForm';
import PersonCard from '@/components/PersonCard';
import { searchPersons, getAllPersons } from '@/lib/persons';

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
  const persons = query ? searchPersons(query) : getAllPersons();

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-6 max-w-2xl">
        <SearchForm defaultValue={query} />
      </div>

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
