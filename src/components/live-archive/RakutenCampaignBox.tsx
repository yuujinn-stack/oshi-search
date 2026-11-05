'use client';

// 楽天のキャンペーン（お買い物マラソン・スーパーSALE 等）の紹介枠。
// 表示してよいイベントはサーバーで決める（src/lib/rakuten-campaign/core.ts publicCampaigns）。
// 開いたままのページでも終了後に「開催中」と出し続けないよう、表示後に端末の時刻で状態を確認し直す
// （終了したら枠から外す。開始時刻を過ぎたら「開催予定」→「開催中」）。
// イベント名・期間・楽天公式ページへの案内だけを表示し、ポイント倍率・特典・対象商品・最安値は書かない。
import { useEffect, useState } from 'react';
import { sendGaEvent } from '@/lib/ga-event';
import { rakutenCampaignClickEvent } from '@/lib/live-archive/ga';
import { campaignPeriodLabel, statusAt, type CampaignStatus, type PublicCampaign } from '@/lib/rakuten-campaign/core';

const STATUS_LABEL: Record<CampaignStatus, string> = { active: '開催中', upcoming: '開催予定' };

export default function RakutenCampaignBox({ campaigns, placement, groupId }: {
  campaigns: PublicCampaign[];
  placement: string;
  groupId?: string;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const list = campaigns
    .map((c) => ({ c, status: now == null ? c.status : statusAt(c, now) }))
    .filter((x): x is { c: PublicCampaign; status: CampaignStatus } => x.status != null);
  if (!list.length) return null;

  return (
    <aside
      aria-label="楽天のキャンペーン"
      className="p-4"
      style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-radius)' }}
    >
      <p className="text-xs font-bold" style={{ color: 'var(--ds-text)' }}>楽天のキャンペーン情報</p>
      <ul className="mt-2 space-y-2">
        {list.map(({ c, status }) => (
          <li key={c.id}>
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => sendGaEvent(...rakutenCampaignClickEvent(c, status, placement, groupId))}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:opacity-80 transition-opacity"
              style={{ minHeight: 44, border: '1px solid var(--ds-border)', background: 'var(--ds-bg)', color: 'var(--ds-text)', textDecoration: 'none' }}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={status === 'active'
                      ? { background: '#BF0000', color: '#fff' }
                      : { border: '1px solid var(--ds-border)', color: 'var(--ds-muted)' }}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                  <span className="text-sm font-bold break-words">{c.name}</span>
                </span>
                <span className="block text-[11px] mt-0.5" style={{ color: 'var(--ds-muted)' }}>{campaignPeriodLabel(c)}（日本時間）</span>
              </span>
              <span className="shrink-0 text-[11px] font-bold" style={{ color: 'var(--ds-cta)' }}>
                {c.isEntry ? 'エントリーページ ›' : '楽天公式ページ ›'}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-[11px] mt-2 leading-relaxed" style={{ color: 'var(--ds-muted)' }}>
        参加条件・ポイント・エントリーの要否は楽天の公式ページでご確認ください。このページの商品がキャンペーンの対象かどうかは確認していません。
      </p>
    </aside>
  );
}
