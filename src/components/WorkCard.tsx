import type { WorkRecord } from '@/types/work';

export default function WorkCard({ work }: { work: WorkRecord }) {
  const href = work.tmdbId
    ? `https://www.themoviedb.org/${work.type}/${work.tmdbId}`
    : undefined;

  const inner = (
    <div className="flex gap-3 bg-white rounded-xl border border-gray-100 p-3 hover:shadow-md transition-shadow h-full">
      {/* ポスター */}
      <div className="w-16 h-[6rem] flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
        {work.posterUrl ? (
          <img
            src={work.posterUrl}
            alt={work.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl">
            🎬
          </div>
        )}
      </div>

      {/* 情報 */}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-slate-800 text-sm line-clamp-2 leading-tight">
          {work.title}
        </p>
        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
          <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
            {work.type === 'movie' ? '映画' : 'ドラマ・TV'}
          </span>
          {work.releaseYear && <span>{work.releaseYear}年</span>}
        </div>
        {work.roleName && (
          <p className="text-xs text-indigo-600 mt-1 line-clamp-1">役: {work.roleName}</p>
        )}
        {work.overview && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{work.overview}</p>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block">
        {inner}
      </a>
    );
  }
  return inner;
}
