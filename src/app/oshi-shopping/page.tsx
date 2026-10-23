import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import GraphicPageStyles from '@/components/site/GraphicPageStyles';
import ProductCard from '@/components/ProductCard';
import OshiShoppingForm from '@/components/oshi-shopping/OshiShoppingForm';
import GeneralItemCard from '@/components/oshi-shopping/GeneralItemCard';
import OshiShoppingShare from '@/components/oshi-shopping/OshiShoppingShare';
import OshiShoppingResultTracker from '@/components/oshi-shopping/OshiShoppingResultTracker';
import { secLabel } from '@/components/oshi-vod/sec-label';
import { getOshiVodPickerData } from '@/lib/oshi-vod/data';
import {
  loadOshiShoppingGeneralPart,
  loadOshiShoppingPersonPart,
  type OshiShoppingGeneralPart,
  type OshiShoppingPersonPart,
} from '@/lib/oshi-shopping/data';
import {
  OSHI_SHOPPING_PATH,
  budgetLabel,
  buildOshiShoppingResultPath,
  nextBudget,
  parseOshiShoppingParams,
  useLabel,
  type OshiShoppingBudget,
  type OshiShoppingUse,
} from '@/lib/oshi-shopping/params';
import { productTabAnchorId } from '@/lib/product-tabs';
import { PRICE_FRESH_DAYS } from '@/lib/price-freshness';
import './oshi-shopping.css';

// 結果は searchParams に依存するため動的レンダリング（一般商品の楽天APIの結果は商品ごとに24時間キャッシュ）。
export const dynamic = 'force-dynamic';

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';
const CANONICAL_URL = `${SITE_ORIGIN}${OSHI_SHOPPING_PATH}`;
const PAGE_NAME = '推し活お買い物診断';
// 推しの関連商品の価格は取得時点の値のため、取得日時が分からない・古い価格は表示しない（src/lib/price-freshness.ts の strict）
const PRICE_NOTE_STRICT = `価格は楽天から取得した時点のものです。取得から${PRICE_FRESH_DAYS}日を超えた商品と取得日が分からない商品は価格を表示していません（予算は取得時点の価格で判定しています）。販売終了の場合もあるため、最新の価格・在庫は楽天の商品ページでご確認ください。`;

const PAGE_TITLE = '推し活お買い物診断｜推しの関連商品と推し活グッズを用途・予算から探す';
const PAGE_DESCRIPTION =
  '推しを選んで、用途と予算を答えるだけ。推しのCD・写真集・映像作品などの関連商品と、ライブ・収納・プレゼントに便利な推し活用品を、条件に合うものだけまとめて表示します。';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const base: Metadata = {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    alternates: { canonical: CANONICAL_URL },
    openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'website', url: CANONICAL_URL },
  };
  // 人物×用途×予算の結果URLは大量に生成されうるため、インデックスさせない（canonical は本体へ）
  if (!Object.values(sp).some((v) => v !== undefined)) return base;
  const { person } = parseOshiShoppingParams(sp);
  return { ...base, title: person ? `${person}の${PAGE_NAME}結果` : PAGE_TITLE, robots: { index: false, follow: true } };
}

function formatJstDate(ms: number): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(ms));
}

/** 予算を超える商品の件数（商品は表示しない）。APIを使った商品欄の中には楽天以外へのリンクを置かないため、リンクは付けない */
function OverBudgetNote({ result }: { result: { matchedCount: number; overBudgetCount: number } }) {
  if (result.overBudgetCount === 0) return null;
  return (
    <p className="os-note">
      {result.matchedCount === 0 ? '予算内の商品はありませんでしたが、' : ''}
      予算を超える商品が{result.overBudgetCount}件あります（ここには表示していません）。
    </p>
  );
}

/** 予算を1段階上げた診断へのリンク（商品欄とは別のセクションに置く。楽天ウェブサービス規約 第8条4項） */
function BudgetUpSection({ personName, overBudgetCount, use, budget }: { personName: string; overBudgetCount: number; use: OshiShoppingUse; budget: OshiShoppingBudget }) {
  const up = nextBudget(budget);
  if (!up || overBudgetCount === 0) return null;
  return (
    <section aria-labelledby="os-budget-heading" style={secLabel('BUDGET')}>
      <h2 id="os-budget-heading" className="os-h2">予算を上げて探す</h2>
      <p className="os-note">予算を超えるため表示していない商品があります。</p>
      <div className="os-links">
        <Link href={buildOshiShoppingResultPath(personName, use, up)} className="os-btn-link">予算を「{budgetLabel(up)}」にして診断する →</Link>
      </div>
    </section>
  );
}

