'use client';

import { useCallback, useState, type SyntheticEvent } from 'react';
import Link from 'next/link';
import type { WorkRecord } from '@/types/work';
import { deduplicateProviders, isConfirmedVodAvailability, getVodProviderDisplayInfo } from '@/lib/vod-dedup';
import { getWorkPublicUrl } from '@/lib/work-url';
import ProviderLogo from '@/components/ProviderLogo';
import { getDisplayWorkType, DISPLAY_WORK_TYPE_LABEL, DISPLAY_WORK_TYPE_ICON } from '@/lib/work-display-type';
import { getWorkDisplayImage, getRenderableWorkImageUrl } from '@/lib/work-image';
import { getWorkImageAspectGroup, type WorkImageAspectGroup } from '@/lib/work-filter';

function trackWorkClick(workId: string, title: string, personName: string, workType: string, posterUrl: string) {
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'work', workId, title, personName, workType, posterUrl }),
  }).catch(() => {});
}

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

// 画像アスペクト比ごとのコンテナ・画像スタイル。
// 縦長（portrait）・横長（landscape）それぞれ専用のアスペクト比でコンテナを固定することで、
// 同じタイプ同士のカードは画像領域の高さ・タイトル開始位置が揃う。
// object-cover ではなく object-contain を使い、人物の顔・作品ロゴ・タイトル文字が
// 大きく欠けないようにする（コンテナとの余白は背景色で埋める＝レターボックス表示）。
type PosterGroup = Exclude<WorkImageAspectGroup, 'none'>;

const POSTER_LAYOUT: Record<PosterGroup, { container: string; img: string }> = {
  portrait: {
    container: 'relative aspect-[2/3] bg-gray-100 overflow-hidden flex-shrink-0',
    img: 'w-full h-full object-contain',
  },
  landscape: {
    // ライブ・コンサート・テレビ番組等の横長キービジュアル用。16:9 を基準とし、
    // 人物・タイトル・ロゴが左右で切れないよう object-contain + 背景色で余白を埋める。
    container: 'relative aspect-video bg-gray-800 overflow-hidden flex-shrink-0',
    img: 'w-full h-full object-contain',
  },
};

