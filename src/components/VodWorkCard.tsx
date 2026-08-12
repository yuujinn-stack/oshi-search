import Link from 'next/link';
import type { VodPageWork } from '@/lib/vod-page';
import { VOD_TYPE_LABEL } from '@/types/vod';

// /vod/[provider] 専用の作品カード。
// 既存の WorkCard.tsx（人物ページの出演作品カード）と同じ theme-card 系CSS
// （work-card-root / work-card-title / work-card-detail-btn）を再利用し、
// デザインの一貫性を保つ。ただしこのページでは対象サービスが1つに固定されている
// ため、複数プロバイダーのバッジ表示は行わず、availabilityType・確認日・
// 主な出演人物という本ページ固有の情報を表示する。
export default function VodWorkCard({ work }: { work: VodPageWork }) {
  const checkedDate = work.checkedAt
    ? new Date(work.checkedAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  return (
    <div className="work-card-root">
      <Link href={work.detailUrl} className="block">
        <div className="relative aspect-[2/3] bg-gray-100 overflow-hidden flex-shrink-0">
          {work.posterUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={work.posterUrl}
              alt={work.title}
              className="w-full h-full object-contain"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1.5" style={{ color: 'var(--ds-muted)' }}>
              <span className="text-3xl" aria-hidden="true">{work.displayTypeIcon}</span>
              <span className="text-[10px] font-medium">画像なし</span>
            </div>
          )}
          <div className="absolute top-2 left-2">
            <span className="text-xs bg-black/60 text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm">
              {work.displayTypeLabel}
            </span>
          </div>
          {work.availabilityType !== 'unknown' && (
            <div className="absolute top-2 right-2">
              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold bg-green-500 text-white">
                {VOD_TYPE_LABEL[work.availabilityType]}
              </span>
            </div>
          )}
        </div>
      </Link>

      <div className="flex flex-col flex-1 p-3 gap-1.5">
        <div>
          <Link href={work.detailUrl} className="work-card-title">
            {work.title}
          </Link>
          {work.releaseYear && (
            <p className="text-xs mt-1" style={{ color: 'var(--ds-muted)' }}>{work.releaseYear}年</p>
          )}
        </div>

        {work.mainCastNames.length > 0 && (
          <p className="text-[11px] leading-snug line-clamp-2" style={{ color: 'var(--ds-muted)' }}>
            {work.mainCastNames.join('、')}
            {work.totalCastCount > work.mainCastNames.length && ' ほか'}
          </p>
        )}

        <div className="mt-auto flex flex-col gap-1.5">
          {checkedDate && (
            <p className="text-[10px]" style={{ color: 'var(--ds-muted)' }}>配信確認：{checkedDate}</p>
          )}
          <Link href={work.detailUrl} className="work-card-detail-btn">
            作品詳細 →
          </Link>
        </div>
      </div>
    </div>
  );
}
