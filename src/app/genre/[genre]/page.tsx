import type { Metadata } from 'next';
import PersonCard from '@/components/PersonCard';
import { getPersonsByGenreMerged, ALL_GENRES } from '@/lib/persons';
import type { Genre } from '@/types/person';

interface Props {
  params: Promise<{ genre: string }>;
}

export async function generateStaticParams() {
  return ALL_GENRES.map((genre) => ({ genre }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { genre } = await params;
  const g = decodeURIComponent(genre);
  return {
    title: `${g}の一覧`,
    description: `${g}カテゴリの人物一覧です。写真集・グッズ・出演情報を検索できます。`,
  };
}

export default async function GenrePage({ params }: Props) {
  const { genre } = await params;
  const decodedGenre = decodeURIComponent(genre) as Genre;
  const persons = await getPersonsByGenreMerged(decodedGenre);

  // Group by group name
  const grouped = persons.reduce<Record<string, typeof persons>>((acc, p) => {
    const key = p.group || 'ソロ・個人';
    (acc[key] ??= []).push(p);
    return acc;
  }, {});

  // データなし → 準備中ページ
  if (persons.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <p className="text-sm text-gray-500 mb-1">ジャンル</p>
          <h1 className="text-2xl font-black text-slate-800">{decodedGenre}</h1>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-12 text-center">
          <p className="text-4xl mb-4">🚧</p>
          <p className="font-bold text-gray-700 text-lg mb-2">このジャンルは準備中です</p>
          <p className="text-sm text-gray-500">近日中に{decodedGenre}ジャンルの人物を追加予定です。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8">
        <p className="text-sm text-gray-500 mb-1">ジャンル</p>
        <h1 className="text-2xl font-black text-slate-800">
          {decodedGenre}
          <span className="text-gray-400 font-normal text-lg ml-2">{persons.length}人</span>
        </h1>
      </div>

      <div className="space-y-10">
        {Object.entries(grouped).map(([group, groupPersons]) => (
          <section key={group}>
            <h2 className="text-sm font-bold text-primary border-l-4 border-primary pl-3 mb-4">
              {group}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {groupPersons.map((person) => (
                <PersonCard key={person.name} person={person} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
