'use client';

// 過去のライブ映像（ライブDVD・Blu-ray）の一覧。グループページのコーナー（limit あり）と一覧ページで共用。
// - 公演ごとに1枚のカードにまとめ、DVD／Blu-ray・初回盤／通常盤は同じカード内のボタンにする（重複だらけの一覧にしない）
// - 並び替え（発売日の古い順／新しい順）と形式の絞り込み（すべて／DVD／Blu-ray）
// - 楽天リンクのクリックは既存の trackRakutenClick（/api/track・GA4 affiliate_click）に加えて、GA4 live_archive_product_click を送る
// - 表示されたら GA4 live_archive_view を1回、並び替え・絞り込みで live_archive_filter を送る（個人情報は送らない）
// 価格は取得日時が分かる新しい価格だけ（それ以外は「価格は楽天で確認」）。在庫・特典は表示しない。
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { sendGaEvent } from '@/lib/ga-event';
import { trackRakutenClick } from '@/lib/rakuten-click-track';
import { STALE_PRICE_LABEL } from '@/lib/price-freshness';
import {
  filterEntries, formatReleaseDate, itemLabel, sortEntries,
  type LiveArchiveEntry, type LiveArchiveItem, type LiveFormatFilter, type LiveSort,
} from '@/lib/live-archive/core';
import { liveArchiveFilterEvent, liveArchiveProductClickEvent, liveArchiveViewEvent } from '@/lib/live-archive/ga';

export type LiveArchivePlacement = 'group_page' | 'live_list';

const SORTS: Array<[LiveSort, string]> = [['old', '古い順'], ['new', '新しい順']];
const FORMATS: Array<[LiveFormatFilter, string]> = [['all', 'すべて'], ['DVD', 'DVD'], ['Blu-ray', 'Blu-ray']];

