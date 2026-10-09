import type { Metadata } from 'next';
import Link from 'next/link';
import GraphicPageStyles from '@/components/site/GraphicPageStyles';
import OshiVodPersonPicker, { type DiagnosisStartSource } from '@/components/oshi-vod/OshiVodPersonPicker';
import OshiVodResultHero from '@/components/oshi-vod/OshiVodResultHero';
import OshiVodRankings from '@/components/oshi-vod/OshiVodRankings';
import OshiVodPairs from '@/components/oshi-vod/OshiVodPairs';
import OshiVodWorkLists from '@/components/oshi-vod/OshiVodWorkLists';
import OshiVodPersonBreakdown from '@/components/oshi-vod/OshiVodPersonBreakdown';
import OshiVodDetailCompare from '@/components/oshi-vod/OshiVodDetailCompare';
import OshiVodShare from '@/components/oshi-vod/OshiVodShare';
import OshiVodTracker from '@/components/oshi-vod/OshiVodTracker';
import { secLabel } from '@/components/oshi-vod/sec-label';
import { getOshiVodPickerData, loadOshiVodDiagnosis } from '@/lib/oshi-vod/data';
import {
  OSHI_VOD_MAX_PERSONS,
  OSHI_VOD_PATH,
  buildOshiVodImagePath,
  buildOshiVodResultPath,
  parseOshiVodParams,
  resolveKnownNames,
} from '@/lib/oshi-vod/params';
import { formatEpochDate, formatPersonList } from '@/lib/oshi-vod/format';
import type { DiagnosisResult } from '@/lib/oshi-vod/types';
import './oshi-vod.css';

// 結果は searchParams に依存するため動的レンダリング（計算結果は data.ts で短時間キャッシュ）。
export const dynamic = 'force-dynamic';

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';
const CANONICAL_URL = `${SITE_ORIGIN}${OSHI_VOD_PATH}`;

const PAGE_TITLE = '推しに合うサブスク診断｜推しの出演作品が一番見られる動画配信サービスは？';
const PAGE_DESCRIPTION =
  '推しを選ぶだけで、出演作品を一番多く見放題で見られる動画配信サービスを診断。作品数・月額・コスパの3つのランキングと、2サービスの最適な組み合わせ、無料で見られる作品までまとめて確認できます。';

const DISCLAIMER = '配信状況や料金は変更される場合があります。契約前に各動画配信サービス公式サイトで最新情報をご確認ください。';

const FAQ_ITEMS = [
  {
    q: 'どうやって診断していますか？',
    a: '推しサーチに登録されている出演作品のうち、現在各動画配信サービスで見放題配信が確認できている作品をサービスごとに数えています。同じ作品に複数の推しが出演している場合は1作品として数えます。',
  },
  {
    q: '料金はどこの情報ですか？',
    a: '各動画配信サービスの公式サイトで確認した月額料金と確認日を表示しています。公式サイトで料金や条件を確認できなかったサービスは、月額・コスパのランキングに含めていません。',
  },
  {
    q: '広告はランキングの順位に影響しますか？',
    a: '影響しません。ランキングは作品数・料金・配信データだけで決めています。広告を表示している箇所には「PR」と表記しています。',
  },
  {
    q: '何人まで選べますか？',
    a: `一度に${OSHI_VOD_MAX_PERSONS}人まで選べます。グループの現メンバーが${OSHI_VOD_MAX_PERSONS}人以下なら、グループ全員をまとめて選択できます。`,
  },
];

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function hasAnyParam(sp: Record<string, string | string[] | undefined>): boolean {
  return Object.values(sp).some((v) => v !== undefined);
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const parsed = parseOshiVodParams(sp);
  const base: Metadata = {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    alternates: { canonical: CANONICAL_URL },
    openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'website', url: CANONICAL_URL },
  };
  // 人物の組み合わせ結果・導線用のURLは大量に生成されうるため、インデックスさせない。
  // （/oshi-vod 本体だけを index 対象とし、canonical も本体へ向ける）
  if (!hasAnyParam(sp)) return base;
  const title = parsed.names.length > 0
    ? `${formatPersonList(parsed.names)}に合うサブスク診断結果`
    : PAGE_TITLE;
  return {
    ...base,
    title,
    robots: { index: false, follow: true },
  };
}

