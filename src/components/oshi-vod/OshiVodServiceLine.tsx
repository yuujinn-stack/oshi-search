// 診断結果でサービス1件を「ロゴ＋名前＋数字の根拠」で表示する共通行。
// 例: U-NEXT / 14 / 21作品・カバー率66.6%・月額2,189円（税込）
import ProviderLogo from '@/components/ProviderLogo';
import type { ServiceStat } from '@/lib/oshi-vod/types';
import { formatCoverage, formatMonthlyPrice, formatWorkFraction, formatYen } from '@/lib/oshi-vod/format';
import { costPerWork } from '@/lib/oshi-vod/core';

interface Props {
  stat: ServiceStat;
  paidTotal: number;
  rankLabel?: string;
  /** 強調する指標（ランキング種別ごとに主指標を太字にする） */
  emphasis?: 'count' | 'price' | 'cost';
  showCost?: boolean;
}

export default function OshiVodServiceLine({ stat, paidTotal, rankLabel, emphasis = 'count', showCost = false }: Props) {
  const count = stat.paidKeys.length;
  const price = formatMonthlyPrice(stat.plan, stat.priceComparable);
  const cost = stat.priceComparable ? costPerWork(stat.plan!.monthlyPrice, count) : null;
  return (
    <div className="ov-line">
      {rankLabel && <span className="ov-rank" aria-label={`${rankLabel}`}>{rankLabel}</span>}
      <ProviderLogo providerName={stat.service} logoPath={stat.logoPath} size="md" />
      <div className="min-w-0 flex-1">
        <p className="ov-line-name">{stat.displayName}</p>
        <p className="ov-line-nums">
          <span className={emphasis === 'count' ? 'ov-em' : undefined}>{formatWorkFraction(count, paidTotal)}</span>
          <span>カバー率{formatCoverage(count, paidTotal)}</span>
          {price
            ? <span className={emphasis === 'price' ? 'ov-em' : undefined}>{price}</span>
            : <span className="ov-muted">料金比較対象外</span>}
          {showCost && cost != null && (
            <span className={emphasis === 'cost' ? 'ov-em' : undefined}>1作品あたり約{formatYen(cost)}</span>
          )}
        </p>
      </div>
    </div>
  );
}
