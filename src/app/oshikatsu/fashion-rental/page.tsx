import type { Metadata } from 'next';
import Link from 'next/link';
import GraphicPageStyles from '@/components/site/GraphicPageStyles';
import PrNotice from '@/components/site/PrNotice';
import FashionExplorer from '@/components/oshikatsu/FashionExplorer';
import { secLabel } from '@/components/oshi-vod/sec-label';
import { FASHION_CHECKED_AT, FASHION_RENTAL_PATH, FASHION_SERVICES } from '@/lib/oshikatsu-services/fashion-rental';
import { OSHIKATSU_PATH } from '@/lib/oshikatsu-services/categories';
import { getPublicOshikatsuAds } from '@/lib/oshikatsu-affiliate/store';
import '../goods-making/goods-making.css';
import '../goods-buyback/goods-buyback.css';
import './fashion-rental.css';

// ライブ参戦服・ファッションレンタル比較。外部APIは使わない。
// 掲載内容は src/lib/oshikatsu-services/fashion-rental.ts に集約（公式サイトで確認できた内容のみ）。
// 見た目はグッズ制作比較（.gm-*）・グッズ買取比較（.bb-*：絞り込み・比較表）を共通で使い、このページだけの部品は fashion-rental.css（.fr-*）。
// 広告タグは管理画面（/admin/affiliates?tab=oshikatsu）で登録し、承認済み・有効・安全確認OKのサービスだけ表示する。
// 管理画面で変更すると revalidatePath でこのページを再生成する（DB障害時は広告なし＝公式サイトへの通常リンク）。
// 商品の在庫・色・サイズは取得していないため、推し色の服などが借りられることは保証しない。
export const revalidate = 3600;

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';
const CANONICAL_URL = `${SITE_ORIGIN}${FASHION_RENTAL_PATH}`;

const PAGE_NAME = 'ライブ参戦服・ファッションレンタル比較';
const PAGE_TITLE = 'ライブ参戦服・ファッションレンタル比較｜ライブにも普段にも使える服のサブスクを比べる';
const PAGE_DESCRIPTION =
  'ライブやイベントに着ていく服、普段使いの服を借りて楽しみたい人へ。ファッションレンタルの月額料金・服の選び方・送料・返却・解約条件などを、各社の公式サイトの内容をもとに比較できます。';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: CANONICAL_URL },
  openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'article', url: CANONICAL_URL },
};

