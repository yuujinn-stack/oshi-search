'use client';

// ライブ参戦服・ファッションレンタル比較（/oshikatsu/fashion-rental）の目的別絞り込み・サービスカード・比較表。
// - 絞り込み条件は URL の ?purpose=〇〇 と同期する。サーバー描画では全サービスを表示し、ブラウザで URL を読んでから絞り込む。
// - 目的は、各社の公式サイトに明記（または一部明記）されているものだけで判定する（src/lib/oshikatsu-services/fashion-rental.ts）。
// - 広告タグは、管理画面で承認済み・有効・安全確認OKのサービスだけ adTags に入る（改変せずに表示）。それ以外は公式サイトへの通常リンク。
// - GA4: 絞り込みは oshikatsu_fashion_filter。外部リンクは既存の oshikatsu_service_click（service_category=fashion_rental）。
//   広告タグのクリックは OshikatsuAdTag が既存の affiliate_click も送る（通常リンクでは affiliate_click は送らない）。

import { useEffect, useMemo, useState } from 'react';
import { sendGaEvent } from '@/lib/ga-event';
import ServiceOutboundLink from '@/components/oshikatsu/ServiceOutboundLink';
import OshikatsuAdTag from '@/components/oshikatsu/OshikatsuAdTag';
import {
  FASHION_PURPOSES,
  isFashionPurposeId,
  servicesForPurpose,
  type FashionPurposeId,
  type FashionService,
} from '@/lib/oshikatsu-services/fashion-rental';

const CATEGORY = 'fashion_rental';

interface Props {
  services: FashionService[];
  adTags: Record<string, { adHtml: string }>;
}

function writeParam(purpose: string) {
  // URL の書き換えに失敗しても、絞り込みと計測は続ける
  try {
    const url = new URL(window.location.href);
    if (purpose) url.searchParams.set('purpose', purpose); else url.searchParams.delete('purpose');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // 何もしない
  }
}

// カード下部の公式サイトボタン／広告枠（従来どおり）。
function Cta({ s, adHtml }: { s: FashionService; adHtml: string | undefined }) {
  if (adHtml) {
    return (
      <div id={`fr-${s.id}-cta`} className="gm-card-cta gm-card-cta--ad">
        <aside className="gm-ad gm-ad--text" aria-label={`${s.name}の広告`}>
          <span className="gm-pr">PR</span>
          <OshikatsuAdTag html={adHtml} serviceId={s.id} category={CATEGORY} placement="card_ad_tag" className="gm-ad-tag" />
        </aside>
      </div>
    );
  }
  return (
    <div id={`fr-${s.id}-cta`} className="gm-card-cta">
      <ServiceOutboundLink href={s.officialUrl} isAffiliate={false} serviceId={s.id} category={CATEGORY} placement="card" className="gm-btn">
        {s.name}の公式サイトで確認する ↗
      </ServiceOutboundLink>
    </div>
  );
}

// 料金プランの直後の公式サイトボタン。
// - 広告がない（提携未承認・広告OFF）ときは、下部と同じ公式サイトへの通常リンク（GA4 は placement=card_plan）。
// - 広告タグがあるとき（承認済み・広告有効）は、広告タグを2回出さない（計測用画像が二重に読み込まれるため）。
//   公式サイトへ直接移動すると誤解されないよう「PRリンクを見る」とし、カード下部の広告枠（A8の正規タグ）へ移動するページ内リンクにする。
function PlanCta({ s, hasAd }: { s: FashionService; hasAd: boolean }) {
  if (hasAd) {
    return (
      <p className="fr-plan-cta">
        <a href={`#fr-${s.id}-cta`} className="gm-btn fr-plan-btn" aria-label={`${s.name}のPRリンク（このカードの下部の広告）を見る`}>PRリンクを見る ↓</a>
      </p>
    );
  }
  return (
    <p className="fr-plan-cta">
      <ServiceOutboundLink href={s.officialUrl} isAffiliate={false} serviceId={s.id} category={CATEGORY} placement="card_plan" className="gm-btn fr-plan-btn">
        {s.name}の公式サイトで確認する ↗
      </ServiceOutboundLink>
    </p>
  );
}

