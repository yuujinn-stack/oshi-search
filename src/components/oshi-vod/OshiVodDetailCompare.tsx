// 詳しい比較（折りたたみ）。スマホでは表ではなくサービスごとのカードを縦に並べる。
// 見放題・無料・レンタル/購入を別々に数え、比較に使ったプラン・料金・確認日・出典を必ず表示する。
import ProviderLogo from '@/components/ProviderLogo';
import type { DiagnosisResult, WorkServiceRef } from '@/lib/oshi-vod/types';
import { DIAGNOSIS_RENTAL_STORE_SERVICES } from '@/lib/oshi-vod/core';
import { formatCoverage, formatIsoDateJa, formatMonthlyPrice, formatWorkFraction, priceExclusionLabel } from '@/lib/oshi-vod/format';
import OshiVodServiceCta from './OshiVodServiceCta';
import { secLabel } from './sec-label';

export default function OshiVodDetailCompare({ result }: { result: DiagnosisResult }) {
  const paidTotal = result.totals.paid;
  // 表示順: 作品数重視の順位 → それ以外（無料・レンタルのみのサービス）はサービス定義順
  const ranked = result.byWorkCount.map((r) => r.stat);
  const rankedSet = new Set(ranked.map((s) => s.service));
  const stats = [...ranked, ...result.stats.filter((s) => !rankedSet.has(s.service))];

  // 追加チャンネル・料金情報のないサービスは作品単位で集計して別欄に
  const extra = new Map<string, { ref: WorkServiceRef; count: number }>();
  for (const w of result.works) {
    for (const r of w.services) {
      if (r.bucket !== 'channel' && r.bucket !== 'other') continue;
      const key = `${r.bucket}:${r.displayName}`;
      const e = extra.get(key) ?? { ref: r, count: 0 };
      e.count += 1;
      extra.set(key, e);
    }
  }
  const extras = [...extra.values()].sort((a, b) => b.count - a.count);

  return (
    <section aria-labelledby="ov-detail-heading" style={secLabel('COMPARE')}>
      <h2 id="ov-detail-heading" className="ov-h2">サービス別の詳しい比較</h2>
      <details className="ov-more">
        <summary>詳しい比較を見る（{stats.length}サービス）</summary>
        <ul className="ov-detail-list">
          {stats.map((s) => {
            const price = formatMonthlyPrice(s.plan, s.priceComparable);
            const checked = formatIsoDateJa(s.plan?.checkedAt ?? null);
            return (
              <li key={s.service} className="ov-panel">
                <div className="flex items-center gap-2">
                  <ProviderLogo providerName={s.service} logoPath={s.logoPath} size="md" />
                  <p className="ov-panel-title m-0">{s.displayName}</p>
                </div>
                <dl className="ov-detail-grid">
                  <div>
                    <dt>見放題</dt>
                    <dd>
                      {s.plan?.kind === 'free'
                        ? '対象外（無料サービス）'
                        : `${formatWorkFraction(s.paidKeys.length, paidTotal)}（${formatCoverage(s.paidKeys.length, paidTotal)}）`}
                    </dd>
                  </div>
                  <div><dt>無料</dt><dd>{s.freeKeys.length}作品</dd></div>
                  <div><dt>レンタル・購入</dt><dd>{s.rentalKeys.length}作品</dd></div>
                  <div><dt>比較プラン</dt><dd>{s.priceComparable && s.plan?.planName ? s.plan.planName : '—'}</dd></div>
                  <div>
                    <dt>月額</dt>
                    <dd>
                      {price
                        ?? (DIAGNOSIS_RENTAL_STORE_SERVICES.has(s.service)
                          ? '対象外（レンタル・購入）'
                          : `比較対象外（${priceExclusionLabel(s.plan, 'short')}）`)}
                    </dd>
                  </div>
                  <div>
                    <dt>料金確認日</dt>
                    <dd>
                      {s.priceComparable && checked && s.plan?.sourceUrl
                        ? <a href={s.plan.sourceUrl} target="_blank" rel="noopener noreferrer" className="theme-text-link">{checked}（公式）</a>
                        : '—'}
                    </dd>
                  </div>
                </dl>
                {s.plan?.note && <p className="ov-note">{s.plan.note}</p>}
                <OshiVodServiceCta service={s.service} displayName={s.displayName} logoPath={s.logoPath} placement="detail" variant="compact" />
              </li>
            );
          })}
        </ul>
        {extras.length > 0 && (
          <div className="ov-panel mt-3">
            <p className="ov-panel-title">そのほかの配信（ランキング対象外）</p>
            <p className="ov-note">
              Prime Video の追加チャンネルは Prime Video の会員費とは別に料金がかかるため、Prime Video 本体の見放題には数えていません。
              料金情報を登録していないサービスもここに表示しています。
            </p>
            <ul className="ov-extra-list">
              {extras.map(({ ref, count }) => (
                <li key={`${ref.bucket}-${ref.displayName}`}>
                  {ref.displayName}
                  {ref.bucket === 'channel' && <span className="ov-badge">追加チャンネル</span>}
                  ：{count}作品
                  <span className="ov-muted">（{ref.bucket === 'channel' ? '別料金の追加チャンネルのため比較対象外' : '料金情報を登録していないため比較対象外'}）</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </section>
  );
}