export default function WorkCard({ work }: { work: WorkRecord }) {
  const displayType = getDisplayWorkType(work);
  const displayLabel = DISPLAY_WORK_TYPE_LABEL[displayType];
  const displayIcon  = DISPLAY_WORK_TYPE_ICON[displayType];
  const workDetailUrl = getWorkPublicUrl({ workId: work.id, personName: work.personName }) ?? `/person/${encodeURIComponent(work.personName)}/work/${encodeURIComponent(work.id)}`;
  // 画像優先順位: 手動画像 > TMDb/posterUrl > 自動取得OG画像 > プレースホルダー
  const displayPosterUrl = getRenderableWorkImageUrl(getWorkDisplayImage(work));
  // 初期表示・SSR時のフォールバック分類（並べ替えで使っている getWorkImageAspectGroup と
  // 同一ロジック）。TMDb画像は常に縦長ポスターのため正確だが、TMDb以外のOG自動取得画像は
  // 実際には縦長キービジュアルであることも多く、URLだけでは正しく判定できない。
  const fallbackAspectGroup = getWorkImageAspectGroup(work);
  // 実画像の読み込み完了後、実際の幅・高さから縦長/横長を判定し直す（分かった時点で上書き）。
  // これにより「本当は縦長なのに横長用の16:9枠に収めて左右に大きな余白ができる」ケースを防ぐ。
  const [measuredAspectGroup, setMeasuredAspectGroup] = useState<PosterGroup | null>(null);
  const imageAspectGroup = measuredAspectGroup ?? fallbackAspectGroup;
  const posterLayout = imageAspectGroup !== 'none' ? POSTER_LAYOUT[imageAspectGroup] : null;

  const measurePosterAspect = useCallback((img: HTMLImageElement) => {
    const { naturalWidth, naturalHeight } = img;
    if (!naturalWidth || !naturalHeight) return;
    setMeasuredAspectGroup(naturalWidth / naturalHeight >= 1 ? 'landscape' : 'portrait');
  }, []);

  function handlePosterLoad(e: SyntheticEvent<HTMLImageElement>) {
    measurePosterAspect(e.currentTarget);
  }

  // SSRされたHTMLをハイドレートする場合、ブラウザが画像を先に読み込み終えて
  // ネイティブの load イベントが React のハイドレーション（onLoad登録）より先に
  // 発火してしまうことがある。ref のコールバックはマウント時に同期的に呼ばれるため、
  // その時点で img.complete を確認することでこの取りこぼしを防ぐ。
  const posterRef = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete) measurePosterAspect(img);
  }, [measurePosterAspect]);

  // 公開ページ用フィルタ:
  //   confidence=low の AI ソースは非表示
  //   同名サービスは優先度の高いソースを1件だけ残す（TMDb > AI > CSV の順）
  const publicProviders = deduplicateProviders(
    (work.vodProviders ?? []).filter((p) => isConfirmedVodAvailability(p)),
  );

  const sortedProviders = publicProviders
    .slice()
    .sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9));

  const streamingProviders = sortedProviders.filter((p) =>
    ['flatrate', 'free', 'ads'].includes(p.type),
  );
  const purchaseProviders = sortedProviders.filter((p) =>
    ['buy', 'rent'].includes(p.type),
  );

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
    <div className="work-card-root">
      {/* ポスター（クリックで作品詳細へ） */}
      <Link href={workDetailUrl} className="block">
        {displayPosterUrl && posterLayout ? (
          <div className={posterLayout.container}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={posterRef}
              src={displayPosterUrl}
              alt={work.title}
              className={posterLayout.img}
              loading="lazy"
              onLoad={handlePosterLoad}
            />
            {/* 種別バッジ（ポスター上） */}
            <div className="absolute top-2 left-2">
              <span className="text-xs bg-black/60 text-white px-1.5 py-0.5 rounded-full backdrop-blur-sm">
                {displayLabel}
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
        ) : (
          /* 画像なし用コンパクトヘッダー */
          <div className="work-card-no-poster relative h-20 overflow-hidden flex-shrink-0 flex items-center px-4 gap-3">
            <span className="text-3xl">{displayIcon}</span>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[10px] font-medium" style={{ color: 'var(--ds-muted)' }}>画像なし</span>
              <span className="text-xs px-1.5 py-0.5 rounded-full self-start" style={{ background: 'var(--ds-primary-soft)', color: 'var(--ds-primary)' }}>
                {displayLabel}
              </span>
            </div>
            {streamingProviders.length > 0 && (
              <span
                className={`absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded-full font-bold ${
                  hasAiOnly ? 'bg-purple-500 text-white' : 'bg-green-500 text-white'
                }`}
              >
                配信中
              </span>
            )}
          </div>
        )}
      </Link>

      {/* テキスト情報 */}
      <div className="flex flex-col flex-1 p-3 gap-2">
        {/* タイトル・年・役 */}
        <div>
          <Link href={workDetailUrl} className="work-card-title">
            {work.title}
          </Link>
          <div className="flex items-center gap-1.5 mt-1 text-xs" style={{ color: 'var(--ds-muted)' }}>
            {work.releaseYear && <span>{work.releaseYear}年</span>}
            {work.roleName && (
              <>
                <span>·</span>
                <span className="line-clamp-1" style={{ color: 'var(--ds-primary)' }}>役: {work.roleName}</span>
              </>
            )}
          </div>
        </div>

        {/* 配信サービスバッジ */}
        {sortedProviders.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mt-auto">
            {streamingProviders.slice(0, 4).map((p, i) => {
              const info = getVodProviderDisplayInfo(p.providerName);
              return (
                <span
                  key={`${p.providerId}-${p.type}-${i}`}
                  title={`${info.displayName}${info.badgeLabel ? `（${info.badgeLabel}）` : ''}（${
                    p.type === 'flatrate' ? '見放題' :
                    p.type === 'free' ? '無料' :
                    p.type === 'ads' ? '広告付き' : p.type
                  }）${p.confidence ? ` 確度:${p.confidence}` : ''}`}
                  className={`flex items-center gap-1 border rounded-full px-1.5 py-0.5 text-[10px] ${
                    info.isPrimeVideoChannel
                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                      : VOD_SOURCE_BADGE[p.source] ?? 'bg-gray-50 border-gray-200 text-gray-700'
                  }`}
                >
                  <ProviderLogo
                    providerName={p.providerName}
                    logoPath={p.logoPath}
                    size="xs"
                    className="rounded-sm border-0 bg-transparent"
                  />
                  <span className="truncate max-w-[5rem]">{info.displayName}</span>
                </span>
              );
            })}
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

        {/* 作品詳細ボタン（常に内部リンク） */}
        <Link
          href={workDetailUrl}
          className="work-card-detail-btn"
          onClick={() => trackWorkClick(work.id, work.title, work.personName, work.type, displayPosterUrl ?? '')}
        >
          作品詳細 →
        </Link>
      </div>
    </div>
  );
}
