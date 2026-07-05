import Link from 'next/link';
import { getPersonCardBadges } from '@/lib/genre-utils';
import type { PersonCardMeta } from '@/lib/genre-utils';

const GENRE_STYLE: Record<string, string> = {
  '坂道': 'bg-pink-100 text-pink-700',
  '芸人': 'bg-yellow-100 text-yellow-700',
  'テレビ': 'bg-blue-100 text-blue-700',
  'アーティスト': 'bg-purple-100 text-purple-700',
  '俳優': 'bg-green-100 text-green-700',
  '女優': 'bg-rose-100 text-rose-700',
  'アイドル': 'bg-pink-100 text-pink-700',
  '元アイドル': 'bg-orange-100 text-orange-700',
  'タレント': 'bg-sky-100 text-sky-700',
  'モデル': 'bg-teal-100 text-teal-700',
  '歌手': 'bg-violet-100 text-violet-700',
  '声優': 'bg-indigo-100 text-indigo-700',
};

const AVATAR_GRADIENT: Record<string, string> = {
  '坂道': 'from-pink-400 to-rose-500',
  '芸人': 'from-amber-400 to-orange-500',
  'テレビ': 'from-sky-400 to-blue-500',
  'アーティスト': 'from-violet-400 to-purple-600',
  '俳優': 'from-emerald-400 to-green-600',
};

interface PersonCardData {
  name: string;
  group: string;
  genre: string;
}

export default function PersonCard({ person }: { person: PersonCardData & PersonCardMeta }) {
  const initial = person.name[0];
  const gradient = AVATAR_GRADIENT[person.genre] ?? 'from-primary to-indigo-400';
  const badges = getPersonCardBadges(person.genre, person);
  const subtitle = person.primaryGenre || person.group;

  return (
    <Link href={`/person/${encodeURIComponent(person.name)}`} className="block">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:shadow-md hover:-translate-y-1 transition-all duration-200">
        <div
          className={`w-14 h-14 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center mx-auto mb-3 text-white text-2xl font-bold select-none`}
        >
          {initial}
        </div>
        <p className="text-center font-bold text-slate-800 text-sm leading-snug">{person.name}</p>
        {subtitle && (
          <p className="text-center text-gray-500 text-xs mt-1 truncate">{subtitle}</p>
        )}
        <div className="flex justify-center flex-wrap gap-1 mt-2">
          {badges.map((badge) => (
            <span key={badge} className={`text-xs px-2 py-0.5 rounded-full font-medium ${GENRE_STYLE[badge] ?? 'bg-gray-100 text-gray-600'}`}>
              {badge}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}
