'use client';

// 推し活グッズ買取サービス比較（/oshikatsu/goods-buyback）の絞り込み・サービスカード・比較表。
// - 絞り込み条件は URL の ?group=〇〇&goods=〇〇 と同期する（人物・グループページから所属グループを選んだ状態で開ける）。
//   サーバー描画では全サービスを表示し、ブラウザで URL を読んでから絞り込む（検索エンジン向けの内容は常に全件）。
// - 買取対象グループは各社の公式サイトに名前が明記されているものだけ（src/lib/oshikatsu-services/goods-buyback.ts）。
// - 広告タグは、管理画面で承認済み・有効・安全確認OKのサービスだけ adTags に入る（改変せずに表示）。それ以外は公式サイトへの通常リンク。
// - GA4: 絞り込み操作は oshikatsu_buyback_filter、外部リンクは既存の oshikatsu_service_click（service_category=goods_buyback）。

import { useEffect, useMemo, useState } from 'react';
import { sendGaEvent } from '@/lib/ga-event';
import ServiceOutboundLink from '@/components/oshikatsu/ServiceOutboundLink';
import OshikatsuAdTag from '@/components/oshikatsu/OshikatsuAdTag';
import {
  BUYBACK_GOODS_TYPES,
  NEEDS_CHECK,
  filterBuybackServices,
  groupKey,
  isBuybackGoodsTypeId,
  servicesForGroup,
  type BuybackGoodsTypeId,
  type BuybackGroup,
  type BuybackService,
} from '@/lib/oshikatsu-services/goods-buyback';

const CATEGORY = 'goods_buyback';

interface Props {
  services: BuybackService[];
  groupOptions: string[];
  adTags: Record<string, { adHtml: string }>;
}

const GOODS_STATUS_LABEL = { yes: '明記あり', conditional: '条件あり', excluded: '買取不可' } as const;

function readParams(groupOptions: string[]): { group: string; goods: BuybackGoodsTypeId | '' } {
  const p = new URLSearchParams(window.location.search);
  const rawGroup = (p.get('group') ?? '').trim();
  const opt = rawGroup ? groupOptions.find((o) => groupKey(o) === groupKey(rawGroup)) : undefined;
  const rawGoods = p.get('goods') ?? '';
  return { group: opt ?? rawGroup, goods: isBuybackGoodsTypeId(rawGoods) ? rawGoods : '' };
}

function writeParams(group: string, goods: string) {
  // URL の書き換えに失敗しても、絞り込みと計測は続ける
  try {
    const url = new URL(window.location.href);
    if (group) url.searchParams.set('group', group); else url.searchParams.delete('group');
    if (goods) url.searchParams.set('goods', goods); else url.searchParams.delete('goods');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // 何もしない
  }
}

function Cta({ s, adHtml }: { s: BuybackService; adHtml: string | undefined }) {
  if (adHtml) {
    return (
      <div className="gm-card-cta gm-card-cta--ad">
        <aside className="gm-ad gm-ad--text" aria-label={`${s.name}の広告`}>
          <span className="gm-pr">PR</span>
          <OshikatsuAdTag html={adHtml} serviceId={s.id} category={CATEGORY} placement="card_ad_tag" className="gm-ad-tag" />
        </aside>
      </div>
    );
  }
  if (s.officialUrl) {
    return (
      <div className="gm-card-cta">
        <ServiceOutboundLink href={s.officialUrl} isAffiliate={false} serviceId={s.id} category={CATEGORY} placement="card" className="gm-btn">
          {s.name}の公式サイトで確認する ↗
        </ServiceOutboundLink>
      </div>
    );
  }
  return (
    <div className="gm-card-cta">
      <p className="bb-no-link">{`公式サイト：${NEEDS_CHECK}（確認できるまでリンクを掲載していません）`}</p>
    </div>
  );
}

function GroupLine({ group, hit }: { group: string; hit: BuybackGroup }) {
  // 公式サイトの表記が選んだグループ名と違う場合は、公式表記をそのまま添える（例: 乃木坂46 を選んだときの買取王子「乃木坂」）
  const officialText = hit.official ?? (groupKey(hit.name) !== groupKey(group) ? hit.name : undefined);
  return (
    <p className="bb-group-hit">
      <span className="bb-group-hit-label">{group}</span>
      公式サイトに買取対象として掲載
      {officialText && <span className="bb-group-hit-note">（公式サイトの表記：{officialText}）</span>}
      {hit.note && <span className="bb-group-hit-note">※{hit.note}</span>}
    </p>
  );
}

