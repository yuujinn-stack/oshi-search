import type { Metadata } from 'next';
import Link from 'next/link';
import GraphicPageStyles from '@/components/site/GraphicPageStyles';
import PrNotice from '@/components/site/PrNotice';
import ServiceOutboundLink from '@/components/oshikatsu/ServiceOutboundLink';
import OshikatsuAdTag from '@/components/oshikatsu/OshikatsuAdTag';
import { secLabel } from '@/components/oshi-vod/sec-label';
import {
  CHECK_OFFICIAL,
  CHOOSE_GUIDES,
  COMPARE_ROWS,
  GOODS_MAKING_CHECKED_AT,
  GOODS_MAKING_FAQ,
  GOODS_MAKING_PATH,
  GOODS_MAKING_PRICE_CHECKED_AT,
  GOODS_MAKING_SERVICES,
  WANT_OPTIONS,
} from '@/lib/oshikatsu-services/goods-making';
import { OSHIKATSU_SERVICE_LINKS, hasAffiliateLink, resolveServiceLink } from '@/lib/oshikatsu-services/links';
import { OSHIKATSU_PATH } from '@/lib/oshikatsu-services/categories';
import { getPublicOshikatsuAds } from '@/lib/oshikatsu-affiliate/store';
import './goods-making.css';

// 推し活グッズ制作サービス比較。外部APIは使わない。
// 掲載内容（料金・送料・納期など）は src/lib/oshikatsu-services/goods-making.ts、
// リンク先（公式サイト／提携後の広告リンク）は src/lib/oshikatsu-services/links.ts に集約。
// 広告リンクが1つでも有効になると、PR表記とリンク横の「PR」が自動で表示される。
// ASPの広告タグは管理画面（/admin/affiliates?tab=oshikatsu）で登録し、DB（oshikatsu_affiliate_*）から読む。
// 承認済み・広告有効・安全確認OKの素材があるサービスだけ、サービス紹介カードの公式サイトボタンの位置に
// 広告タグをそのまま表示する。それ以外のサービスは従来どおり公式サイトへの通常リンク。
// 管理画面で変更すると revalidatePath でこのページを再生成する（DB障害時は広告なし＝通常リンクで表示）。
export const revalidate = 3600;

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';
const CANONICAL_URL = `${SITE_ORIGIN}${GOODS_MAKING_PATH}`;

const PAGE_NAME = '推し活グッズ制作サービス比較';
const PAGE_TITLE = '推し活グッズ制作サービス比較｜オリジナルグッズを作る・推し色アイテムを選ぶ';
const PAGE_DESCRIPTION =
  '推し色を使ったアイテムや、自分だけのオリジナルグッズを作りたい人へ。制作できるアイテムや注文方法、料金などを比較して、自分に合ったサービスを探せます。';
const CATEGORY = 'goods_making';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: CANONICAL_URL },
  openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'article', url: CANONICAL_URL },
};

const SERVICE_BY_ID = Object.fromEntries(GOODS_MAKING_SERVICES.map((s) => [s.id, s]));

function PrTag() {
  return <span className="gm-pr">PR</span>;
}

