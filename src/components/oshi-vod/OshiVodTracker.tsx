'use client';

// 診断結果ページの計測（GA4）。
// - diagnosis_complete: 結果表示時に1回（同じ組み合わせの再表示は30分間送らない）
// - diagnosis_cta_click: 子孫の [data-ov-cta] 内のリンククリックをイベントバブリングで検知する
//   （OshiAdBanner と同じ方式。ASP広告コード自体には手を入れない）。
//   link_type で「アフィリエイト広告（AffiliateSlot 内のリンク）」か「公式サイト」かを区別する。
// - /api/track（VODクリック数）: 公式サイトへの VodTrackLink クリックは既存どおり VodTrackLink 自身が記録する。
//   アフィリエイト広告のリンクは ASP コードのため VodTrackLink を通らないので、ここで同じ
//   { type: 'vod', service } を送り、リンク先がアフィリエイトに変わってもクリック数の計測が途切れないようにする。
import { useEffect, type ReactNode } from 'react';
import { sendGaEvent } from '@/lib/ga-event';

const DEDUP_MS = 30 * 60 * 1000;

interface Props {
  resultKey: string;
  personCount: number;
  topService: string | null;
  targetWorkCount: number;
  children: ReactNode;
}

export default function OshiVodTracker({ resultKey, personCount, topService, targetWorkCount, children }: Props) {
  useEffect(() => {
    const key = `oshi-vod-complete:${resultKey}`;
    try {
      const last = parseInt(localStorage.getItem(key) ?? '0', 10);
      if (Date.now() - last < DEDUP_MS) return;
      localStorage.setItem(key, String(Date.now()));
    } catch { /* localStorage 不可でも送信は続行 */ }
    sendGaEvent('diagnosis_complete', {
      person_count: personCount,
      top_service: topService ?? 'none',
      target_work_count: targetWorkCount,
    });
  }, [resultKey, personCount, topService, targetWorkCount]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const link = target?.closest('a');
    if (!link) return;
    const cta = link.closest<HTMLElement>('[data-ov-cta]');
    if (!cta) return;
    const service = cta.dataset.vodService ?? '';
    const isAffiliate = !!link.closest('.affiliate-slot');
    sendGaEvent('diagnosis_cta_click', {
      service,
      placement: cta.dataset.ovPlacement ?? '',
      rank: cta.dataset.ovRank ? Number(cta.dataset.ovRank) : undefined,
      person_count: personCount,
      link_type: isAffiliate ? 'affiliate' : 'official',
    });
    if (isAffiliate && service) {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'vod', service }),
        keepalive: true,
      }).catch(() => {});
    }
  };

  return <div onClick={handleClick}>{children}</div>;
}
