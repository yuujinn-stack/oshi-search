// 診断結果の最上部：結論（1文）＋作品数重視1位の数字の根拠＋CTA。詳細は下のセクションへ。
import ProviderLogo from '@/components/ProviderLogo';
import type { DiagnosisResult } from '@/lib/oshi-vod/types';
import { formatCoverage, formatWorkFraction, formatYen, priceExclusionLabel } from '@/lib/oshi-vod/format';
import OshiVodServiceCta from './OshiVodServiceCta';
import { secLabel } from './sec-label';

export default function OshiVodResultHero({ result }: { result: DiagnosisResult }) {
  const { totals } = result;
  const topTied = result.byWorkCount.filter((r) => r.rank === 1);

  return (
    <section className="ov-hero" aria-labelledby="ov-hero-heading" style={secLabel('RESULT')}>
      <h2 id="ov-hero-heading" className="ov-hero-headline">{result.headline}</h2>

      <ul className="ov-person-tags" aria-label="診断した推し">
        {result.persons.map((p) => (
          <li key={p.name}><span className="ov-person-tag">{p.name}</span></li>
        ))}
      </ul>

      {topTied.length > 0 && (
        <div className="ov-hero-cards">
          {topTied.map((r) => {
            return (
              <div key={r.stat.service} className="ov-hero-card">
                <div className="flex items-center gap-3">
                  <ProviderLogo providerName={r.stat.service} logoPath={r.stat.logoPath} size="xl" />
                  <div className="min-w-0">
                    <p className="ov-hero-badge">{r.tied ? '作品数重視 同率1位' : '作品数重視 1位'}</p>
                    <p className="ov-hero-service">{r.stat.displayName}</p>
                  </div>
                </div>
                <p className="ov-hero-main-num">
                  <span className="ov-hero-main-label">対象{totals.paid}作品中、見放題で見られる作品</span>
                  <span className="ov-hero-main-value">{formatWorkFraction(r.paidCount, totals.paid)}</span>
                  {/* 分母（対象作品）と登録出演作品の違いを小さく補足する */}
                  <span className="ov-hero-main-caption">
                    対象＝現在いずれかの有料サブスクで見放題確認できる{totals.paid}作品（登録出演作品{totals.registered}作品のうち）
                  </span>
                </p>
                <dl className="ov-hero-nums">
                  <div><dt>カバー率</dt><dd>{formatCoverage(r.paidCount, totals.paid)}</dd></div>
                  <div>
                    <dt>料金</dt>
                    <dd>
                      {r.stat.priceComparable && r.stat.plan?.monthlyPrice != null ? (
                        <>
                          {r.stat.plan.priceLabel ?? '月額'}{formatYen(r.stat.plan.monthlyPrice)}
                          <span className="ov-hero-tax">{r.stat.plan.taxIncluded ? '税込' : '税抜'}</span>
                        </>
                      ) : priceExclusionLabel(r.stat.plan, 'short')}
                    </dd>
                  </div>
                </dl>
                {r.stat.plan?.planName && r.stat.priceComparable && (
                  <p className="ov-note">比較プラン：{r.stat.plan.planName}</p>
                )}
                <OshiVodServiceCta service={r.stat.service} displayName={r.stat.displayName} logoPath={r.stat.logoPath} placement="hero" rank={1} size="md" />
              </div>
            );
          })}
        </div>
      )}

      <p className="ov-hero-links">
        <a href="#ov-rankings-heading" className="theme-text-link">ランキングを見る ↓</a>
        <a href="#ov-share-heading" className="theme-text-link">結果をシェア ↓</a>
      </p>

      {/* 何を分母にしているかを明示する */}
      <dl className="ov-totals">
        <div><dt>登録出演作品</dt><dd>{totals.registered}作品</dd></div>
        <div><dt>現在、有料サブスクで見放題確認できる作品</dt><dd>{totals.paid}作品</dd></div>
        <div><dt>無料で見られる作品</dt><dd>{totals.free}作品</dd></div>
      </dl>
      <p className="ov-note">
        カバー率は「現在いずれかの有料サブスクで見放題配信が確認できる作品（{totals.paid}作品）」に対する割合です。
        同じ作品に複数の推しが出演している場合は1作品として数えています。
      </p>
    </section>
  );
}