function PersonBlock({ d, use, budget }: { d: OshiShoppingPersonPart; use: OshiShoppingUse; budget: OshiShoppingBudget }) {
  const r = d.personItems;
  return (
    <section aria-labelledby="os-person-heading" style={secLabel('OSHI ITEMS')}>
      <h2 id="os-person-heading" className="os-h2">{d.person.name}の関連商品</h2>
      <p className="os-note">推しサーチで{d.person.name}との関連を確認した楽天の商品から、用途と予算に合うものを表示しています（中古品・関連の確認が不確かな商品・販売終了を確認した商品は除いています）。</p>
      <p className="os-note">{PRICE_NOTE_STRICT}</p>
      {d.personError || !r ? (
        <p className="os-empty" role="status">関連商品を一時的に取得できませんでした。時間をおいて再度お試しください。</p>
      ) : !r.hasData || r.eligibleCount === 0 ? (
        <p className="os-empty" role="status">{d.person.name}の関連商品はまだ登録されていません。</p>
      ) : r.items.length === 0 ? (
        <>
          <p className="os-empty" role="status">「{useLabel(use)}」「{budgetLabel(budget)}」の条件に合う関連商品は見つかりませんでした。</p>
          <OverBudgetNote result={r} />
        </>
      ) : (
        <>
          <ul className="os-grid">
            {r.items.map((pick, i) => (
              <li key={`${pick.product.id}-${i}`} className="os-grid-item os-grid-item--person">
                <div className="os-badges">
                  <span className="os-badge">{pick.section}</span>
                  {pick.label && <span className="os-badge os-badge--rel">{pick.label}</span>}
                </div>
                <ProductCard
                  product={pick.product}
                  personSlug={d.person.name}
                  pageType="oshi_shopping"
                  placement="oshi_shopping_person"
                  position={i + 1}
                  displayCategory={pick.section}
                />
                {pick.seller && (
                  <p className="os-seller">{pick.seller.kind === 'books' ? '販売：楽天ブックス' : `販売：${pick.seller.shopName}（楽天市場のショップ）`}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="os-note">条件に合う商品 {r.matchedCount}件のうち、最大4件を表示しています。</p>
          <OverBudgetNote result={r} />
        </>
      )}
    </section>
  );
}

function GeneralHeading() {
  return (
    <>
      <h2 id="os-general-heading" className="os-h2">推し活に便利なアイテム</h2>
      <p className="os-general-lead">
        推しとは関係なく使える一般の商品です。特定の人物・グループの商品や公式グッズではありません。
      </p>
    </>
  );
}

/** 一般商品の取得中の表示（ストリーミングの間だけ） */
function GeneralLoading() {
  return (
    <div className="os-sections os-sections--stream">
      <section aria-labelledby="os-general-heading" aria-busy="true" style={secLabel('GOODS')}>
        <GeneralHeading />
        <p className="os-loading" role="status">楽天市場から商品情報を読み込んでいます…</p>
        <ul className="os-grid" aria-hidden="true">
          {[0, 1].map((i) => <li key={i} className="os-skeleton" />)}
        </ul>
      </section>
    </div>
  );
}

function GeneralBlock({ g, use, budget }: { g: OshiShoppingGeneralPart; use: OshiShoppingUse; budget: OshiShoppingBudget }) {
  const r = g.generalItems;
  const fetchedAt = r.items.length > 0 ? Math.min(...r.items.map((x) => x.item.fetchedAt)) : null;
  return (
    <section aria-labelledby="os-general-heading" style={secLabel('GOODS')}>
      <GeneralHeading />
      {r.items.length === 0 ? (
        <>
          <p className="os-empty" role="status">
            {g.notConfigured
              ? '推し活に便利なアイテムは準備中です。'
              : r.availableCount === 0 && g.failed > 0
              ? '商品情報を一時的に取得できませんでした。時間をおいて再度お試しください。'
              : `「${useLabel(use)}」「${budgetLabel(budget)}」の条件に合うアイテムは見つかりませんでした。`}
          </p>
          <OverBudgetNote result={r} />
        </>
      ) : (
        <>
          <ul className="os-grid">
            {r.items.map((x, i) => (
              <li key={x.entry.itemCode} className="os-grid-item">
                <GeneralItemCard
                  itemCode={x.entry.itemCode}
                  label={x.entry.label}
                  itemName={x.item.itemName}
                  price={x.item.price}
                  imageUrl={x.item.imageUrl}
                  affiliateUrl={x.item.affiliateUrl}
                  shopName={x.item.shopName}
                  reviewCount={x.item.reviewCount}
                  position={i + 1}
                  use={use}
                />
              </li>
            ))}
          </ul>
          {g.failed > 0 && <p className="os-note">一部の商品情報を取得できなかったため、表示していない商品があります。</p>}
          {fetchedAt && <p className="os-note">価格・在庫は{formatJstDate(fetchedAt)}時点の楽天市場の情報です。購入前に商品ページで最新の情報をご確認ください。</p>}
          <OverBudgetNote result={r} />
        </>
      )}
    </section>
  );
}

/** 一般商品（楽天API）を取得して表示する部分。推しの関連商品の表示を待たせないよう Suspense の中で描画する */
async function GeneralPart({ d, use, budget }: { d: OshiShoppingPersonPart; use: OshiShoppingUse; budget: OshiShoppingBudget }) {
  let g: OshiShoppingGeneralPart;
  try {
    g = await loadOshiShoppingGeneralPart(use, budget);
  } catch (err) {
    console.error('[oshi-shopping] general items failed:', String(err));
    g = { generalItems: { availableCount: 0, unavailableCount: 0, matchedCount: 0, overBudgetCount: 0, items: [] }, notConfigured: false, failed: 1 };
  }
  return (
    <div className="os-sections os-sections--stream">
      <OshiShoppingResultTracker
        resultKey={`${d.person.name}|${use}|${budget}`}
        use={use}
        budget={budget}
        personItemCount={d.personItems?.items.length ?? 0}
        generalItemCount={g.generalItems.items.length}
      />
      <GeneralBlock g={g} use={use} budget={budget} />
      <BudgetUpSection
        personName={d.person.name}
        overBudgetCount={(d.personItems?.overBudgetCount ?? 0) + g.generalItems.overBudgetCount}
        use={use}
        budget={budget}
      />
    </div>
  );
}

export default async function OshiShoppingPage({ searchParams }: Props) {
  const sp = await searchParams;
  const parsed = parseOshiShoppingParams(sp);
  const notices: string[] = [];

  let picker: Awaited<ReturnType<typeof getOshiVodPickerData>> = { persons: [], groups: [] };
  try {
    picker = await getOshiVodPickerData();
  } catch (err) {
    console.error('[oshi-shopping] picker data failed:', String(err));
    notices.push('推しの一覧を一時的に読み込めませんでした。時間をおいて再度お試しください。');
  }

  let diagnosis: OshiShoppingPersonPart | null = null;
  const hasAll = !!parsed.person && !!parsed.use && !!parsed.budget;
  if (hasAll) {
    try {
      diagnosis = await loadOshiShoppingPersonPart(parsed.person, parsed.use!, parsed.budget!);
      if (!diagnosis) notices.push('指定された推しが見つかりませんでした。名前を確認して、あらためて推しを選んでください（一時的に読み込めない場合もあります。その場合は時間をおいて再度お試しください）。');
    } catch (err) {
      console.error('[oshi-shopping] diagnosis failed:', String(err));
      notices.push('診断結果を一時的に取得できませんでした。時間をおいて再度お試しください。');
    }
  } else if (parsed.person && !parsed.use && !parsed.budget && Object.entries(sp).every(([k, v]) => k === 'p' || v === undefined)) {
    // 人物ページからの導線（人物だけ選択済み）：用途・予算を選んでもらう。登録されていない名前なら案内する
    if (picker.persons.length > 0 && !picker.persons.some((p) => p.name === parsed.person)) {
      notices.push('指定された推しが見つかりませんでした。名前を確認して、あらためて推しを選んでください。');
    }
  } else if (Object.values(sp).some((v) => v !== undefined)) {
    notices.push('条件が足りないため診断できませんでした。推し・用途・予算を選んでください。');
  }

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ホーム', item: SITE_ORIGIN },
      { '@type': 'ListItem', position: 2, name: PAGE_NAME, item: CANONICAL_URL },
    ],
  };

  const form = (
    <OshiShoppingForm
      persons={picker.persons}
      groups={picker.groups}
      initialPerson={diagnosis?.person.name ?? (parsed.person || undefined)}
      initialUse={parsed.use}
      initialBudget={parsed.budget}
      submitLabel={diagnosis ? '条件を変えて診断する' : '診断する'}
    />
  );

  const use = parsed.use!;
  const budget = parsed.budget!;
  const personTab = diagnosis?.personItems?.items[0] ? productTabAnchorId(diagnosis.personItems.items[0].section) : null;

  return (
    <div className="oshi-graphic-page oshi-graphic-page--oshishopping os-page max-w-3xl mx-auto px-4 py-6">
      <GraphicPageStyles />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

      <nav aria-label="パンくずリスト" className="text-xs mb-4" style={{ color: 'var(--ds-muted)' }}>
        <Link href="/" className="theme-text-link">ホーム</Link>
        <span className="mx-1.5" style={{ opacity: 0.4 }}>›</span>
        <span>{PAGE_NAME}</span>
      </nav>

      <h1 className="os-h1">{PAGE_NAME}</h1>
      <p className="os-pr">PR｜このページは楽天アフィリエイトを利用しています。</p>

      {notices.map((n) => <p key={n} className="os-notice" role="status">{n}</p>)}

      {diagnosis ? (
        <div className="os-sections">
          <section className="os-summary" aria-label="診断の条件">
            <p className="os-summary-head">{diagnosis.person.name}推しの「{useLabel(use)}」</p>
            <ul className="os-summary-tags">
              <li>{useLabel(use)}</li>
              <li>{budgetLabel(budget)}</li>
            </ul>
          </section>

          <PersonBlock d={diagnosis} use={use} budget={budget} />
          <Suspense fallback={<GeneralLoading />}>
            <GeneralPart d={diagnosis} use={use} budget={budget} />
          </Suspense>

          <section aria-labelledby="os-more-heading" style={secLabel('MORE')}>
            <h2 id="os-more-heading" className="os-h2">{diagnosis.person.name}の商品をもっと見る</h2>
            <p className="os-note">人物ページでは、関連商品をカテゴリ別にすべて見られます。</p>
            <div className="os-links">
              <Link href={`/person/${encodeURIComponent(diagnosis.person.name)}#${personTab ?? 'products'}`} className="os-btn-link">
                {diagnosis.person.name}の関連商品一覧へ →
              </Link>
            </div>
          </section>

          <section aria-labelledby="os-share-heading" style={secLabel('SHARE')}>
            <h2 id="os-share-heading" className="os-h2">結果をシェアする</h2>
            <OshiShoppingShare
              path={buildOshiShoppingResultPath(diagnosis.person.name, use, budget)}
              text={`${diagnosis.person.name}推しの「${useLabel(use)}」お買い物診断の結果 #推しサーチ`}
            />
          </section>

          <section id="oshi-shopping-form" aria-labelledby="os-retry-heading" style={secLabel('RETRY')}>
            <h2 id="os-retry-heading" className="os-h2">条件を変えて診断する</h2>
            {form}
          </section>
        </div>
      ) : (
        <div className="os-sections">
          <p className="os-lead">
            推しを選んで、用途と予算を答えるだけ。推しの関連商品と、推し活に便利なアイテムを、条件に合うものだけ表示します。
          </p>
          <section id="oshi-shopping-form" aria-labelledby="os-form-heading" style={secLabel('DIAGNOSIS')}>
            <h2 id="os-form-heading" className="os-h2">3つの質問に答える</h2>
            {form}
          </section>
          <section aria-labelledby="os-about-heading" style={secLabel('ABOUT')}>
            <h2 id="os-about-heading" className="os-h2">診断について</h2>
            <ul className="os-about">
              <li><strong>推しの関連商品</strong>は、推しサーチで推しとの関連を確認した楽天の商品（新品）から選びます。中古品は表示しません。</li>
              <li><strong>推し活に便利なアイテム</strong>は、推しサーチが選んだ一般の商品です。特定の人物・グループの商品や公式グッズではありません。</li>
              <li>条件（用途・予算）に合う商品だけを、それぞれ最大4件表示します。条件に合わない商品で埋めることはしません。</li>
              <li>「公式」かどうかは推しサーチでは確認していないため、公式グッズとは表示しません。</li>
            </ul>
          </section>
        </div>
      )}

      <div className="os-foot">
        <p>このページは推しサーチが制作・運営しています。商品の購入・配送・返品は、楽天市場の各ショップ（楽天ブックスを含む）とのお取引になります。価格・在庫・仕様は変わることがあるため、購入前に商品ページでご確認ください。商品のレビュー件数は人気の目安で、品質や安全性を保証するものではありません。</p>
      </div>
    </div>
  );
}
