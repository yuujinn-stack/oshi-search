import type { Metadata } from 'next';
import Link from 'next/link';
import { secLabel } from '@/components/oshi-vod/sec-label';
import GraphicPageStyles from '@/components/site/GraphicPageStyles';
import OshiCardPersonPicker from '@/components/oshi-card/OshiCardPersonPicker';
import OshiCardEditor from '@/components/oshi-card/OshiCardEditor';
import OshiCardShare from '@/components/oshi-card/OshiCardShare';
import OshiCardTracking from '@/components/oshi-card/OshiCardTracking';
import OshiCardCreateCta from '@/components/oshi-card/OshiCardCreateCta';
import { getOshiVodPickerData } from '@/lib/oshi-vod/data';
import { loadOshiCardPerson, type OshiCardPersonData } from '@/lib/oshi-card/data';
import { resolveOshiCardWorks, type OshiCardWork } from '@/lib/oshi-card/core';
import { buildOshiCardSocialMetadata } from '@/lib/oshi-card/og-meta';
import {
  OSHI_CARD_DISCLAIMER,
  OSHI_CARD_PATH,
  buildOshiCardEditPath,
  parseOshiCardParams,
  type OshiCardSelection,
} from '@/lib/oshi-card/params';
import './oshi-card.css';

// 内容は searchParams に依存するため動的レンダリング。
export const dynamic = 'force-dynamic';

const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://oshi-search.jp';
const CANONICAL_URL = `${SITE_ORIGIN}${OSHI_CARD_PATH}`;
const PAGE_TITLE = '推し布教カード｜推しのおすすめ作品を選んでSNSでシェア';
const PAGE_DESCRIPTION =
  '推しと、おすすめしたい出演作品を1〜3つ選ぶだけで、SNSに投稿できる布教カードが作れます。ノーマル・デコの2デザイン。会員登録は不要です。';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

type View =
  | { kind: 'pick'; notice?: string }
  | { kind: 'error'; personName: string }
  | { kind: 'edit'; person: OshiCardPersonData; notice?: string }
  | { kind: 'card'; person: OshiCardPersonData; works: OshiCardWork[]; selection: OshiCardSelection; notice?: string };

/** URL から表示内容を決める（人物・作品はサーバー側で検証し、無効な値は除く） */
async function resolveView(sp: Record<string, string | string[] | undefined>): Promise<View> {
  const parsed = parseOshiCardParams(sp);
  if (!parsed.person) return { kind: 'pick' };
  let person: OshiCardPersonData | null;
  try {
    person = await loadOshiCardPerson(parsed.person);
  } catch (err) {
    console.error('[oshi-card] load failed:', String(err));
    return { kind: 'error', personName: parsed.person };
  }
  if (!person) return { kind: 'pick', notice: `「${parsed.person}」は見つかりませんでした。推しを選び直してください。` };
  const { works, invalidIds } = resolveOshiCardWorks(parsed.workIds, person.candidates);
  const notice = invalidIds.length > 0 || parsed.workOverflow
    ? `${person.name}の作品として確認できない作品${parsed.workOverflow ? '・4件目以降' : ''}を除いています。`
    : undefined;
  if (works.length === 0 || parsed.edit) return { kind: 'edit', person, notice: parsed.workIds.length > 0 && works.length === 0 ? `${person.name}の作品として確認できない作品が指定されていました。作品を選び直してください。` : notice };
  const selection: OshiCardSelection = { person: person.name, workIds: works.map((w) => w.id), variant: parsed.variant, phrase: parsed.phrase };
  return { kind: 'card', person, works, selection, notice };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const base: Metadata = {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
    alternates: { canonical: CANONICAL_URL },
    openGraph: { title: PAGE_TITLE, description: PAGE_DESCRIPTION, type: 'website', url: CANONICAL_URL },
  };
  // 人物・作品の組み合わせのURLは大量に生成されうるため、インデックスさせない（本体だけを index・canonical は本体へ）。
  if (!Object.values(sp).some((v) => v !== undefined)) return base;
  const meta: Metadata = { ...base, robots: { index: false, follow: true } };
  const view = await resolveView(sp);
  if (view.kind === 'edit') return { ...meta, title: `${view.person.name}の布教カードを作る` };
  if (view.kind !== 'card') return meta;
  // 完成カードのURLだけ、X・LINE のカード画像をそのカードの画像にする
  return {
    ...meta,
    title: `${view.person.name}の布教カード`,
    ...buildOshiCardSocialMetadata({ selection: view.selection, titles: view.works.map((w) => w.title), siteOrigin: SITE_ORIGIN, baseOpenGraph: base.openGraph }),
  };
}

