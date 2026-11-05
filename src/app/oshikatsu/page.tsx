import type { Metadata } from 'next';
import Link from 'next/link';
import GraphicPageStyles from '@/components/site/GraphicPageStyles';
import OshikatsuCategoryCards from '@/components/oshikatsu/OshikatsuCategoryCards';
import { secLabel } from '@/components/oshi-vod/sec-label';
import { OSHIKATSU_CATEGORIES, OSHIKATSU_PATH, isCategoryLinkable } from '@/lib/oshikatsu-services/categories';
import './oshikatsu.css';

// 推し活サービスの総合ページ。DB・外部APIは使わない静的ページ。
// ジャンルの一覧・状態（利用可能／準備中）・リンク先は src/lib/oshikatsu-services/categories.ts で管理する。
// このページ自体には外部サービスへのリンク（広告リンク）を置かない（各ジャンルの比較ページに置く）。

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';
const CANONICAL_URL = `${SITE_ORIGIN}${OSHIKATSU_PATH}`;

const PAGE_NAME = '推し活サービス';
const PAGE_TITLE = '推し活サービス｜推し活をもっと楽しむサービスを比較';
const PAGE_LEAD = 'オリジナルグッズを作る、グッズを整理する、ライブ参戦服を探す。推し活に役立つサービスを比較できます。';

const AVAILABLE_NAMES = OSHIKATSU_CATEGORIES.filter(isCategoryLinkable).map((c) => c.name);
const PAGE_DESCRIPTION = `${PAGE_LEAD}現在は${AVAILABLE_NAMES.join('・')}のサービス比較を公開しています。`;

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: CANONICAL_URL },
  openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'website', url: CANONICAL_URL },
};

export default function OshikatsuHubPage() {
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: SITE_ORIGIN },
      { '@type': 'ListItem', position: 2, name: PAGE_NAME, item: CANONICAL_URL },
    ],
  };

  return (
    <div className="oshi-graphic-page oshi-graphic-page--oshikatsu ok-page max-w-3xl mx-auto px-4 py-6">
      <GraphicPageStyles />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <nav aria-label="パンくずリスト" className="text-xs mb-4" style={{ color: 'var(--ds-muted)' }}>
        <Link href="/" className="theme-text-link">ホーム</Link>
        <span className="mx-1.5" style={{ opacity: 0.4 }}>›</span>
        <span>{PAGE_NAME}</span>
      </nav>

      <h1 className="ok-h1">
        推し活サービス
        <span className="ok-h1-sub">推し活をもっと楽しむ</span>
      </h1>
      <p className="ok-lead">{PAGE_LEAD}</p>

      <div className="ok-sections">
        <section aria-labelledby="ok-genres" style={secLabel('GENRES')}>
          <h2 id="ok-genres" className="ok-h2">ジャンルから選ぶ</h2>
          <OshikatsuCategoryCards placement="hub" showPurposes />
          <p className="ok-note">「準備中」のジャンルは、比較ページの公開までお待ちください。</p>
        </section>

        <section aria-labelledby="ok-policy" style={secLabel('POLICY')}>
          <h2 id="ok-policy" className="ok-h2">比較ページについて</h2>
          <ul className="ok-list">
            <li>料金・送料・納期・注文条件などは、各サービスの公式サイトで確認できた内容だけを、確認日とあわせて掲載します。確認できない内容は「公式サイトで確認」と表示します。</li>
            <li>推しサーチは各サービスの運営元ではありません。実際の利用体験にもとづかない口コミ・ランキング・満足度は掲載しません。</li>
            <li>広告（アフィリエイトリンク）を含むページでは、ページの最初とリンクの近くに「PR」と表示します。</li>
            <li>芸能人・アイドルの写真、公式ロゴ、キャラクターなどを無断で使ったグッズ制作は案内しません。</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
