import Link from 'next/link';

const ACTIVITY_LABEL: Record<string, string> = {
  graduated: '卒業',
  withdrawn: '脱退',
  hiatus: '休止中',
  retired: '引退',
  unknown: '不明',
};
const ACTIVITY_BADGE_CLS: Record<string, string> = {
  graduated: 'bg-blue-100 text-blue-700',
  withdrawn: 'bg-red-100 text-red-600',
  hiatus: 'bg-amber-100 text-amber-700',
  retired: 'bg-gray-200 text-gray-500',
  unknown: 'bg-gray-100 text-gray-400',
};
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

export interface GroupMemberCardData {
  name: string;
  group: string;
  genre: string;
  generation?: string;
  activityStatus?: string;
  leftAt?: string;
}

export default function GroupMemberCard({ member }: { member: GroupMemberCardData }) {
  const { name, genre, generation, activityStatus, leftAt } = member;
  const initial = name[0];
  const gradient = AVATAR_GRADIENT[genre] ?? 'from-indigo-400 to-indigo-600';
  const badge = GENRE_STYLE[genre] ?? 'bg-gray-100 text-gray-600';
  const isFormer = activityStatus && activityStatus !== 'active' && activityStatus !== 'hiatus';

  return (
    <Link href={`/person/${encodeURIComponent(name)}`} className="block">
      <div
        className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:shadow-md hover:-translate-y-1 transition-all duration-200${isFormer ? ' opacity-80' : ''}`}
      >
        {/* アバター + 状態バッジ */}
        <div className="relative w-14 h-14 mx-auto mb-3">
          <div
            className={`w-14 h-14 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-2xl font-bold select-none`}
          >
            {initial}
          </div>
          {activityStatus && activityStatus !== 'active' && ACTIVITY_LABEL[activityStatus] && (
            <span
              className={`absolute -top-1 -right-1 text-[9px] px-1.5 py-0.5 rounded-full font-semibold leading-none ${ACTIVITY_BADGE_CLS[activityStatus] ?? 'bg-gray-100 text-gray-400'}`}
            >
              {ACTIVITY_LABEL[activityStatus]}
            </span>
          )}
        </div>

        {/* 名前 */}
        <p className="text-center font-bold text-slate-800 text-sm leading-snug">{name}</p>

        {/* 期別 */}
        {generation && (
          <p className="text-center text-gray-400 text-[11px] mt-0.5">{generation}</p>
        )}

        {/* 卒業日 */}
        {leftAt && (
          <p className="text-center text-gray-300 text-[10px] mt-0.5">{leftAt.slice(0, 7)}</p>
        )}

        {/* ジャンルバッジ */}
        <div className="flex justify-center mt-2">
          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${badge}`}>
            {genre}
          </span>
        </div>
      </div>
    </Link>
  );
}
