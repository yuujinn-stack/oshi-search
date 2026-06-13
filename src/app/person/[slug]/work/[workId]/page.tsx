import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPersonWithConfig } from '@/lib/persons';
import { getWork } from '@/lib/work-store';
import { VOD_TYPE_LABEL } from '@/types/vod';
import type { VodProvider } from '@/types/vod';

interface Props {
  params: Promise<{ slug: string; workId: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, workId } = await params;
  const personName = decodeURIComponent(slug);
  const work = await getWork(personName, workId);
  if (!work) return {};
  return {
    title: `${work.title} - 配信情報 | ${personName}`,
    description: `${work.title}（${work.releaseYear ?? ''}）の日本向け配信サービス情報。${personName}出演作品。`,
  };
}

const SOURCE_LABEL: Record<string, string> = {
  tmdb_watch_provider: 'TMDb',
  openai_supplement: 'AI補完',
  openai_web_search: 'AI Web検索',
  manual: '手動',
  manual_import: 'CSV調査',
};

const SOURCE_BADGE: Record<string, string> = {
  tmdb_watch_provider: 'bg-blue-100 text-blue-700',
  openai_supplement: 'bg-purple-100 text-purple-700',
  openai_web_search: 'bg-violet-100 text-violet-700',
  manual: 'bg-green-100 text-green-700',
  manual_import: 'bg-orange-100 text-orange-700',
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high: 'text-green-600',
  medium: 'text-yellow-600',
  low: 'text-red-500',
};

const TYPE_ORDER: Record<string, number> = {
  flatrate: 0, free: 1, ads: 2, rent: 3, buy: 4, unknown: 5,
};

const TMDB_LOGO_BASE = 'https://image.tmdb.org/t/p/w45';
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w300';

