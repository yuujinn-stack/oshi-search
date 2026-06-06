import Link from 'next/link';
import { Person } from '@/types/person';

const GENRE_STYLE: Record<string, string> = {
  '坂道': 'bg-pink-100 text-pink-700',
  '芸人': 'bg-yellow-100 text-yellow-700',
  'テレビ': 'bg-blue-100 text-blue-700',
  'アーティスト': 'bg-purple-100 text-purple-700',
  '俳優': 'bg-green-100 text-green-700',
};

const AVATAR_GRADIENT: Record<string, string> = {
  '坂道': 'from-pink-400 to-rose-500',
  '芸人': 'from-amber-400 to-orange-500',
  'テレビ': 'from-sky-400 to-blue-500',
  'アーティスト': 'from-violet-400 to-purple-600',
  '俳優': 'from-emerald-400 to-green-600',
};

export default function PersonCard({ person }: { person: Person }) {
  const initial = person.name[0];
  const gradient = AVATAR_GRADIENT[person.genre] ?? 'from-primary to-indigo-400';
  const badge = GENRE_STYLE[person.genre] ?? 'bg-gray-100 text-gray-600';

  return (
    <Link href={`/person/${encodeURIComponent(person.name)}`} className="block">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:shadow-md hover:-translate-y-1 transition-all duration-200">
        <div
          className={`w-14 h-14 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center mx-auto mb-3 text-white text-2xl font-bold select-none`}
        >
          {initial}
        </div>
        <p className="text-center font-bold text-slate-800 text-sm leading-snug">{person.name}</p>
        {person.group && (
          <p className="text-center text-gray-500 text-xs mt-1 truncate">{person.group}</p>
        )}
        <div className="flex justify-center mt-2">
          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${badge}`}>
            {person.genre}
          </span>
        </div>
      </div>
    </Link>
  );
}
