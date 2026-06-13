import Link from 'next/link';
import type { WorkRecord } from '@/types/work';

const PROVIDER_LOGO_BASE = 'https://image.tmdb.org/t/p/w45';

// 定額配信（flatrate）を最優先、次に無料・広告付き、購入・レンタルは後ろ
const TYPE_ORDER: Record<string, number> = {
  flatrate: 0,
  free: 1,
  ads: 2,
  rent: 3,
  buy: 4,
  unknown: 5,
};

const VOD_SOURCE_BADGE: Record<string, string> = {
  openai_supplement: 'bg-purple-100 text-purple-700',
  openai_web_search: 'bg-purple-100 text-purple-700',
  manual_csv: 'bg-orange-50 border-orange-200 text-orange-700',
};

export default function WorkCard({ work }: { work: WorkRecord }) {
  const workDetailUrl = `/person/${encodeURIComponent(work.personName)}/work/${encodeURIComponent(work.id)}`;

  // 公開ページ用フィルタ:
  //   tmdb_watch_provider / manual / manual_csv は常に表示
  //   openai_supplement / openai_web_search は confidence=low を除外
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

  // JustWatchリンク（flatrate > free > ads > buy > rent の順で優先）
  const jwLink = sortedProviders.find((p) => p.link)?.link;

  // AI補完のみかどうか（openai_supplement / openai_web_search のみ）
  const hasAiOnly =
    sortedProviders.length > 0 &&
    sortedProviders.every(
      (p) => p.source === 'openai_supplement' || p.source === 'openai_web_search',
    );

  // CSV調査インポートのみかどうか
  const hasManualImportOnly =
    !hasAiOnly &&
    sortedProviders.length > 0 &&
    sortedProviders.every((p) => p.source === 'manual_csv');

  // 確認日表示
  const checkedDate = work.vodUpdatedAt
    ? new Date(work.vodUpdatedAt).toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-lg transition-all duration-200 flex flex-col h-full">
      {/* ポスター（クリックで作品詳細へ） */}
      <Link href={workDetailUrl} className="block">
        <div className="relative aspect-[2/3] bg-gray-100 overflow-hidden flex-shrink-0">
          {work.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={work.posterUrl}
              alt={work.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-200 text-4xl">
              🎬
            </div>
          )}
          {/* 種別バッジ（ポスター上） */}
          <div className="absolute top-2 left-2">
            <span className="text-xs bg-black/60 text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm">
              {work.type === 'movie' ? '映画' : 'ドラマ・TV'}
            </span>
          </div>
          {/* 配信中バッジ */}
          {streamingProviders.length > 0 && (
            <div className="absolute top-2 right-2">
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  hasAiOnly ? 'bg-purple-500 text-white' : 'bg-green-500 text-white'
                }`}
              >
                配信中
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* テキスト情報 */}
      <div className="flex flex-col flex-1 p-3 gap-2">
        {/* タイトル・年・役 */}
        <div>
          <Link href={workDetailUrl}>
            <p className="font-bold text-slate-800 text-sm leading-tight line-clamp-2 hover:text-indigo-700 transition-colors">
              {work.title}
            </p>
          </Link>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-400">
            {work.releaseYear && <span>{work.releaseYear}年</span>}
            {work.roleName && (
              <>
                <span>·</span>
                <span className="text-indigo-500 line-clamp-1">役: {work.roleName}</span>
              </>
            )}
          </div>
        </div>

        {/* 配信サービスバッジ */}
        {sortedProviders.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mt-auto">
            {streamingProviders.slice(0, 4).map((p, i) => (
              <span
                key={`${p.providerId}-${p.type}-${i}`}
                title={`${p.providerName}（${
                  p.type === 'flatrate' ? '見放題' :
                  p.type === 'free' ? '無料' :
                  p.type === 'ads' ? '広告付き' : p.type
                }）${p.confidence ? ` 確度:${p.confidence}` : ''}`}
                className={`flex items-center gap-1 border rounded-full px-1.5 py-0.5 text-[10px] ${
                  VOD_SOURCE_BADGE[p.source] ?? 'bg-gray-50 border-gray-200 text-gray-700'
                }`}
              >
                {p.logoPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`${PROVIDER_LOGO_BASE}${p.logoPath}`}
                    alt={p.providerName}
                    className="w-4 h-4 rounded-sm object-contain"
                  />
                ) : null}
                <span className="truncate max-w-[5rem]">{p.providerName}</span>
              </span>
            ))}
            {streamingProviders.length > 4 && (
              <span className="text-[10px] text-gray-400 self-center">
                +{streamingProviders.length - 4}
              </span>
            )}
            {purchaseProviders.length > 0 && streamingProviders.length === 0 && (
              <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full">
                購入・レンタルあり
              </span>
            )}
            {/* AI補完ラベル */}
            {hasAiOnly && (
              <span className="text-[9px] text-purple-400 w-full">
                {sortedProviders.some((p) => p.source === 'openai_web_search')
                  ? 'AI Web検索情報'
                  : 'AI補完情報'}
              </span>
            )}
            {/* CSV調査インポートラベル */}
            {hasManualImportOnly && (
              <span className="text-[9px] text-orange-400 w-full">CSV調査情報</span>
            )}
          </div>
        ) : (
          <p className="mt-auto text-[11px] text-gray-400 leading-snug">
            配信サービス情報は現在確認できません
          </p>
        )}

        {/* 確認日 */}
        {checkedDate && (
          <p className="text-[10px] text-gray-300">確認日: {checkedDate}</p>
        )}

        {/* 視聴先ボタン */}
        {jwLink ? (
          <a
            href={jwLink}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-xl transition-colors"
          >
            視聴先を探す →
          </a>
        ) : (
          <Link
            href={workDetailUrl}
            className={`block text-center text-xs py-1.5 rounded-xl border transition-colors ${
              sortedProviders.length === 0
                ? 'font-semibold text-indigo-600 border-indigo-300 hover:bg-indigo-50'
                : 'text-gray-400 hover:text-indigo-500 border-gray-200 hover:border-indigo-300'
            }`}
          >
            {sortedProviders.length === 0 ? 'TMDbで詳細を見る' : '詳細を見る'}
          </Link>
        )}
      </div>
    </div>
  );
}