function ToggleGroup<T extends string>({ label, options, value, onChange }: {
  label: string; options: Array<[T, string]>; value: T; onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5">
      <span className="text-[11px] font-bold shrink-0" style={{ color: 'var(--ds-muted)' }}>{label}</span>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => { if (value !== v) onChange(v); }}
          className="px-3 rounded-full text-xs font-bold transition-colors"
          style={{
            minHeight: 36,
            border: '1px solid var(--ds-border)',
            background: value === v ? 'var(--ds-text)' : 'var(--ds-surface)',
            color: value === v ? 'var(--ds-surface)' : 'var(--ds-text)',
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export default function LiveArchiveBrowser({ groupName, groupId, entries, placement, limit, moreHref, officialListUrl }: {
  groupName: string;
  /** GA4 のグループID（公開URLのグループのスラッグ） */
  groupId: string;
  entries: LiveArchiveEntry[];
  placement: LiveArchivePlacement;
  /** グループページでは最初の数件だけ（残りは一覧ページへ） */
  limit?: number;
  moreHref?: string;
  officialListUrl?: string;
}) {
  const [sort, setSort] = useState<LiveSort>('old');
  const [format, setFormat] = useState<LiveFormatFilter>('all');
  const rootRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => filterEntries(sortEntries(entries, sort), format), [entries, sort, format]);
  const shown = limit ? visible.slice(0, limit) : visible;

  // 表示の計測：画面に入ったら1回（IntersectionObserver が無い環境では表示時に1回）
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      sendGaEvent(...liveArchiveViewEvent(groupId, groupName, placement, entries.length));
    };
    if (typeof IntersectionObserver === 'undefined') { send(); return; }
    const io = new IntersectionObserver((list) => {
      if (list.some((e) => e.isIntersecting)) { send(); io.disconnect(); }
    }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [groupId, groupName, placement, entries.length]);

  const onSort = (v: LiveSort) => {
    setSort(v);
    sendGaEvent(...liveArchiveFilterEvent(groupId, placement, { sort: v }));
  };
  const onFormat = (v: LiveFormatFilter) => {
    setFormat(v);
    sendGaEvent(...liveArchiveFilterEvent(groupId, placement, { format: v }));
  };

  const onProductClick = (entry: LiveArchiveEntry, item: LiveArchiveItem, position: number) => {
    // 既存の楽天クリック計測（グループページと同じく人物が特定できないため商品メタデータは上書きしない）
    trackRakutenClick({
      productId: item.productId,
      personSlug: '',
      title: `${entry.title} ${itemLabel(item)}`,
      category: 'Blu-ray・DVD',
      imageUrl: item.imageUrl,
      affiliateUrl: item.href,
      pageType: 'group',
      placement: `live_archive_${placement}`,
      position,
      linkElement: 'cta',
      saveMeta: false,
    });
    sendGaEvent(...liveArchiveProductClickEvent(groupId, placement, entry, item, position, { sort, format }));
  };

  return (
    <div ref={rootRef}>
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 mb-4">
          <ToggleGroup label="発売日" options={SORTS} value={sort} onChange={onSort} />
          <ToggleGroup label="形式" options={FORMATS} value={format} onChange={onFormat} />
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-sm px-4 py-3 rounded-xl" style={{ color: 'var(--ds-muted)', background: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}>
          現在、{groupName}のライブ映像で掲載できる商品はありません。
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm px-4 py-3 rounded-xl" style={{ color: 'var(--ds-muted)', background: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}>
          {format}の商品はありません。
        </p>
      ) : (
        <ul className="space-y-3">
          {shown.map((entry, idx) => (
            <li
              key={entry.id}
              className="p-3"
              style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius)' }}
            >
              <div className="flex gap-3">
                {entry.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={entry.imageUrl}
                    alt={entry.title}
                    className="w-20 h-20 sm:w-24 sm:h-24 object-contain rounded-lg flex-shrink-0"
                    style={{ background: '#f8f9fa' }}
                    loading="lazy"
                  />
                ) : (
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg flex-shrink-0 flex items-center justify-center text-2xl" style={{ background: '#f8f9fa', color: '#d1d5db' }} aria-hidden="true">
                    📀
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold" style={{ color: 'var(--ds-muted)' }}>
                    {formatReleaseDate(entry.releaseDate)}発売
                  </p>
                  <h3 className="text-sm font-bold leading-snug mt-0.5 break-words" style={{ color: 'var(--ds-text)' }}>{entry.title}</h3>
                  {entry.recorded && (
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--ds-muted)' }}>収録：{entry.recorded}</p>
                  )}
                </div>
              </div>
              {/* 盤ごとの楽天ボタンは画像の下に全幅で並べる（320px 幅でも押しやすく・読みやすく） */}
              <div className="mt-3 grid grid-cols-1 min-[420px]:grid-cols-2 gap-1.5">
                {entry.items.map((item, i) => (
                  <a
                    key={item.productId}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    onClick={() => onProductClick(entry, item, idx * 10 + i + 1)}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs hover:opacity-80 transition-opacity"
                    style={{ minHeight: 44, border: '1px solid var(--ds-border)', background: 'var(--ds-bg)', color: 'var(--ds-text)', textDecoration: 'none' }}
                  >
                    <span className="min-w-0">
                      <span className="font-bold block leading-tight">{itemLabel(item)}</span>
                      <span className="block text-[10px] leading-tight mt-0.5" style={{ color: 'var(--ds-muted)' }}>
                        {item.price != null
                          ? `¥${item.price.toLocaleString()}${item.priceDateLabel ? `（${item.priceDateLabel}）` : ''}`
                          : STALE_PRICE_LABEL}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] font-bold" style={{ color: 'var(--ds-cta)' }}>楽天で見る ›</span>
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {entries.length > 0 && (
        <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--ds-muted)' }}>
          公式サイトでライブ本編の収録作品と確認できた商品のうち、推しサーチに登録済みの楽天ブックスの商品だけを掲載しています。
          価格は楽天から取得した時点のものです。在庫・特典・収録内容の詳細は楽天の商品ページでご確認ください。
          {officialListUrl && (
            <>
              {' '}すべての映像作品は
              <a href={officialListUrl} target="_blank" rel="noopener noreferrer" className="underline">公式サイト</a>
              でご確認ください。
            </>
          )}
        </p>
      )}

      {moreHref && entries.length > 0 && (
        <div className="mt-3 text-center">
          <Link
            href={moreHref}
            className="inline-flex items-center justify-center px-5 rounded-full text-sm font-bold"
            style={{ minHeight: 44, border: '1px solid var(--ds-border)', background: 'var(--ds-surface)', color: 'var(--ds-text)' }}
          >
            ライブ映像の一覧を見る（{entries.length}作品）›
          </Link>
        </div>
      )}
    </div>
  );
}
