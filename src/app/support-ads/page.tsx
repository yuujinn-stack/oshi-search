import type { Metadata } from 'next';
import Link from 'next/link';
import GraphicPageStyles from '@/components/site/GraphicPageStyles';
import SupportAdsCta from '@/components/affiliate/SupportAdsCta';
import { isSupportAdsCtaEnabled } from '@/components/affiliate/oshi-ad-link';
import { secLabel } from '@/components/oshi-vod/sec-label';
import {
  COST_GUIDE_UPDATED_AT,
  FAQ_ITEMS,
  FLOW_STEPS,
  MEDIA_GUIDES,
  OFFICIAL_CHECKED_AT,
  SUPPORT_ADS_PATH,
} from '@/lib/support-ads/content';
import './support-ads.css';

// 応援広告を初めて検討する人向けのガイド。DB・外部APIは使わない静的ページ。
// 事実（料金・許諾・申込条件）は src/lib/support-ads/content.ts に集約（推しアド公式サイトで確認できた内容のみ）。

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';
const CANONICAL_URL = `${SITE_ORIGIN}${SUPPORT_ADS_PATH}`;

const PAGE_NAME = 'はじめての応援広告ガイド';
const PAGE_TITLE = 'はじめての応援広告ガイド｜費用・事務所の許可・申込から掲載までの流れ';
const PAGE_DESCRIPTION =
  '推しの誕生日や記念日に出す応援広告（センイル広告）の基本を、初めての人向けにまとめました。駅ポスター・駅サイネージ・屋外ビジョンの違い、費用の目安、事務所の許可と必要書類、申込から掲載までの流れを解説します。';

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: CANONICAL_URL },
  openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'article', url: CANONICAL_URL },
};