export default async function FashionRentalPage() {
  const ads = await getPublicOshikatsuAds(FASHION_SERVICES.map((s) => s.id));
  const adTags = Object.fromEntries(Object.entries(ads).map(([k, v]) => [k, { adHtml: v.adHtml }]));
  const adIncluded = Object.keys(adTags).length > 0;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: SITE_ORIGIN },
      { '@type': 'ListItem', position: 2, name: '推し活サービス', item: `${SITE_ORIGIN}${OSHIKATSU_PATH}` },
      { '@type': 'ListItem', position: 3, name: PAGE_NAME, item: CANONICAL_URL },
    ],
  };

  return (
    <div className="oshi-graphic-page oshi-graphic-page--fashionrental gm-page bb-page fr-page max-w-3xl mx-auto px-4 py-6">
      <GraphicPageStyles />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <nav aria-label="パンくずリスト" className="text-xs mb-4" style={{ color: 'var(--ds-muted)' }}>
        <Link href="/" className="theme-text-link">ホーム</Link>
        <span className="mx-1.5" style={{ opacity: 0.4 }}>›</span>
        <Link href={OSHIKATSU_PATH} className="theme-text-link">推し活サービス</Link>
        <span className="mx-1.5" style={{ opacity: 0.4 }}>›</span>
        <span>{PAGE_NAME}</span>
      </nav>

      {/* PR表記（広告タグが1つでも表示されるときだけ） */}
      {adIncluded && <PrNotice className="mb-4" />}

      <h1 className="gm-h1">
        ライブ参戦服・ファッションレンタル比較
        <span className="gm-h1-sub">ライブにも普段にも使える服のサブスクを比べる</span>
      </h1>
      <p className="gm-lead">{PAGE_DESCRIPTION}</p>
      <p className="gm-checked">情報確認日：{FASHION_CHECKED_AT}（各公式サイトの掲載内容）</p>

      <div className="gm-sections">
        <section aria-labelledby="fr-services" style={secLabel('SERVICES')}>
          <h2 id="fr-services" className="gm-h2">ファッションレンタルを比べる</h2>
          <FashionExplorer services={FASHION_SERVICES} adTags={adTags} />
        </section>

        <section aria-labelledby="fr-live" style={secLabel('FOR LIVE')}>
          <h2 id="fr-live" className="gm-h2">ライブ参戦服として使うとき</h2>
          <h3 className="fr-h3">メリット</h3>
          <ul className="gm-list gm-list--check">
            <li>ライブやイベントの日に合わせて、手持ちにない服を試せます。</li>
            <li>ライブのあとも、普段の服として着回せます。気に入った服は購入できるサービスもあります。</li>
            <li>クリーニング不要で返却できるサービスがあります（各社の条件を確認してください）。</li>
          </ul>
          <h3 className="fr-h3">注意点</h3>
          <ul className="gm-list">
            <li>推し色の服・特定のブランド・サイズが借りられるとは限りません。在庫や届く服は時期によって変わります。</li>
            <li>リクエストや予約をしても、希望の服が届くとは限りません（各社の規約・案内のとおり、在庫によって変わります）。</li>
            <li>ライブの日に間に合わせたい場合は、お届けまでの日数や交換のタイミングに余裕を持って申し込みましょう。</li>
            <li>1回のライブのためだけに使う場合は、自動更新・途中解約金・解約時の返却期限を先に確認しましょう。</li>
            <li>飲み物・汗・メイク・ペンライトなどによる汚れや破損は、費用がかかる場合があります（下の「月額料金以外にかかる費用」を参照）。</li>
            <li>うちわ・ペンライトなどの公式グッズを服に付けるときは、生地を傷めないように注意しましょう。</li>
          </ul>
        </section>

        <section aria-labelledby="fr-costs" style={secLabel('EXTRA COSTS')}>
          <h2 id="fr-costs" className="gm-h2">月額料金以外にかかる費用</h2>
          <div className="fr-costs">
            {FASHION_SERVICES.map((s) => (
              <div key={s.id} className="fr-cost">
                <h3 className="fr-h3">{s.name}</h3>
                <ul className="gm-list">{s.extraCosts.map((c) => <li key={c}>{c}</li>)}</ul>
              </div>
            ))}
          </div>
          <p className="gm-text fr-compare-tip">
            月額料金だけでは使い方に合うかどうかを比べられません。借りられる点数、交換の回数と配送料・返却手数料、長期コースの途中解約金、汚損・紛失時の費用をあわせて確認しましょう。
          </p>
          <p className="gm-note">月額料金は、その月に服を借りなかった場合も発生します。金額や条件は変更されることがあるため、申し込む前に公式サイトで確認してください。</p>
        </section>

        <section aria-labelledby="fr-source" style={secLabel('SOURCE')}>
          <h2 id="fr-source" className="gm-h2">情報の出典</h2>
          <p className="gm-text">
            このページの内容は、各公式サイトに{FASHION_CHECKED_AT}時点で掲載されていた内容を、推しサーチが独自に整理したものです。
            推しサーチは各サービスの運営元ではなく、実際の利用体験や口コミにもとづく評価はしていません。
            公式サイトで確認できなかった項目は「要確認」、公式サイト内で記載が異なる項目はその旨を書いています。申し込む前に必ず公式サイトで最新の情報を確認してください。
          </p>
          <ul className="gm-sources">
            {FASHION_SERVICES.map((s) => (
              <li key={s.id}>
                <span className="gm-sources-name">{s.name}：</span>
                {s.sources.map((src, i) => (
                  <span key={src.url}>{i > 0 && '・'}<a href={src.url} target="_blank" rel="noopener noreferrer">{src.label}</a></span>
                ))}
              </li>
            ))}
          </ul>
          <p className="gm-related">ほかのジャンルを見るなら <Link href={OSHIKATSU_PATH}>推し活サービス</Link></p>
        </section>
      </div>
    </div>
  );
}
