'use client';

// 過去のライブ映像特集の「楽天のイベント情報」（小さな案内）。人物ページのコーナー・グループページ・ライブ映像一覧で共用。
// - 出してよいイベントはサーバーで決める（src/lib/rakuten-campaign/core.ts liveArchiveCampaigns：管理画面で公開・公式確認済み・
//   開催中で、楽天市場の買いまわり／楽天ブックスのDVD・Blu-ray関連の2系統。同じイベントは1回だけ）
// - 開いたままのページでも終了後に出し続けないよう、終了時刻ちょうど（と1分ごと・タブに戻ったとき）に端末の時刻で確認し直し、
//   終了したものは外す（全部終われば案内ごと消える）
// - リンク先は楽天公式のエントリーページ（無ければ公式ページ）。商品の購入先（楽天アフィリエイトの商品リンク）とは分け、
//   ボタンの文言も「楽天で見る」と区別する
// - イベント名・種類・終了日時・簡潔な参加条件だけを表示し、商品ごとのポイント倍率・対象かどうか・値下げ・在庫は書かない
// - クリックは既存の GA4 rakuten_campaign_click で計測する
import { useEffect, useState } from 'react';
import { sendGaEvent } from '@/lib/ga-event';
import { rakutenCampaignClickEvent } from '@/lib/live-archive/ga';
import {
  campaignEndLabel, liveArchiveCampaigns, liveCampaignKindOf, LIVE_CAMPAIGN_KIND_LABEL, shortConditions,
  type LiveCampaignKind, type PublicCampaign,
} from '@/lib/rakuten-campaign/core';

const KIND_STYLE: Record<LiveCampaignKind, React.CSSProperties> = {
  market_kaimawari: { background: '#BF0000', color: '#FFFFFF' },
  books_media: { background: '#0A0A0A', color: '#FFFFFF' },
};

/** setTimeout の上限（約24.8日）を超えないようにする */
const MAX_TIMEOUT_MS = 2_000_000_000;

export default function RakutenCampaignBox({ campaigns, placement, groupId, className }: {
  campaigns: PublicCampaign[];
  placement: string;
  groupId?: string;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const interval = setInterval(tick, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // 次に終わるイベントの終了時刻ちょうどに確認し直す
  useEffect(() => {
    if (now == null) return;
    const ends = campaigns.map((c) => c.endsAt).filter((e) => e > now);
    if (!ends.length) return;
    const t = setTimeout(() => setNow(Date.now()), Math.min(Math.min(...ends) - now + 50, MAX_TIMEOUT_MS));
    return () => clearTimeout(t);
  }, [now, campaigns]);

  // 表示前（サーバーの描画とそろえる間）はサーバーで選んだものをそのまま、表示後は端末の時刻で選び直す
  const list = now == null ? campaigns : liveArchiveCampaigns(campaigns, now);
  if (!list.length) return null;

  return (
    <aside
      aria-label="楽天のイベント情報"
      className={`px-3 py-2.5 ${className ?? ''}`}
      style={{ background: 'var(--ds-surface)', border: '1px dashed var(--ds-border)', borderRadius: 'var(--ds-radius)' }}
    >
      <p className="text-[11px] font-bold" style={{ color: 'var(--ds-text)' }}>
        楽天のイベント情報
        <span className="font-normal" style={{ color: 'var(--ds-muted)' }}>（エントリーは楽天の公式ページで。商品の購入ページとは別です）</span>
      </p>
      <ul className="mt-2 space-y-1.5">
        {list.map((c) => {
          const kind = liveCampaignKindOf(c.eventType);
          const cond = shortConditions(c);
          return (
            <li key={c.id}>
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => sendGaEvent(...rakutenCampaignClickEvent(c, 'active', placement, groupId))}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3 px-2.5 py-2 hover:opacity-80 transition-opacity"
                style={{ minHeight: 44, border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius)', background: 'var(--ds-bg)', color: 'var(--ds-text)', textDecoration: 'none' }}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center" style={{ columnGap: 6, rowGap: 2 }}>
                    {kind && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0" style={KIND_STYLE[kind]}>
                        {LIVE_CAMPAIGN_KIND_LABEL[kind]}
                      </span>
                    )}
                    <span className="text-[13px] font-bold break-words">{c.name}</span>
                  </span>
                  <span className="block text-[11px] mt-0.5" style={{ color: 'var(--ds-muted)' }}>
                    開催中・{campaignEndLabel(c)}（日本時間）
                  </span>
                  {cond && (
                    <span className="block text-[11px] mt-0.5 break-words" style={{ color: 'var(--ds-muted)' }}>参加条件：{cond}</span>
                  )}
                </span>
                <span className="shrink-0 self-end sm:self-auto text-[11px] font-bold" style={{ color: 'var(--ds-cta)' }}>
                  {c.isEntry ? 'エントリーページ ›' : '楽天公式ページ ›'}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'var(--ds-muted)' }}>
        参加条件・ポイントの詳細は楽天の公式ページでご確認ください。この特集の商品がキャンペーンの対象かどうか、ポイント倍率・価格・在庫は確認していません。
      </p>
    </aside>
  );
}