function formatDate(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function WorkDetailPage({ params }: Props) {
  const { slug, workId } = await params;
  const personName = decodeURIComponent(slug);
  const person = getPersonWithConfig(personName);
  if (!person) notFound();

  const work = await getWork(personName, workId);
  if (!work || work.status !== 'auto_published') notFound();

  // 公開ページ用: confidence=low の openai_supplement / openai_web_search は除外
  const publicProviders = (work.vodProviders ?? []).filter((p) => {
    const isAiSource = p.source === 'openai_supplement' || p.source === 'openai_web_search';
    if (isAiSource && p.confidence === 'low') return false;
    return true;
  });

  const sortedProviders = publicProviders
    .slice()
    .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));

  const streamingProviders = sortedProviders.filter((p) =>
    ['flatrate', 'free', 'ads'].includes(p.type),
  );
  const purchaseProviders = sortedProviders.filter((p) =>
    ['buy', 'rent'].includes(p.type),
  );

  const tmdbUrl = work.tmdbId
    ? `https://www.themoviedb.org/${work.type}/${work.tmdbId}`
    : undefined;

  // JustWatch リンク（flatrate → free → ads → rent → buy 優先）
  const jwLink = sortedProviders.find((p) => p.link)?.link;

  const hasAi = sortedProviders.some(
    (p) => p.source === 'openai_supplement' || p.source === 'openai_web_search',
  );

  // confidence=low で非表示になったプロバイダー数
  const lowConfidenceCount = (work.vodProviders ?? []).filter((p) => {
    const isAiSource = p.source === 'openai_supplement' || p.source === 'openai_web_search';
    return isAiSource && p.confidence === 'low';
  }).length;

  function ProviderRow({ p }: { p: VodProvider }) {
    return (
      <div className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
        {/* ロゴ */}
        <div className="w-10 h-10 flex-shrink-0 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
          {p.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${TMDB_LOGO_BASE}${p.logoPath}`} alt={p.providerName} className="w-10 h-10 object-contain" />
          ) : (
            <span className="text-xs text-gray-400 text-center px-1 leading-tight">{p.providerName.slice(0, 4)}</span>
          )}
        </div>

        {/* 名前・種別 */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-800 text-sm">{p.providerName}</p>
          <p className="text-xs text-gray-500">{VOD_TYPE_LABEL[p.type] ?? p.type}</p>
        </div>

        {/* ソースバッジ */}
        <div className="flex flex-col items-end gap-1">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SOURCE_BADGE[p.source] ?? 'bg-gray-100 text-gray-500'}`}>
            {SOURCE_LABEL[p.source] ?? p.source}
          </span>
          {p.confidence && (
            <span className={`text-[10px] ${CONFIDENCE_COLOR[p.confidence] ?? ''}`}>
              確度: {CONFIDENCE_LABEL[p.confidence] ?? p.confidence}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-lg mx-auto px-4 py-3">
          <Link
            href={`/person/${encodeURIComponent(personName)}`}
            className="text-sm text-indigo-600 hover:text-indigo-800"
          >
            ← {personName}の出演作品一覧
          </Link>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* 作品情報 */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex gap-4 p-4">
            {/* ポスター */}
            <div className="w-20 flex-shrink-0">
              {work.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={work.posterUrl.replace('/w500', '/w300')}
                  alt={work.title}
                  className="w-20 aspect-[2/3] object-cover rounded-xl"
                />
              ) : (
                <div className="w-20 aspect-[2/3] bg-gray-100 rounded-xl flex items-center justify-center text-gray-300 text-2xl">
                  🎬
                </div>
              )}
            </div>

            {/* テキスト情報 */}
            <div className="flex-1 min-w-0 space-y-1">
              <h1 className="font-bold text-slate-800 text-lg leading-snug">{work.title}</h1>
              {work.originalTitle && (
                <p className="text-sm text-gray-500">{work.originalTitle}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                {work.releaseYear && <span>{work.releaseYear}年</span>}
                <span className="bg-gray-100 px-2 py-0.5 rounded-full">
                  {work.type === 'movie' ? '映画' : 'ドラマ・TV'}
                </span>
                {work.roleName && <span className="text-indigo-500">役: {work.roleName}</span>}
              </div>
              {work.overview && (
                <p className="text-xs text-gray-500 line-clamp-3 mt-1">{work.overview}</p>
              )}
            </div>
          </div>
        </div>

        {/* 配信情報 */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-800">配信サービス</h2>
            {work.vodUpdatedAt && (
              <span className="text-[11px] text-gray-400">
                確認日: {formatDate(work.vodUpdatedAt)}
              </span>
            )}
          </div>

          <div className="px-4">
            {sortedProviders.length > 0 ? (
              <>
                {streamingProviders.length > 0 && (
                  <div>
                    <p className="text-[11px] text-gray-400 pt-3 pb-1 font-medium">見放題・無料</p>
                    {streamingProviders.map((p, i) => (
                      <ProviderRow key={`${p.providerId}-${p.type}-${i}`} p={p} />
                    ))}
                  </div>
                )}
                {purchaseProviders.length > 0 && (
                  <div>
                    <p className="text-[11px] text-gray-400 pt-3 pb-1 font-medium">レンタル・購入</p>
                    {purchaseProviders.map((p, i) => (
                      <ProviderRow key={`${p.providerId}-${p.type}-${i}`} p={p} />
                    ))}
                  </div>
                )}
                {lowConfidenceCount > 0 && (
                  <p className="text-[11px] text-gray-400 pt-2 pb-3">
                    ※ 確度が低い情報 {lowConfidenceCount}件は表示を省略しています
                  </p>
                )}
                <div className="py-1" />
              </>
            ) : (
              <div className="py-6 text-center">
                <p className="text-sm text-gray-500">配信情報は現在確認できません。</p>
                {lowConfidenceCount > 0 && (
                  <p className="text-xs text-orange-400 mt-1">
                    AI補完情報 {lowConfidenceCount}件がありますが、確度が低いため表示を省略しています
                  </p>
                )}
                {work.vodUpdatedAt && (
                  <p className="text-xs text-gray-400 mt-1">
                    最終確認: {formatDate(work.vodUpdatedAt)}
                  </p>
                )}
                {tmdbUrl && (
                  <a
                    href={tmdbUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-3 text-sm font-semibold text-indigo-600 border border-indigo-300 px-4 py-2 rounded-xl hover:bg-indigo-50 transition-colors"
                  >
                    TMDbで詳細を見る
                  </a>
                )}
              </div>
            )}
          </div>

          {/* 注意書き */}
          <div className="px-4 pb-4">
            <p className="text-[11px] text-gray-400 leading-relaxed bg-gray-50 rounded-xl px-3 py-2">
              ※配信状況は変更される可能性があります。最新の配信状況は各公式サイトでご確認ください。
              {hasAi && (
                <> AI補完による情報を含む場合があります。正確性は保証されません。</>
              )}
            </p>
          </div>
        </div>

        {/* アクションボタン */}
        <div className="space-y-2">
          {jwLink && (
            <a
              href={jwLink}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center font-bold bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-2xl transition-colors"
            >
              視聴先を探す（JustWatch）
            </a>
          )}
          {tmdbUrl && (
            <a
              href={tmdbUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-sm text-gray-500 hover:text-indigo-600 py-2 rounded-2xl border border-gray-200 hover:border-indigo-300 transition-colors"
            >
              TMDbで詳細を見る
            </a>
          )}
        </div>

        {/* ソース情報（AI補完の場合） */}
        {hasAi && (
          <div className="text-[11px] text-gray-400 text-center space-y-1">
            {sortedProviders
              .filter((p) => p.source === 'openai_supplement' && p.sourceUrl)
              .map((p, i) => (
                <p key={i}>
                  参照:{' '}
                  <a
                    href={p.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {p.sourceUrl}
                  </a>
                </p>
              ))}
            {work.vodAiCheckedAt && (
              <p>AI補完確認日: {formatDate(work.vodAiCheckedAt)}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