export default async function OshiCardPage({ searchParams }: Props) {
  const sp = await searchParams;
  const parsed = parseOshiCardParams(sp);
  const view = await resolveView(sp);
  const fromShare = !!parsed.shareMethod || parsed.from === 'share';

  return (
    <div className="oshi-graphic-page oshi-graphic-page--oshicard oc-page max-w-3xl mx-auto px-4 py-6">
      <GraphicPageStyles />
      <OshiCardTracking
        stage={view.kind === 'card' ? 'card' : view.kind === 'edit' ? 'edit' : 'pick'}
        source={parsed.from}
        shareMethod={view.kind === 'card' ? parsed.shareMethod : null}
        variant={parsed.variant}
        workCount={view.kind === 'card' ? view.works.length : 0}
      />

      <nav aria-label="パンくずリスト" className="text-xs mb-4" style={{ color: 'var(--ds-muted)' }}>
        <Link href="/" className="theme-text-link">ホーム</Link>
        <span className="mx-1.5" style={{ opacity: 0.4 }}>›</span>
        {view.kind === 'pick' ? <span>推し布教カード</span> : <Link href={OSHI_CARD_PATH} className="theme-text-link">推し布教カード</Link>}
      </nav>

      {view.kind === 'card' ? (
        <CardView view={view} fromShare={!!parsed.shareMethod} />
      ) : (
        <>
          <h1 className="oc-h1">推し布教カード</h1>
          <p className="oc-lead">推しと、おすすめしたい出演作品を選ぶだけで、SNSに投稿できる布教カードが作れます。会員登録は不要です。</p>
          {view.kind !== 'error' && view.notice && <p className="oc-notice" role="status">{view.notice}</p>}

          {view.kind === 'error' ? (
            <div className="oc-panel">
              <p className="oc-empty-title">作品情報を一時的に取得できませんでした。</p>
              <p className="oc-note">時間をおいて再度お試しください。</p>
              <div className="oc-row-buttons"><Link href={buildOshiCardEditPath(view.personName)} className="oc-btn-sub">もう一度読み込む</Link></div>
            </div>
          ) : view.kind === 'edit' ? (
            <div className="oc-sections">
              <section className="oc-step" style={secLabel('STEP')} aria-labelledby="oc-step-person">
                <h2 id="oc-step-person" className="oc-step-title">推し</h2>
                <div className="oc-selected">
                  <span className="oc-selected-name">{view.person.name}</span>
                  {view.person.group && <span className="oc-selected-sub">{view.person.group}</span>}
                  <Link href={OSHI_CARD_PATH} className="oc-btn-sub">変更する</Link>
                </div>
              </section>
              <OshiCardEditor
                person={{ name: view.person.name, group: view.person.group }}
                candidates={view.person.candidates}
                initial={{ workIds: parsed.workIds, variant: parsed.variant, phrase: parsed.phrase }}
              />
            </div>
          ) : (
            <PickView from={fromShare ? 'share' : parsed.from} />
          )}
        </>
      )}
    </div>
  );
}