export default async function GoodsMakingPage() {
  const adTags = await getPublicOshikatsuAds(GOODS_MAKING_SERVICES.map((s) => s.id));
  const adIncluded = hasAffiliateLink(GOODS_MAKING_SERVICES.map((s) => s.id)) || Object.keys(adTags).length > 0;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: SITE_ORIGIN },
      { '@type': 'ListItem', position: 2, name: '推し活サービス', item: `${SITE_ORIGIN}${OSHIKATSU_PATH}` },
      { '@type': 'ListItem', position: 3, name: PAGE_NAME, item: CANONICAL_URL },
    ],
  };
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: GOODS_MAKING_FAQ.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };

  return (
    <div className="oshi-graphic-page oshi-graphic-page--goodsmaking gm-page max-w-3xl mx-auto px-4 py-6">
      <GraphicPageStyles />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <nav aria-label="パンくずリスト" className="text-xs mb-4" style={{ color: 'var(--ds-muted)' }}>
        <Link href="/" className="theme-text-link">ホーム</Link>
        <span className="mx-1.5" style={{ opacity: 0.4 }}>›</span>
        <Link href={OSHIKATSU_PATH} className="theme-text-link">推し活サービス</Link>
        <span className="mx-1.5" style={{ opacity: 0.4 }}>›</span>
        <span>{PAGE_NAME}</span>
      </nav>

      {/* PR表記（広告リンクが1つでも有効なときだけ。未提携の間は広告を含まないため出さない） */}
      {adIncluded && <PrNotice className="mb-4" />}

      {/* ① 見出しと説明 */}
      <h1 className="gm-h1">
        推し活グッズ制作サービス比較
        <span className="gm-h1-sub">オリジナルグッズを作る・推し色アイテムを選ぶ</span>
      </h1>
      <p className="gm-lead">{PAGE_DESCRIPTION}</p>
      <p className="gm-checked">情報確認日：料金・送料 {GOODS_MAKING_PRICE_CHECKED_AT}／その他 {GOODS_MAKING_CHECKED_AT}（各公式サイトの掲載内容）</p>

      <div className="gm-sections">
        {/* ② どんなグッズを作りたい？ */}
        <section aria-labelledby="gm-want" style={secLabel('WHAT TO MAKE')}>
          <h2 id="gm-want" className="gm-h2">どんなグッズを作りたい？</h2>
          <ul className="gm-want">
            {WANT_OPTIONS.map((o) => {
              const svc = SERVICE_BY_ID[o.serviceId];
              return (
                <li key={o.label}>
                  <a href={`#${svc.anchor}`} className="gm-want-link">
                    <span className="gm-want-label">{o.label}</span>
                    <span className="gm-want-desc">{o.desc}</span>
                    <span className="gm-want-to">→ {OSHIKATSU_SERVICE_LINKS[o.serviceId].serviceName}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ③ サービス紹介カード */}
        <section aria-labelledby="gm-services" style={secLabel('SERVICES')}>
          <h2 id="gm-services" className="gm-h2">グッズ制作サービスの紹介</h2>
          <div className="gm-cards">
            {GOODS_MAKING_SERVICES.map((s) => {
              const link = OSHIKATSU_SERVICE_LINKS[s.id];
              const resolved = resolveServiceLink(link);
              const adTag = adTags[s.id];
              return (
                <article key={s.id} id={s.anchor} className="gm-card" aria-labelledby={`${s.anchor}-name`}>
                  <header className="gm-card-head">
                    <span className="gm-mark" aria-hidden="true">{s.mark}</span>
                    <div>
                      <h3 id={`${s.anchor}-name`} className="gm-card-name">{link.serviceName}</h3>
                      <p className="gm-card-op">運営：{s.operator}</p>
                    </div>
                  </header>
                  <p className="gm-card-catch">{s.catchCopy}</p>

                  <h4 className="gm-h4">制作できるグッズ</h4>
                  <ul className="gm-list">{s.items.map((x) => <li key={x}>{x}</li>)}</ul>

                  <h4 className="gm-h4">特徴</h4>
                  <ul className="gm-list">{s.features.map((x) => <li key={x}>{x}</li>)}</ul>

                  <h4 className="gm-h4">こんな人におすすめ</h4>
                  <ul className="gm-list gm-list--check">{s.recommendedFor.map((x) => <li key={x}>{x}</li>)}</ul>

                  {adTag ? (
                    // 管理画面で登録したASPの広告タグ。タグ自体（リンク・文言・画像・計測用1×1画像）は改変せずに表示し、
                    // 見つけやすくするための広告掲載エリア（白背景・枠線・余白）と PR 表記はタグの外側にだけ付ける。
                    // リンク部分を広げる余白・透明なクリック領域・独自のボタン文言は付けない（クリック計測は OshikatsuAdTag の1か所だけ）。
                    <div className="gm-card-cta gm-card-cta--ad">
                      <aside className={`gm-ad gm-ad--${adTag.kind === 'banner' ? 'banner' : 'text'}`} aria-label={`${link.serviceName}の広告`}>
                        <p className="gm-ad-head">
                          <PrTag />
                          <span className="gm-ad-caption">{link.serviceName}の公式サイト</span>
                        </p>
                        <OshikatsuAdTag html={adTag.adHtml} serviceId={s.id} category={CATEGORY} placement="card_ad_tag" className="gm-ad-tag" />
                      </aside>
                    </div>
                  ) : (<>
                  {resolved.isAffiliate && link.creative && (
                    <div className="gm-creative">
                      <ServiceOutboundLink href={resolved.href} isAffiliate serviceId={s.id} category={CATEGORY} placement="card_creative">
                        {/* ASPから利用許可を得た広告素材のみ（links.ts の creative） */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={link.creative.imageUrl} width={link.creative.width} height={link.creative.height} alt={link.creative.alt} loading="lazy" />
                      </ServiceOutboundLink>
                    </div>
                  )}

                  <div className="gm-card-cta">
                    {resolved.isAffiliate && <PrTag />}
                    <ServiceOutboundLink
                      href={resolved.href}
                      isAffiliate={resolved.isAffiliate}
                      serviceId={s.id}
                      category={CATEGORY}
                      placement="card"
                      className="gm-btn"
                    >
                      {link.serviceName}の公式サイトを見る ↗
                    </ServiceOutboundLink>
                  </div>
                  </>)}
                </article>
              );
            })}
          </div>
        </section>

        {/* ④ 比較表 */}
        <section aria-labelledby="gm-compare" style={secLabel('COMPARE')}>
          <h2 id="gm-compare" className="gm-h2">2社の比較表</h2>
          {/* スマホで表が横スクロールになる幅のときだけ表示（CSSで制御）。読み上げは表の aria-label で案内済み */}
          <p className="gm-scroll-hint" aria-hidden="true">← 横にスクロールして2社を比較 →</p>
          <div className="gm-table-wrap" role="region" aria-label="比較表（横にスクロールできます）" tabIndex={0}>
            <table className="gm-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">項目</span></th>
                  {GOODS_MAKING_SERVICES.map((s) => (
                    <th key={s.id} scope="col">{OSHIKATSU_SERVICE_LINKS[s.id].serviceName}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    {GOODS_MAKING_SERVICES.map((s) => (
                      <td key={s.id}>{s.compare[row.key] || CHECK_OFFICIAL}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="gm-note">
            料金・送料は{GOODS_MAKING_PRICE_CHECKED_AT}時点で各公式サイトに表示されていた税込価格です。サイズ・オプション・キャンペーンによって変わるため、注文前に公式サイトで確認してください。
          </p>
        </section>

        {/* ⑤ 目的別の選び方 */}
        <section aria-labelledby="gm-choose" style={secLabel('HOW TO CHOOSE')}>
          <h2 id="gm-choose" className="gm-h2">目的別の選び方</h2>
          <ul className="gm-choose">
            {CHOOSE_GUIDES.map((g) => {
              const svc = SERVICE_BY_ID[g.serviceId];
              return (
                <li key={g.want}>
                  <p className="gm-choose-want">「{g.want}」</p>
                  <p className="gm-choose-to">
                    {/* 同じページのサービス紹介カードへの内部リンク（広告リンクではない） */}
                    → <a href={`#${svc.anchor}`}>{OSHIKATSU_SERVICE_LINKS[g.serviceId].serviceName}の紹介を見る ↑</a>
                  </p>
                  <p className="gm-text">{g.reason}</p>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ⑥ 注意事項 */}
        <section aria-labelledby="gm-caution" style={secLabel('CAUTION')}>
          <h2 id="gm-caution" className="gm-h2">オリジナルグッズを作るときの注意</h2>
          <div className="gm-caution">
            <p className="gm-caution-head">芸能人・アイドルの写真、公式ロゴ、キャラクターは無断で使えません</p>
            <ul className="gm-list">
              <li>公式写真・雑誌やWebの画像・テレビや配信の画面写真などには、肖像権や著作権があります。権利者の許可なくグッズに使うことはできません。</li>
              <li>グループやレーベルのロゴ、キャラクターのイラストも同じです。似せて描いたものも問題になることがあります。</li>
              <li>自分で撮影した写真、自分で描いたオリジナルのイラスト、文字や推し色の組み合わせなど、自分で権利を持っている素材で作りましょう。</li>
              <li>作ったグッズを販売・配布する場合は、さらに注意が必要です。各サービスの利用規約も確認してください。</li>
            </ul>
          </div>
          <p className="gm-note">
            しまうまプラスでは、商品・企業のロゴや人物を特定できる画像などを例に挙げて、第三者の権利を侵害していないか確認するよう案内しています。違反する注文は出荷が停止され、返金されません。
          </p>
        </section>

        {/* ⑦ よくある質問 */}
        <section aria-labelledby="gm-faq" style={secLabel('FAQ')}>
          <h2 id="gm-faq" className="gm-h2">よくある質問</h2>
          <div className="gm-faq">
            {GOODS_MAKING_FAQ.map(({ q, a }) => (
              <details key={q} className="gm-more">
                <summary>{q}</summary>
                <p className="gm-text">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 出典・関連ページ */}
        <section aria-labelledby="gm-source" style={secLabel('SOURCE')}>
          <h2 id="gm-source" className="gm-h2">情報の出典</h2>
          <p className="gm-text">
            このページの内容は、各公式サイトに掲載されていた内容（料金・送料は{GOODS_MAKING_PRICE_CHECKED_AT}時点、その他は{GOODS_MAKING_CHECKED_AT}時点）を、推しサーチが独自に整理したものです。
            推しサーチは各サービスの運営元ではなく、実際の利用体験や口コミにもとづく評価はしていません。内容は変更されることがあるため、注文前に必ず公式サイトで最新の情報を確認してください。
          </p>
          <ul className="gm-sources">
            {GOODS_MAKING_SERVICES.map((s) => (
              <li key={s.id}>
                <span className="gm-sources-name">{OSHIKATSU_SERVICE_LINKS[s.id].serviceName}：</span>
                {s.sources.map((src, i) => (
                  <span key={src.url}>
                    {i > 0 && '・'}
                    <a href={src.url} target="_blank" rel="noopener noreferrer">{src.label}</a>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="gm-related">
            ほかのジャンルを見るなら <Link href={OSHIKATSU_PATH}>推し活サービス</Link>
          </p>
          <p className="gm-related">
            推しの関連商品や推し活に便利なアイテムを探すなら <Link href="/oshi-shopping">推し活お買い物診断</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