function ServiceCard({ s, purpose, adHtml }: { s: FashionService; purpose: FashionPurposeId | ''; adHtml: string | undefined }) {
  const fit = purpose ? s.purposes[purpose] : undefined;
  return (
    <article id={`fr-${s.id}`} className="gm-card fr-card" aria-labelledby={`fr-${s.id}-name`}>
      <header className="gm-card-head">
        <span className="gm-mark" aria-hidden="true">{s.mark}</span>
        <div>
          <h3 id={`fr-${s.id}-name`} className="gm-card-name">{s.name}</h3>
          <p className="gm-card-op">運営：{s.operator}</p>
        </div>
      </header>
      <p className="gm-card-catch">{s.summary}</p>

      {fit && (
        <p className="fr-fit">
          <span className="fr-fit-label">{fit.fit === 'yes' ? '公式サイトに記載あり' : '一部の機能・条件で対応'}</span>
          {fit.note}
        </p>
      )}

      {/* 比較に重要な情報（常に表示）：料金・プラン → 公式サイトボタン → 選び方・送料・交換・サイズ */}
      <h4 className="gm-h4">月額料金とプラン</h4>
      <ul className="fr-plans">
        {s.plans.map((p) => (
          <li key={p.name}>
            <span className="fr-plan-name">{p.name}</span>
            <span className="fr-plan-price">{p.price}</span>
            <span className="fr-plan-detail">{p.detail}</span>
          </li>
        ))}
      </ul>
      {s.priceNote && <p className="gm-note fr-price-note">{s.priceNote}</p>}
      <PlanCta s={s} hasAd={Boolean(adHtml)} />

      <dl className="bb-facts fr-facts">
        <div><dt>服の選び方</dt><dd>{s.selection}</dd></div>
        <div><dt>新品・中古</dt><dd>{s.newOrUsed}</dd></div>
        <div><dt>配送料・返却手数料</dt><dd>{s.shipping}</dd></div>
        <div><dt>交換</dt><dd>{s.exchange}</dd></div>
        <div><dt>サイズ</dt><dd>{s.sizes}</dd></div>
      </dl>

      {/* 利用者に不利になりうる条件・追加料金の概要（折りたたまずに表示） */}
      <div className="fr-cautions">
        <h4 className="fr-cautions-title">注意したい条件・追加費用</h4>
        <ul className="gm-list fr-cautions-list">{s.cautionSummary.map((x) => <li key={x}>{x}</li>)}</ul>
      </div>

      <p className="fr-availability">{s.availability}</p>

      {/* 詳しい条件（開閉できる。details/summary なのでキーボード・タップで操作できる） */}
      <details className="gm-more fr-more">
        <summary>契約・解約の詳しい条件（自動更新・途中解約金・返却期限）</summary>
        <div className="bb-more-body">
          <dl className="bb-facts fr-facts fr-contract">
            <div><dt>自動更新</dt><dd>{s.autoRenew}</dd></div>
            <div><dt>1か月だけの利用</dt><dd>{s.oneMonth}</dd></div>
            <div><dt>長期コース・途中解約金</dt><dd>{s.longTerm}</dd></div>
            <div><dt>返却期限</dt><dd>{s.returnDeadline}</dd></div>
            <div><dt>解約・休会の手続き</dt><dd>{s.cancel}</dd></div>
          </dl>
        </div>
      </details>

      <details className="gm-more fr-more">
        <summary>汚損・破損・紛失時の費用と補償</summary>
        <div className="bb-more-body">
          <p className="bb-small">{s.damage}</p>
          <p className="bb-small fr-links">
            {s.damageLinks.map((l, i) => (
              <span key={l.url}>{i > 0 && '・'}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></span>
            ))}
          </p>
        </div>
      </details>

      <details className="gm-more fr-more">
        <summary>借りられる服・購入・注意事項</summary>
        <div className="bb-more-body">
          <h5 className="bb-h5">借りられる服</h5>
          <p className="bb-small">{s.items}</p>
          <h5 className="bb-h5">レンタルした服の購入</h5>
          <p className="bb-small">{s.purchase}</p>
          {s.notes.length > 0 && (
            <>
              <h5 className="bb-h5">注意事項</h5>
              <ul className="gm-list bb-small-list">{s.notes.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          )}
        </div>
      </details>

      <Cta s={s} adHtml={adHtml} />
    </article>
  );
}

export default function FashionExplorer({ services, adTags }: Props) {
  const [purpose, setPurpose] = useState<FashionPurposeId | ''>('');

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('purpose') ?? '';
    if (isFashionPurposeId(raw)) setPurpose(raw);
  }, []);

  const visible = useMemo(() => servicesForPurpose(purpose, services), [services, purpose]);

  const apply = (next: FashionPurposeId | '') => {
    setPurpose(next);
    writeParam(next);
    sendGaEvent('oshikatsu_fashion_filter', { filter_type: 'purpose', filter_value: next || 'all', result_count: servicesForPurpose(next, services).length });
  };

  const label = FASHION_PURPOSES.find((p) => p.id === purpose)?.label;

  return (
    <div className="fr-explorer">
      <div className="bb-filters" role="search" aria-label="目的で絞り込む">
        <fieldset className="bb-filter">
          <legend className="bb-filter-label">目的で絞り込む</legend>
          <div className="bb-chips">
            {FASHION_PURPOSES.map((p) => (
              <button key={p.id} type="button" className="bb-chip" aria-pressed={purpose === p.id} onClick={() => apply(purpose === p.id ? '' : p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="bb-result" aria-live="polite">
          {purpose ? (
            <>
              「{label}」に合う機能を公式サイトで案内しているサービス：{visible.length}件
              <button type="button" className="bb-reset" onClick={() => apply('')}>絞り込みを解除</button>
            </>
          ) : (
            <>全{services.length}サービスを表示中</>
          )}
        </p>
        <p className="gm-note bb-filter-note">絞り込みは、各社の公式サイトの記載をもとに判定しています。借りられる服の色・サイズ・在庫は時期によって変わるため、各公式サイトで確認してください。</p>
      </div>

      {visible.length > 0 ? (
        <div className="gm-cards">
          {visible.map((s) => <ServiceCard key={s.id} s={s} purpose={purpose} adHtml={adTags[s.id]?.adHtml} />)}
        </div>
      ) : (
        <p className="bb-empty">
          この目的に合う機能を公式サイトで案内しているサービスは確認できませんでした。
          <button type="button" className="bb-reset" onClick={() => apply('')}>絞り込みを解除</button>
        </p>
      )}

      {visible.length > 0 && (
        <section className="bb-compare" aria-labelledby="fr-compare-heading">
          <h3 id="fr-compare-heading" className="bb-compare-title">料金・使い方の比較</h3>
          <p className="gm-scroll-hint" aria-hidden="true">← 横にスクロールして比較 →</p>
          <div className="gm-table-wrap" role="region" aria-label="比較表（横にスクロールできます）" tabIndex={0}>
            <table className="gm-table bb-table fr-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">項目</span></th>
                  {visible.map((s) => <th key={s.id} scope="col">{s.name}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr><th scope="row">月額料金</th>{visible.map((s) => <td key={s.id}>{s.plans.map((p) => `${p.name} ${p.price}`).join(' / ')}</td>)}</tr>
                <tr><th scope="row">服の選び方</th>{visible.map((s) => <td key={s.id}>{s.selection}</td>)}</tr>
                <tr><th scope="row">新品・中古</th>{visible.map((s) => <td key={s.id}>{s.newOrUsed}</td>)}</tr>
                <tr><th scope="row">配送料・返却手数料</th>{visible.map((s) => <td key={s.id}>{s.shipping}</td>)}</tr>
                <tr><th scope="row">交換</th>{visible.map((s) => <td key={s.id}>{s.exchange}</td>)}</tr>
                <tr><th scope="row">自動更新</th>{visible.map((s) => <td key={s.id}>{s.autoRenew}</td>)}</tr>
                <tr><th scope="row">1か月だけの利用</th>{visible.map((s) => <td key={s.id}>{s.oneMonth}</td>)}</tr>
                <tr><th scope="row">長期コース・途中解約金</th>{visible.map((s) => <td key={s.id}>{s.longTerm}</td>)}</tr>
                <tr><th scope="row">返却期限</th>{visible.map((s) => <td key={s.id}>{s.returnDeadline}</td>)}</tr>
                <tr><th scope="row">解約・休会</th>{visible.map((s) => <td key={s.id}>{s.cancel}</td>)}</tr>
                <tr><th scope="row">サイズ</th>{visible.map((s) => <td key={s.id}>{s.sizes}</td>)}</tr>
                <tr>
                  <th scope="row">汚損・紛失時</th>
                  {visible.map((s) => (
                    <td key={s.id}>
                      {s.damage}
                      <span className="fr-table-links">
                        {s.damageLinks.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>)}
                      </span>
                    </td>
                  ))}
                </tr>
                <tr><th scope="row">希望の服が借りられるか</th>{visible.map((s) => <td key={s.id}>{s.availability}</td>)}</tr>
                <tr><th scope="row">購入</th>{visible.map((s) => <td key={s.id}>{s.purchase}</td>)}</tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