export default function SupportAdsPage() {
  // 広告枠は AccessTrade の成果条件・リンク先を確認してから表示する（oshi-ad-link.ts 参照）
  const adEnabled = isSupportAdsCtaEnabled();

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: SITE_ORIGIN },
      { '@type': 'ListItem', position: 2, name: PAGE_NAME, item: CANONICAL_URL },
    ],
  };
  const webPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: PAGE_NAME,
    url: CANONICAL_URL,
    description: PAGE_DESCRIPTION,
    isPartOf: { '@type': 'WebSite', name: '推しサーチ', url: SITE_ORIGIN },
  };
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };

  return (
    <div className="oshi-graphic-page oshi-graphic-page--supportads sa-page max-w-3xl mx-auto px-4 py-6">
      <GraphicPageStyles />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <nav aria-label="パンくずリスト" className="text-xs mb-4" style={{ color: 'var(--ds-muted)' }}>
        <Link href="/" className="theme-text-link">ホーム</Link>
        <span className="mx-1.5" style={{ opacity: 0.4 }}>›</span>
        <span>{PAGE_NAME}</span>
      </nav>

      <h1 className="sa-h1">{PAGE_NAME}</h1>
      <p className="sa-lead">
        推しの誕生日や記念日に、駅や街の広告枠でお祝いを届ける「応援広告」。
        費用・事務所の許可・準備・申し込みの流れを、初めての人向けに短くまとめました。
      </p>
      {adEnabled && (
        <p className="sa-disclosure">
          このページには、応援広告サービス「推しアド」の広告（アフィリエイトリンク）が含まれます。
          推しサーチは推しアドの運営元ではありません。
          <a href="#sa-apply" className="sa-jump">公式サイトで掲載枠を探す ↓</a>
        </p>
      )}

      <div className="sa-sections">
        <section aria-labelledby="sa-about" style={secLabel('ABOUT')}>
          <h2 id="sa-about" className="sa-h2">応援広告とは</h2>
          <p className="sa-text">
            ファンが費用を出し合って（または一人で）広告枠を買い、推しへのお祝いメッセージやビジュアルを掲載する企画です。
            誕生日の広告は、韓国語で誕生日を意味する「センイル」から<strong>センイル広告</strong>とも呼ばれます。
            掲載には本人または所属事務所の許可と、媒体社の審査が必要です。
          </p>
        </section>

        <section aria-labelledby="sa-scene" style={secLabel('SCENE')}>
          <h2 id="sa-scene" className="sa-h2">よく使われる場面</h2>
          <ul className="sa-list">
            <li><strong>誕生日</strong>：生誕祭として、誕生日を含む期間に掲載する</li>
            <li><strong>記念日</strong>：デビュー○周年など、節目のお祝いに合わせて掲載する</li>
            <li><strong>ライブ・イベント</strong>：会場の最寄り駅など、ファンが集まる場所に合わせて掲載する</li>
          </ul>
        </section>

        <section aria-labelledby="sa-media" style={secLabel('MEDIA')}>
          <h2 id="sa-media" className="sa-h2">駅ポスター・駅サイネージ・屋外ビジョンの違い</h2>
          <div className="sa-media">
            {MEDIA_GUIDES.map((m) => (
              <div key={m.key} className="sa-card">
                <p className="sa-card-title">
                  {m.name}
                  {m.also && <span className="sa-card-also">（{m.also}）</span>}
                </p>
                <p className="sa-text">{m.summary}</p>
                <ul className="sa-list sa-list--tight">
                  {m.points.map((p) => <li key={p}>{p}</li>)}
                </ul>
                <p className="sa-price"><span className="sa-price-label">費用の目安</span>{m.priceNote}</p>
              </div>
            ))}
          </div>
          <p className="sa-note">
            費用の目安は推しアド公式の費用ガイド（{COST_GUIDE_UPDATED_AT}更新）に示された媒体費の相場です。
            税込・税抜の記載はなく、媒体・時期・空き状況によって変わります。正確な料金は各掲載枠のページで確認してください。
          </p>
        </section>

        <section aria-labelledby="sa-team" style={secLabel('SOLO / TEAM')}>
          <h2 id="sa-team" className="sa-h2">一人で出す？ みんなで出す？</h2>
          <div className="sa-compare">
            <div className="sa-card">
              <p className="sa-card-title">一人で企画する</p>
              <ul className="sa-list sa-list--tight">
                <li>デジタルサイネージなど、個人で申し込める枠を選ぶ</li>
                <li>駅ポスターなどの交通広告は個人名義では出せない</li>
                <li>費用・作業はすべて自分で担当する</li>
              </ul>
            </div>
            <div className="sa-card">
              <p className="sa-card-title">団体（実行委員会）で企画する</p>
              <ul className="sa-list sa-list--tight">
                <li>2名以上で作れて、法人登記はいらない</li>
                <li>「○○生誕祭実行委員会」など名前は自由。デザインに団体名と連絡先メールアドレスを載せる</li>
                <li>クラウドファンディング（1口500円〜）で参加者を募る方法もある</li>
              </ul>
            </div>
          </div>
        </section>

        <section aria-labelledby="sa-choose" style={secLabel('CHOOSE')}>
          <h2 id="sa-choose" className="sa-h2">予算・地域・希望日から選ぶ</h2>
          <ol className="sa-steps">
            <li>
              <strong>希望日から逆算する</strong>
              <span>事務所への許可取りを代行してもらう場合、駅ポスターは3〜4か月前、デジタルサイネージは2か月前までに相談するのが目安です。日程が近いならデジタル系が候補になります。</span>
            </li>
            <li>
              <strong>予算を決める</strong>
              <span>まずは数万円台から探せる駅サイネージや駅ポスター（B1）、まとまった予算や仲間がいれば大型ビジョンも検討できます。</span>
            </li>
            <li>
              <strong>掲載地域を決める</strong>
              <span>推しの地元やゆかりの場所、ライブ会場の最寄り駅、ファンが集まりやすい繁華街の駅などから選びます。</span>
            </li>
          </ol>
        </section>

        <section aria-labelledby="sa-permit" style={secLabel('PERMISSION')}>
          <h2 id="sa-permit" className="sa-h2">事務所の許可と必要書類</h2>
          <ul className="sa-list">
            <li>掲出する<strong>本人または所属事務所の許可が必須</strong>です。</li>
            <li>自分で許可を取った場合は、やり取りがわかるメールやDMのスクリーンショットを提出します。</li>
            <li>推しアドに許諾確認の代行を頼むこともできます（税抜5,000円、別途消費税・サービス料。最短でも1週間ほどかかります）。</li>
            <li>未成年の方を対象とした掲載は受け付けていません。</li>
          </ul>
          <div className="sa-docs">
            <div>
              <p className="sa-card-title">駅ポスターで必要なもの</p>
              <p className="sa-text">団体概要書・許諾確認書・デザイン・意匠確認書</p>
            </div>
            <div>
              <p className="sa-card-title">デジタル広告で必要なもの</p>
              <p className="sa-text">許諾確認書・デザイン</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="sa-flow" style={secLabel('FLOW')}>
          <h2 id="sa-flow" className="sa-h2">申し込みから掲載までの流れ</h2>
          <ol className="sa-flow">
            {FLOW_STEPS.map((s) => (
              <li key={s.title}>
                <strong>{s.title}</strong>
                <span>{s.body}</span>
              </li>
            ))}
          </ol>
          <p className="sa-note">枠取りが完了したあとは、掲出場所や期間を変更できません。</p>
        </section>

        <section aria-labelledby="sa-faq" style={secLabel('FAQ')}>
          <h2 id="sa-faq" className="sa-h2">よくある質問</h2>
          <div className="sa-faq">
            {FAQ_ITEMS.map(({ q, a }) => (
              <details key={q} className="sa-more">
                <summary>{q}</summary>
                <p className="sa-text">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {adEnabled && (
          <section id="sa-apply" aria-labelledby="sa-apply-heading" style={secLabel('PR')}>
            <h2 id="sa-apply-heading" className="sa-h2">公式サイトで掲載枠を探す</h2>
            <SupportAdsCta placement="support_ads_bottom" />
          </section>
        )}

        <p className="sa-source">
          このページの料金・条件は、{OFFICIAL_CHECKED_AT}時点で推しアド公式サイト（使い方ガイド・よくある質問・費用ガイド）に掲載されていた内容を、推しサーチが独自に整理したものです。
          内容は変更されることがあるため、申し込み前に必ず推しアドのサイトで最新の情報を確認してください。
        </p>
      </div>
    </div>
  );
}
