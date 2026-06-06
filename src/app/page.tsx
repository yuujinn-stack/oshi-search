import Link from 'next/link';
import SearchForm from '@/components/SearchForm';
import PersonCard from '@/components/PersonCard';
import { getAllPersons, getAllGroups, ALL_GENRES } from '@/lib/persons';

const GENRE_EMOJI: Record<string, string> = {
  '坂道': '🌸',
  '芸人': '🎭',
  'テレビ': '📺',
  'アーティスト': '🎵',
  '俳優': '🎬',
};

export default function HomePage() {
  const persons = getAllPersons();
  const groups = getAllGroups();
  const featured = persons.slice(0, 8);

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-br from-primary via-indigo-600 to-indigo-800 py-16 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tight">
            推し・有名人を検索
          </h1>
          <p className="text-indigo-200 mb-8 text-base">
            写真集・グッズ・出演作品・視聴先をまとめてチェック
          </p>
          <SearchForm />
          <p className="text-indigo-300 text-xs mt-4">
            現在 {persons.length} 人のデータを収録中
          </p>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 py-10 space-y-12">

        {/* Genre quick links */}
        <section>
          <h2 className="text-base font-bold text-slate-800 mb-4">ジャンルで探す</h2>
          <div className="flex flex-wrap gap-3">
            {ALL_GENRES.map((genre) => (
              <Link
                key={genre}
                href={`/genre/${encodeURIComponent(genre)}`}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-white border-2 border-primary text-primary font-bold rounded-full hover:bg-primary hover:text-white transition-colors text-sm shadow-sm"
                style={{ minHeight: '44px' }}
              >
                <span>{GENRE_EMOJI[genre]}</span>
                <span>{genre}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* Featured persons */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-slate-800">人気の人物</h2>
            <Link href="/search" className="text-primary text-sm font-medium hover:underline">
              全員を見る →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {featured.map((person) => (
              <PersonCard key={person.name} person={person} />
            ))}
          </div>
        </section>

        {/* Groups */}
        <section>
          <h2 className="text-base font-bold text-slate-800 mb-4">グループで探す</h2>
          <div className="flex flex-wrap gap-3">
            {groups.map((group) => (
              <Link
                key={group}
                href={`/search?q=${encodeURIComponent(group)}`}
                className="px-4 py-2.5 bg-white shadow-sm border border-gray-200 rounded-xl hover:border-primary hover:text-primary transition-colors text-sm font-medium text-slate-700"
                style={{ minHeight: '44px', lineHeight: '20px', display: 'flex', alignItems: 'center' }}
              >
                {group}
              </Link>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