function topServiceLabel(result: DiagnosisResult): string | null {
  const top = result.byWorkCount.filter((r) => r.rank === 1);
  if (top.length === 0) return null;
  return top.map((r) => r.stat.displayName).join('・');
}

export default async function OshiVodPage({ searchParams }: Props) {
  const sp = await searchParams;
  const parsed = parseOshiVodParams(sp);
  const picker = await getOshiVodPickerData();
  const known = new Set(picker.persons.map((p) => p.name));
  const { valid, unknown } = resolveKnownNames(parsed.names, known);
  const withValid = resolveKnownNames(parsed.withNames, known).valid;

  let result: DiagnosisResult | null = null;
  let loadError = false;
  if (valid.length > 0) {
    try {
      result = await loadOshiVodDiagnosis(valid);
    } catch (err) {
      console.error('[oshi-vod] diagnosis failed:', String(err));
      loadError = true;
    }
  }

  const pickerSource: DiagnosisStartSource | undefined = result
    ? 'result'
    : parsed.group ? 'group'
    : withValid.length > 1 ? 'group'
    : withValid.length === 1 ? 'person'
    : undefined;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: SITE_ORIGIN },
      { '@type': 'ListItem', position: 2, name: '推しに合うサブスク診断', item: CANONICAL_URL },
    ],
  };
  const webPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: '推しに合うサブスク診断',
    url: CANONICAL_URL,
    description: PAGE_DESCRIPTION,
    isPartOf: { '@type': 'WebSite', name: '推しサーチ', url: SITE_ORIGIN },
  };
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };

  const notices: string[] = [];
  if (unknown.length > 0) notices.push(`見つからなかった人物を除いて診断しました：${unknown.join('、')}`);
  if (parsed.overflow) notices.push(`一度に診断できるのは${OSHI_VOD_MAX_PERSONS}人までのため、${OSHI_VOD_MAX_PERSONS + 1}人目以降は除いています。`);
  if (parsed.names.length > 0 && valid.length === 0) notices.push('指定された人物が見つかりませんでした。あらためて推しを選んでください。');
  if (loadError) notices.push('診断結果を一時的に取得できませんでした。時間をおいて再度お試しください。');

  const pickerBlock = (
    <OshiVodPersonPicker
      persons={picker.persons}
      groups={picker.groups}
      initialSelected={result ? valid : withValid}
      initialGroup={parsed.group}
      source={pickerSource}
      submitLabel={result ? 'もう一度診断する' : '診断する'}
    />
  );

  return (
    <div className="oshi-graphic-page oshi-graphic-page--oshivod ov-page max-w-3xl mx-auto px-4 py-6">
      <GraphicPageStyles />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd) }} />
      {!result && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />}

      <nav aria-label="パンくずリスト" className="text-xs mb-4" style={{ color: 'var(--ds-muted)' }}>
        <Link href="/" className="theme-text-link">ホーム</Link>
        <span className="mx-1.5" style={{ opacity: 0.4 }}>›</span>
        <span>推しに合うサブスク診断</span>
      </nav>

      <h1 className="ov-h1">推しに合うサブスク診断</h1>

      {notices.map((n) => <p key={n} className="ov-notice" role="status">{n}</p>)}

      {result ? (
        <OshiVodTracker
          resultKey={valid.join('|')}
          personCount={valid.length}
          topService={result.byWorkCount[0]?.stat.service ?? null}
          targetWorkCount={result.totals.paid}
        >
          <div className="ov-sections">
            <OshiVodResultHero result={result} />
            <OshiVodRankings result={result} />
            <OshiVodPairs result={result} />
            <OshiVodWorkLists result={result} />
            <OshiVodPersonBreakdown result={result} />
            <OshiVodDetailCompare result={result} />

            <section aria-labelledby="ov-share-heading" style={secLabel('SHARE')}>
              <h2 id="ov-share-heading" className="ov-h2">結果をシェアする</h2>
              <OshiVodShare
                personNames={valid}
                topServiceLabel={topServiceLabel(result)}
                resultPath={buildOshiVodResultPath(valid)}
                imageFeedPath={buildOshiVodImagePath(valid, 'feed')}
                imageStoryPath={buildOshiVodImagePath(valid, 'story')}
              />
            </section>

            <section aria-labelledby="ov-note-heading" style={secLabel('NOTE')}>
              <h2 id="ov-note-heading" className="ov-h2">ご注意</h2>
              <ul className="ov-disclaimer">
                <li><strong>{DISCLAIMER}</strong></li>
                {result.checkedRange && (
                  <li>
                    配信情報の確認日：{formatEpochDate(result.checkedRange.min)}
                    {result.checkedRange.max !== result.checkedRange.min && `〜${formatEpochDate(result.checkedRange.max)}`}
                    （推しサーチでの確認日。作品ごとに異なります）
                  </li>
                )}
                <li>料金は各サービス公式サイトで確認した月額料金です。確認日と比較に使ったプランは「詳しい比較」に記載しています。</li>
                <li>ランキングは作品数・料金・配信データだけで決めています。広告（PR）の有無は順位に影響しません。</li>
                <li>Prime Videoの追加チャンネル（別料金）、レンタル・購入作品は見放題の作品数に含めていません。</li>
              </ul>
            </section>

            <section id="oshi-vod-picker" aria-labelledby="ov-retry-heading" style={secLabel('RETRY')}>
              <h2 id="ov-retry-heading" className="ov-h2">推しを変えて診断する</h2>
              {pickerBlock}
            </section>
          </div>
        </OshiVodTracker>
      ) : (
        <div className="ov-sections">
          <p className="ov-lead">
            推しを選ぶだけで、出演作品を一番多く見放題で見られる動画配信サービスがわかります。
            作品数・月額・コスパの3つのランキングと、2サービスの最適な組み合わせ、無料で見られる作品までまとめて表示します。
          </p>

          <section id="oshi-vod-picker" aria-labelledby="ov-pick-heading" style={secLabel('SELECT')}>
            <h2 id="ov-pick-heading" className="ov-h2">推しを選ぶ</h2>
            {pickerBlock}
          </section>

          <section aria-labelledby="ov-about-heading" style={secLabel('ABOUT')}>
            <h2 id="ov-about-heading" className="ov-h2">診断でわかること</h2>
            <ul className="ov-about-list">
              <li><strong>作品数・月額・コスパ</strong>の3つの目的別ランキング（数字の根拠つき）</li>
              <li>一番多く見られる<strong>2サービスの組み合わせ</strong>と、<strong>80%以上を最安で見る方法</strong></li>
              <li><strong>無料で見られる作品</strong>と、1位のサービスで見られない作品の<strong>代わりの視聴方法</strong></li>
              <li>結果は<strong>URLや画像でシェア</strong>できます</li>
            </ul>
          </section>

          <section aria-labelledby="ov-faq-heading" style={secLabel('FAQ')}>
            <h2 id="ov-faq-heading" className="ov-h2">よくある質問</h2>
            <div className="ov-faq">
              {FAQ_ITEMS.map(({ q, a }) => (
                <details key={q} className="ov-more">
                  <summary>{q}</summary>
                  <p className="ov-faq-a">{a}</p>
                </details>
              ))}
            </div>
            <p className="ov-note mt-4">{DISCLAIMER}</p>
          </section>
        </div>
      )}
    </div>
  );
}
