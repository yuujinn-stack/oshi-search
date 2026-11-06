import type { Metadata } from 'next';
import Link from 'next/link';
import GraphicPageStyles from '@/components/site/GraphicPageStyles';
import PrNotice from '@/components/site/PrNotice';
import BuybackExplorer from '@/components/oshikatsu/BuybackExplorer';
import { secLabel } from '@/components/oshi-vod/sec-label';
import {
  BUYBACK_CHECKED_AT,
  BUYBACK_SERVICES,
  GOODS_BUYBACK_PATH,
  buybackGroupOptions,
} from '@/lib/oshikatsu-services/goods-buyback';
import { OSHIKATSU_PATH } from '@/lib/oshikatsu-services/categories';
import { getPublicOshikatsuAds } from '@/lib/oshikatsu-affiliate/store';
import '../goods-making/goods-making.css';
import './goods-buyback.css';

// 推し活グッズ買取サービス比較。外部APIは使わない。
// 掲載内容（対象グループ・グッズ・送料・返送料など）は src/lib/oshikatsu-services/goods-buyback.ts に集約（公式サイトで確認できた内容のみ）。
// 見た目はグッズ制作比較（goods-making.css の .gm-*）を共通で使い、このページだけの部品は goods-buyback.css（.bb-*）。
// 広告タグは管理画面（/admin/affiliates?tab=oshikatsu）で登録し、承認済み・有効・安全確認OKのサービスだけ表示する。
// 管理画面で変更すると revalidatePath でこのページを再生成する（DB障害時は広告なし＝公式サイトへの通常リンク）。
export const revalidate = 3600;

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';
const CANONICAL_URL = `${SITE_ORIGIN}${GOODS_BUYBACK_PATH}`;

const PAGE_NAME = '推し活グッズ買取サービス比較';
const PAGE_TITLE = '推し活グッズ買取サービス比較｜グッズを整理したいときの宅配買取を比べる';
const PAGE_DESCRIPTION =
  '使わなくなった公式グッズを整理したい人へ。宅配買取サービスの対象グループ・対象グッズ・送料・キャンセル時の返送料などを、各社の公式サイトの内容をもとに比較できます。';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: CANONICAL_URL },
  openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'article', url: CANONICAL_URL },
};

export default async function GoodsBuybackPage() {
  const ads = await getPublicOshikatsuAds(BUYBACK_SERVICES.map((s) => s.id));
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
    <div className="oshi-graphic-page oshi-graphic-page--goodsbuyback gm-page bb-page max-w-3xl mx-auto px-4 py-6">
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
        推し活グッズ買取サービス比較
        <span className="gm-h1-sub">グッズを整理したいときの宅配買取を比べる</span>
      </h1>
      <p className="gm-lead">{PAGE_DESCRIPTION}</p>
      <p className="gm-checked">情報確認日：{BUYBACK_CHECKED_AT}（各公式サイトの掲載内容）</p>

      <div className="gm-sections">
        <section aria-labelledby="bb-services" style={secLabel('SERVICES')}>
          <h2 id="bb-services" className="gm-h2">買取サービスを比べる</h2>
          <BuybackExplorer services={BUYBACK_SERVICES} groupOptions={buybackGroupOptions()} adTags={adTags} />
        </section>

        <section aria-labelledby="bb-before" style={secLabel('BEFORE SELLING')}>
          <h2 id="bb-before" className="gm-h2">申し込む前に確認したいこと</h2>
          <ul className="gm-list">
            <li>買取価格は各社の査定によって決まります。推しサーチでは買取価格を比較・保証していません。</li>
            <li>査定に納得できずキャンセルするときの返送料は、サービスによって無料の場合とお客様負担の場合があります。</li>
            <li>「自動承認」「連絡不要」などを選ぶと、査定後にキャンセルできないサービスがあります。</li>
            <li>本人確認書類が必要です。18歳未満の利用条件もサービスごとに異なります。</li>
            <li>個人情報が入った品物、非公式グッズ、ポスターなどは、買取の対象外になっている場合があります。</li>
            <li>思い入れのあるグッズは、手放す前に一度見直してから申し込みましょう。</li>
          </ul>
        </section>

        <section aria-labelledby="bb-source" style={secLabel('SOURCE')}>
          <h2 id="bb-source" className="gm-h2">情報の出典</h2>
          <p className="gm-text">
            このページの内容は、各公式サイトに{BUYBACK_CHECKED_AT}時点で掲載されていた内容を、推しサーチが独自に整理したものです。
            推しサーチは各サービスの運営元ではなく、実際の利用体験や口コミにもとづく評価はしていません。
            公式サイトで確認できなかった項目は「要確認」としています。条件は変更されることがあるため、申し込む前に必ず公式サイトで最新の情報を確認してください。
          </p>
          <ul className="gm-sources">
            {BUYBACK_SERVICES.map((s) => (
              <li key={s.id}>
                <span className="gm-sources-name">{s.name}：</span>
                {s.sources.length > 0
                  ? s.sources.map((src, i) => (
                    <span key={src.url}>{i > 0 && '・'}<a href={src.url} target="_blank" rel="noopener noreferrer">{src.label}</a></span>
                  ))
                  : <span>公式サイトを確認できていません（すべて要確認）</span>}
              </li>
            ))}
          </ul>
          <p className="gm-related">ほかのジャンルを見るなら <Link href={OSHIKATSU_PATH}>推し活サービス</Link></p>
        </section>
      </div>
    </div>
  );
}