async function PickView({ from }: { from: ReturnType<typeof parseOshiCardParams>['from'] }) {
  const picker = await getOshiVodPickerData();
  return (
    <div className="oc-sections">
      <section className="oc-step" style={secLabel('STEP')} aria-labelledby="oc-step-pick">
        <h2 id="oc-step-pick" className="oc-step-title">推しを選ぶ</h2>
        <OshiCardPersonPicker persons={picker.persons} groups={picker.groups} from={from} />
      </section>
      <section className="oc-step" style={secLabel('HOW TO')} aria-labelledby="oc-about">
        <h2 id="oc-about" className="oc-step-title">布教カードの作り方</h2>
        <ol className="oc-howto">
          <li>推しを選ぶ</li>
          <li>推しサーチに登録されている出演作品から、おすすめしたい作品を1〜3つ選ぶ</li>
          <li>順番・デザイン（ノーマル／デコ）・ひとことを選ぶ</li>
          <li>画像を保存するか、X・LINE でシェアする</li>
        </ol>
        <p className="oc-note">作品の選び方は自由です。カードには「投稿者のおすすめ」として表示され、公式の順位にはなりません。</p>
      </section>
    </div>
  );
}

function CardView({ view, fromShare }: { view: Extract<View, { kind: 'card' }>; fromShare: boolean }) {
  const { person, works, selection } = view;
  return (
    <div className="oc-sections">
      {fromShare && (
        <div className="oc-visit" role="note">
          <p className="oc-visit-text"><strong>共有された布教カードです。</strong>{person.name}のおすすめ作品をチェックしてみてください。</p>
        </div>
      )}
      <header>
        <p className="oc-kicker">推し布教カード</p>
        <h1 className="oc-h1">{person.name}の布教カード</h1>
        {view.notice && <p className="oc-notice" role="status">{view.notice}</p>}
      </header>

      <section style={secLabel('WORKS')} aria-labelledby="oc-works-heading">
        <h2 id="oc-works-heading" className="oc-h2">おすすめ作品</h2>
        <ol className="oc-card-works">
          {works.map((w, i) => (
            <li key={w.id} className="oc-card-work">
              <span className="oc-card-work-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="oc-card-work-body">
                {w.url ? <Link href={w.url} className="oc-card-work-title">{w.title}</Link> : <span className="oc-card-work-title">{w.title}</span>}
                <span className="oc-card-work-meta">{w.year ? `${w.typeLabel}・${w.year}` : w.typeLabel}</span>
                {w.url && <Link href={w.url} className="oc-card-work-link">作品ページで配信情報を見る →</Link>}
              </span>
            </li>
          ))}
        </ol>
        <p className="oc-note">{OSHI_CARD_DISCLAIMER}</p>
        <p className="oc-note"><Link href={`/person/${encodeURIComponent(person.name)}`} className="theme-text-link">{person.name}の出演作品・関連商品をもっと見る</Link></p>
      </section>

      {/* 共有ページからの新規作成の導線（必ず置く）。共有された人には一番上にも置く */}
      {fromShare && <OshiCardCreateCta fromShare />}

      <section style={secLabel('SHARE')} aria-labelledby="oc-share-heading">
        <h2 id="oc-share-heading" className="oc-h2">{fromShare ? 'このカードをシェアする' : 'カードを保存・シェアする'}</h2>
        <OshiCardShare selection={selection} titles={works.map((w) => w.title)} />
        {!fromShare && (
          <p className="oc-note oc-center">
            <Link href={buildOshiCardEditPath(person.name, { selection: { workIds: selection.workIds, variant: selection.variant, phrase: selection.phrase } })} className="theme-text-link">作品・順番・ひとことを変える</Link>
          </p>
        )}
      </section>

      <section style={secLabel('CREATE')} aria-labelledby="oc-create-heading">
        <h2 id="oc-create-heading" className="oc-h2">あなたの推しでも作ってみて</h2>
        <p className="oc-lead">推しと、おすすめの出演作品を選ぶだけ。会員登録は不要です。</p>
        <OshiCardCreateCta fromShare={fromShare} />
      </section>
    </div>
  );
}