function ServiceCard({ s, group, adHtml }: { s: BuybackService; group: string; adHtml: string | undefined }) {
  const hit = group ? servicesForGroup(group, [s])[0]?.group : undefined;
  // 選んだグループで査定対象のグッズが限られている場合（例: 推しトクの嵐は DVD・Blu-ray のみ）は、その種類だけを出す
  const limited = hit?.goodsOnly;
  const goodsListed = BUYBACK_GOODS_TYPES.filter((g) => s.goods[g.id] && (!limited || limited.includes(g.id)));
  return (
    <article id={`bb-${s.id}`} className="gm-card bb-card" aria-labelledby={`bb-${s.id}-name`}>
      <header className="gm-card-head">
        <span className="gm-mark" aria-hidden="true">{s.mark}</span>
        <div>
          <h3 id={`bb-${s.id}-name`} className="gm-card-name">{s.name}</h3>
          <p className="gm-card-op">運営：{s.operator ?? NEEDS_CHECK}</p>
        </div>
      </header>
      <p className="gm-card-catch">{s.summary}</p>

      {hit && <GroupLine group={group} hit={hit} />}

      <dl className="bb-facts">
        <div><dt>宅配買取</dt><dd>{s.mailIn}</dd></div>
        <div><dt>発送時の送料</dt><dd>{s.shipping}</dd></div>
        <div><dt>査定料</dt><dd>{s.appraisalFee}</dd></div>
        <div><dt>キャンセル時の返送料</dt><dd>{s.returnShipping}</dd></div>
        <div><dt>入金方法</dt><dd>{s.payment}</dd></div>
      </dl>

      <h4 className="gm-h4">{limited ? `${group}で査定対象のグッズ（ほかのグッズは対象外）` : '買取対象として明記されているグッズ'}</h4>
      {goodsListed.length > 0 ? (
        <ul className="bb-goods">
          {goodsListed.map((g) => {
            const st = s.goods[g.id]!;
            return (
              <li key={g.id} className={`bb-goods-item bb-goods-item--${st.status}`}>
                <span className="bb-goods-name">{g.label}</span>
                <span className="bb-goods-status">{GOODS_STATUS_LABEL[st.status]}{st.note ? `：${st.note}` : ''}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="gm-text">{NEEDS_CHECK}</p>
      )}

      <details className="gm-more">
        <summary>対象グループ・対象外商品・キャンセル条件</summary>
        <div className="bb-more-body">
          <h5 className="bb-h5">公式サイトに名前が明記されているグループ・アーティスト（{s.groups.length}件）</h5>
          {s.groups.length > 0 ? (
            <p className="bb-small">{s.groups.map((g) => g.name).join('／')}</p>
          ) : (
            <p className="bb-small">{s.id === 'surugaya' ? 'グループ名の明記はありません（ジャンルとしての記載のみ）' : NEEDS_CHECK}</p>
          )}
          {s.genreNotes.length > 0 && (
            <p className="bb-small">ジャンルとしての記載：{s.genreNotes.join('、')}（個別のグループが対象かは公式サイトで確認してください）</p>
          )}
          <h5 className="bb-h5">対象外の商品</h5>
          {s.excluded.length > 0 ? (
            <ul className="gm-list bb-small-list">{s.excluded.map((x) => <li key={x}>{x}</li>)}</ul>
          ) : <p className="bb-small">{NEEDS_CHECK}</p>}
          <h5 className="bb-h5">キャンセル条件</h5>
          <p className="bb-small">{s.cancel}</p>
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

export default function BuybackExplorer({ services, groupOptions, adTags }: Props) {
  const [group, setGroup] = useState('');
  const [goods, setGoods] = useState<BuybackGoodsTypeId | ''>('');

  useEffect(() => {
    const p = readParams(groupOptions);
    setGroup(p.group);
    setGoods(p.goods);
  }, [groupOptions]);

  const [query, setQuery] = useState('');

  const visible = useMemo(() => filterBuybackServices(group, goods, services), [services, group, goods]);

  // グループ名の入力で選択肢を絞る（選択肢が多いため。スマホでも探しやすくする）
  const shownOptions = useMemo(() => {
    const q = groupKey(query);
    const list = q ? groupOptions.filter((o) => groupKey(o).includes(q)) : groupOptions;
    return group && !list.includes(group) && groupOptions.includes(group) ? [group, ...list] : list;
  }, [groupOptions, query, group]);

  const apply = (nextGroup: string, nextGoods: BuybackGoodsTypeId | '', changed: 'group' | 'goods') => {
    setGroup(nextGroup);
    setGoods(nextGoods);
    writeParams(nextGroup, nextGoods);
    const value = changed === 'group' ? nextGroup : nextGoods;
    const count = filterBuybackServices(nextGroup, nextGoods, services).length;
    sendGaEvent('oshikatsu_buyback_filter', { filter_type: changed, filter_value: value || 'all', result_count: count });
  };

  const goodsLabel = BUYBACK_GOODS_TYPES.find((g) => g.id === goods)?.label;

  return (
    <div className="bb-explorer">
      <div className="bb-filters" role="search" aria-label="買取サービスの絞り込み">
        <div className="bb-filter">
          <label className="bb-filter-label" htmlFor="bb-group-select">グループ・アーティストで絞り込む</label>
          <input
            type="search"
            className="bb-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="グループ名を入力して候補をしぼる（例: Snow Man）"
            aria-label="グループ名を入力して候補をしぼる"
            enterKeyHint="search"
          />
          <select
            id="bb-group-select"
            className="bb-select"
            value={groupOptions.includes(group) ? group : ''}
            onChange={(e) => apply(e.target.value, goods, 'group')}
          >
            <option value="">{query ? `候補 ${shownOptions.length}件から選択` : `すべて（${groupOptions.length}件から選択）`}</option>
            {shownOptions.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <fieldset className="bb-filter">
          <legend className="bb-filter-label">グッズの種類で絞り込む</legend>
          <div className="bb-chips">
            {BUYBACK_GOODS_TYPES.map((g) => (
              <button
                key={g.id}
                type="button"
                className="bb-chip"
                aria-pressed={goods === g.id}
                onClick={() => apply(group, goods === g.id ? '' : g.id, 'goods')}
              >
                {g.label}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="bb-result" aria-live="polite">
          {group || goods ? (
            <>
              {[group && `「${group}」`, goodsLabel && `「${goodsLabel}」`].filter(Boolean).join('・')}
              を公式サイトに買取対象として明記しているサービス：{visible.length}件
              <button type="button" className="bb-reset" onClick={() => { apply('', '', group ? 'group' : 'goods'); }}>
                絞り込みを解除
              </button>
            </>
          ) : (
            <>全{services.length}サービスを表示中</>
          )}
        </p>
        <p className="gm-note bb-filter-note">
          絞り込みは、各社の公式サイトにグループ名・グッズの種類が明記されているかどうかで判定しています。
          明記がないサービスでも買取の対象になる場合があるため、詳しくは各公式サイトで確認してください。
        </p>
      </div>

      {visible.length > 0 ? (
        <div className="gm-cards bb-cards">
          {visible.map((s) => <ServiceCard key={s.id} s={s} group={group} adHtml={adTags[s.id]?.adHtml} />)}
        </div>
      ) : (
        <p className="bb-empty">
          この条件を公式サイトに明記しているサービスは確認できませんでした。
          <button type="button" className="bb-reset" onClick={() => apply('', '', group ? 'group' : 'goods')}>絞り込みを解除</button>
        </p>
      )}

      {visible.length > 0 && (
        <section className="bb-compare" aria-labelledby="bb-compare-heading">
          <h3 id="bb-compare-heading" className="bb-compare-title">送料・返送料などの比較</h3>
          <p className="gm-scroll-hint" aria-hidden="true">← 横にスクロールして比較 →</p>
          <div className="gm-table-wrap" role="region" aria-label="比較表（横にスクロールできます）" tabIndex={0}>
            <table className="gm-table bb-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">項目</span></th>
                  {visible.map((s) => <th key={s.id} scope="col">{s.name}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr><th scope="row">宅配買取</th>{visible.map((s) => <td key={s.id}>{s.mailIn}</td>)}</tr>
                <tr><th scope="row">発送時の送料</th>{visible.map((s) => <td key={s.id}>{s.shipping}</td>)}</tr>
                <tr><th scope="row">査定料</th>{visible.map((s) => <td key={s.id}>{s.appraisalFee}</td>)}</tr>
                <tr><th scope="row">キャンセル条件</th>{visible.map((s) => <td key={s.id}>{s.cancel}</td>)}</tr>
                <tr><th scope="row">キャンセル時の返送料</th>{visible.map((s) => <td key={s.id}>{s.returnShipping}</td>)}</tr>
                <tr><th scope="row">入金方法</th>{visible.map((s) => <td key={s.id}>{s.payment}</td>)}</tr>
                <tr>
                  <th scope="row">対象外の商品</th>
                  {visible.map((s) => <td key={s.id}>{s.excluded.length > 0 ? s.excluded.join('、') : NEEDS_CHECK}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
