// 2サービス最適化：「一番多く見られる2サービス」と「80%以上を最安で見る方法」。
// どちらも和集合で数えるため、両方で配信されている作品を2重に数えない。
import ProviderLogo from '@/components/ProviderLogo';
import type { DiagnosisResult, ServiceCombo } from '@/lib/oshi-vod/types';
import { formatCoverage, formatMonthlyPrice, formatWorkFraction, formatYen, priceExclusionLabel } from '@/lib/oshi-vod/format';
import OshiVodServiceCta, { type OshiVodCtaPlacement } from './OshiVodServiceCta';
import { secLabel } from './sec-label';

function ComboView({ combo, paidTotal, placement }: { combo: ServiceCombo; paidTotal: number; placement: OshiVodCtaPlacement }) {
  return (
    <>
      <div className="ov-combo-services">
        {combo.services.map((s, i) => (
          <span key={s.service} className="ov-combo-service">
            {i > 0 && <span className="ov-combo-plus" aria-hidden="true">＋</span>}
            <ProviderLogo providerName={s.service} logoPath={s.logoPath} size="sm" />
            <span className="font-bold">{s.displayName}</span>
          </span>
        ))}
      </div>
      <p className="ov-line-nums">
        <span className="ov-em">{formatWorkFraction(combo.unionCount, paidTotal)}</span>
        <span>カバー率{formatCoverage(combo.unionCount, paidTotal)}</span>
        <span>{combo.totalPrice != null ? `合計 月額${formatYen(combo.totalPrice)}` : '料金未確認のサービスを含むため合計月額は表示できません'}</span>
      </p>
      <ul className="ov-combo-breakdown">
        {combo.services.map((s) => (
          <li key={s.service}>
            {s.displayName}：{s.paidKeys.length}作品・{formatMonthlyPrice(s.plan, s.priceComparable) ?? priceExclusionLabel(s.plan)}
            {s.priceComparable && s.plan?.planName && !s.plan.priceLabel ? `（${s.plan.planName}）` : ''}
          </li>
        ))}
      </ul>
      <div className="ov-combo-ctas">
        {combo.services.map((s) => (
          <OshiVodServiceCta key={s.service} service={s.service} displayName={s.displayName} logoPath={s.logoPath} placement={placement} />
        ))}
      </div>
    </>
  );
}

export default function OshiVodPairs({ result }: { result: DiagnosisResult }) {
  const paidTotal = result.totals.paid;
  if (paidTotal === 0) return null;
  const { bestPair, over80 } = result;
  return (
    <section aria-labelledby="ov-pairs-heading" style={secLabel('COMBINATION')}>
      <h2 id="ov-pairs-heading" className="ov-h2">組み合わせて見るなら</h2>
      <div className="ov-panels">
        <div className="ov-panel">
          <h3 className="ov-panel-title">{bestPair && bestPair.services.length === 1 ? '一番多く見られるサービス' : '一番多く見られる2サービス'}</h3>
          {result.singleCoversAll && (
            <p className="ov-note">1サービス（{result.byWorkCount[0].stat.displayName}）だけで、見放題確認できる全作品を見られます。</p>
          )}
          {bestPair ? <ComboView combo={bestPair} paidTotal={paidTotal} placement="pair" /> : <p className="ov-note">該当するサービスがありません。</p>}
        </div>

        <div className="ov-panel">
          <h3 className="ov-panel-title">80%以上を最安で見る方法</h3>
          {over80.achieved && over80.combo ? (
            <>
              <p className="ov-note">
                {over80.combo.services.length === 1
                  ? '1サービスだけで80%以上の作品を見られます。'
                  : '1サービスでは80%に届かないため、2サービスの組み合わせで最も安いものです。'}
              </p>
              <ComboView combo={over80.combo} paidTotal={paidTotal} placement="over80" />
            </>
          ) : (
            <>
              <p className="ov-notice">80%以上をカバーできる組み合わせ（1〜2サービス）は見つかりませんでした。</p>
              {over80.bestPossible && (
                <p className="ov-note">
                  料金を比較できるサービスでの最大は
                  {over80.bestPossible.services.map((s) => s.displayName).join('＋')}
                  の{formatWorkFraction(over80.bestPossible.unionCount, paidTotal)}（{formatCoverage(over80.bestPossible.unionCount, paidTotal)}）です。
                </p>
              )}
            </>
          )}
          <p className="ov-note">料金を公式サイトで確認できなかったサービスはこの計算に含めていません。</p>
        </div>
      </div>
    </section>
  );
}
