/**
 * J「実際の画面で見せる」（real-screen）。4枚構成。予約画面で選べるほか、「自動（おすすめ）」の候補にも入る（生成できる人物だけ）。
 * 役割：推しサーチが実際に使えるサービスで、出演作品・配信先だけでなく関連商品までまとめて探せることを、実際の画面感で見せる
 * （H＝機能を一瞬で理解させる、G＝「検索しすぎ」の共感から入る）。
 *
 * 1枚目: 「（人物名）、検索してみた。」＋サイトのヘッダー（ロゴ＋人物名入りの検索欄）＋検索結果（人物ページ上部と3つの件数）
 * 2枚目: 「気になる作品、どこで見れる？」＋人物ページの「配信中の作品」欄（作品3件：画像・作品名・配信サービス）
 * 3枚目: 「関連商品も、一緒に探せる。」＋人物ページの関連商品欄を見ている実画面風（カテゴリのタブと件数、商品カード＝カテゴリごとに商品名の例1件。商品画像は使わない）
 * 4枚目: 「作品も、配信先も、関連商品も、まとめて。」＋サイト画面の枠（検索欄＋3つの件数）＋プロフィールへの案内
 * 4枚とも上部に「作品・配信先・関連商品」のタブを出し、そのページで見せている要素を強調する。
 * 画面はサーバー側で実データから描画し、本番の人物ページへはアクセスしない（閲覧数も増えない）。
 * 2枚目の作品は呼び出し側（site-ui/builders.ts の prepareRealScreen）が、H 2枚目と同じ選び方で画像のある3件を選んで渡す。
 */
import type { ReactElement, ReactNode } from 'react';
import { COLORS, DOT_BACKGROUND } from './theme';
import { SiteLogo, SearchBar, ServiceChip, FilmIcon, PlayIcon, ProductIcon, WorkThumb, fallbackInitial, fitFontSize, estimateTextUnits, type ProductKind } from './shared';
import { Canvas } from './gj-parts';
import type { SiteUiTemplateData } from './types';

/** 「実際の画面」ラベル（Jの目印） */
function RealLabel(): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', border: `3px solid ${COLORS.accent}`, borderRadius: 30 }}>
      <div style={{ width: 14, height: 14, borderRadius: 7, background: COLORS.accent, display: 'flex' }} />
      <span style={{ fontSize: 24, fontWeight: 700, color: COLORS.accent, display: 'flex' }}>推しサーチの実際の画面</span>
    </div>
  );
}

type Focus = 'works' | 'services' | 'products';
const TABS: { key: Focus; label: string }[] = [
  { key: 'works', label: '作品' },
  { key: 'services', label: '配信先' },
  { key: 'products', label: '関連商品' },
];

/** 4枚共通の上部：「実際の画面」ラベル＋「作品・配信先・関連商品」タブ（そのページで見せている要素を黒で強調） */
function TopRow({ focus }: { focus: Focus[] }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <RealLabel />
      <div style={{ display: 'flex', gap: 8 }}>
        {TABS.map((t) => {
          const on = focus.includes(t.key);
          return (
            <span
              key={t.key}
              style={{
                fontSize: 24,
                fontWeight: 700,
                padding: '8px 16px',
                borderRadius: 6,
                border: `3px solid ${on ? COLORS.ink : COLORS.border}`,
                background: on ? COLORS.ink : COLORS.white,
                color: on ? COLORS.white : '#A6A59E',
                display: 'flex',
              }}
            >
              {t.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 検索結果として出る人物の見出し（人物ページ上部と同じ構成：頭文字・PROFILE / PERSON・人物名・グループ） */
function ResultHeader({ data, size }: { data: SiteUiTemplateData; size: number }): ReactElement {
  const u = (n: number) => Math.round(n * size);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: u(22) }}>
      <div style={{ width: u(104), height: u(104), border: `${u(4)}px solid ${COLORS.accent}`, background: COLORS.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: u(50), fontWeight: 700, color: COLORS.accent, display: 'flex' }}>{fallbackInitial(data.personName)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: u(4) }}>
        <span style={{ fontSize: u(18), fontWeight: 700, letterSpacing: u(3), color: COLORS.accent, display: 'flex' }}>PROFILE / PERSON</span>
        <span style={{ fontSize: u(46), fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{data.personName}</span>
        {data.group && <span style={{ fontSize: u(22), color: COLORS.muted, display: 'flex' }}>{data.group}</span>}
      </div>
    </div>
  );
}

/** 人物ページの統計ボックスと同じ見た目（白地・黒枠） */
function SiteStat({ label, value, unit, icon }: { label: string; value: number; unit: string; icon: ReactNode }): ReactElement {
  return (
    <div style={{ flex: 1, height: 156, border: `3px solid ${COLORS.ink}`, background: COLORS.surface, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <span style={{ fontSize: 26, fontWeight: 700, color: COLORS.muted, display: 'flex' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 70, fontWeight: 700, lineHeight: 1.05, color: COLORS.ink, display: 'flex' }}>{value}</span>
        <span style={{ fontSize: 30, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{unit}</span>
      </div>
    </div>
  );
}

function J1({ data }: { data: SiteUiTemplateData }): ReactElement {
  const head = `${data.personName}、`;
  return (
    <Canvas bg="white">
      <div style={{ padding: '52px 64px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <TopRow focus={['works', 'services', 'products']} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: fitFontSize(head, 952, 112, 72), fontWeight: 700, lineHeight: 1.12, color: COLORS.accent, display: 'flex' }}>{head}</span>
          <span style={{ fontSize: 96, fontWeight: 700, lineHeight: 1.12, color: COLORS.ink, display: 'flex' }}>検索してみた。</span>
        </div>
      </div>
      {/* 実際のサイト：ヘッダー（ロゴ＋検索欄）→ 検索結果（人物ページ上部） */}
      <div style={{ margin: '40px 44px 0', border: `3px solid ${COLORS.ink}`, borderRadius: 20, overflow: 'hidden', ...DOT_BACKGROUND, display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,0.12)' }}>
        <div style={{ padding: '26px 28px', borderBottom: `3px solid ${COLORS.ink}`, display: 'flex', alignItems: 'center', gap: 20, background: COLORS.bg }}>
          <SiteLogo fontSize={30} />
          <SearchBar text={data.personName} width={690} fontSize={38} />
        </div>
        <div style={{ padding: '32px 30px 36px', display: 'flex', flexDirection: 'column', gap: 28 }}>
          <ResultHeader data={data} size={1.05} />
          <div style={{ display: 'flex', gap: 14 }}>
            <SiteStat label="出演作品" value={data.workCount} unit="件" icon={<FilmIcon size={30} color={COLORS.accent} />} />
            <SiteStat label="配信サービス" value={data.serviceCount} unit="社" icon={<PlayIcon size={30} color={COLORS.accent} />} />
            <SiteStat label="関連商品" value={data.productCount} unit="件" icon={<ProductIcon kind="グッズ" size={30} color={COLORS.accent} />} />
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 64, bottom: 30, display: 'flex', fontSize: 22, color: COLORS.muted }}>※件数は確認時点の情報です</div>
    </Canvas>
  );
}

/** 作品名・商品名を幅に収める。最小の文字サイズでも入らない長い名前は、途中で切って「…」を付ける */
function fitLine(text: string, width: number, max: number, min: number): { text: string; size: number } {
  const size = fitFontSize(text, width, max, min);
  if (estimateTextUnits(text) * size <= width) return { text, size };
  const chars = Array.from(text);
  while (chars.length > 1 && (estimateTextUnits(chars.join('')) + 1) * min > width) chars.pop();
  return { text: `${chars.join('').trimEnd()}…`, size: min };
}

/** 人物ページの一覧欄の見出し（WATCH NOW / SHOP ＋欄名＋件数） */
function PanelHead({ en, title, count }: { en: string; title: string; count: string }): ReactElement {
  return (
    <div style={{ padding: '16px 26px', borderBottom: `3px solid ${COLORS.ink}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: COLORS.bg }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, color: COLORS.accent, display: 'flex' }}>{en}</span>
        <span style={{ fontSize: fitFontSize(title, 620, 34, 24), fontWeight: 700, color: COLORS.ink, display: 'flex', whiteSpace: 'nowrap' }}>{title}</span>
      </div>
      <span style={{ fontSize: 30, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{count}</span>
    </div>
  );
}

const PANEL_STYLE = {
  margin: '26px 44px 0',
  border: `3px solid ${COLORS.ink}`,
  borderRadius: 20,
  overflow: 'hidden',
  ...DOT_BACKGROUND,
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 20px 50px rgba(0,0,0,0.12)',
} as const;

function Headline({ first, second }: { first: string; second: string }): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.12, color: COLORS.ink, display: 'flex' }}>{first}</span>
      <span style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.12, color: COLORS.accent, display: 'flex' }}>{second}</span>
    </div>
  );
}

// ─── 2枚目：出演作品・配信先 ─────────────────────────────────────────────────
function J2({ data }: { data: SiteUiTemplateData }): ReactElement {
  return (
    <Canvas bg="white">
      <div style={{ padding: '52px 64px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TopRow focus={['works', 'services']} />
        <Headline first="気になる作品、" second="どこで見れる？" />
      </div>
      <div style={PANEL_STYLE}>
        <PanelHead en="WATCH NOW" title={`${data.personName}の配信中の作品`} count={`${data.streamingWorkCount}件`} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {data.works.map((w, i) => {
            const t = fitLine(w.title, 700, 36, 26);
            return (
              <div key={w.title} style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '12px 26px', borderBottom: i < data.works.length - 1 ? `2px solid ${COLORS.border}` : 'none', background: COLORS.surface }}>
                <WorkThumb image={w.image} width={78} height={104} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
                  <span style={{ fontSize: t.size, fontWeight: 700, color: COLORS.ink, display: 'flex', whiteSpace: 'nowrap', overflow: 'hidden' }}>{t.text}</span>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {w.services.map((sv) => <ServiceChip key={sv} name={sv} fontSize={26} />)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: 56, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', fontSize: 34, fontWeight: 700, color: COLORS.ink }}>
          <span style={{ display: 'flex' }}>出演作品</span>
          <span style={{ display: 'flex', color: COLORS.accent, margin: '0 6px' }}>{`${data.workCount}件`}</span>
          <span style={{ display: 'flex' }}>・配信サービス</span>
          <span style={{ display: 'flex', color: COLORS.accent, margin: '0 6px' }}>{`${data.serviceCount}社`}</span>
          <span style={{ display: 'flex' }}>から、</span>
        </div>
        <span style={{ fontSize: 34, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>見られるサブスクをそのまま確認。</span>
      </div>
    </Canvas>
  );
}

// ─── 3枚目：関連商品（人物ページの関連商品欄を見ている実画面風） ─────────────────────
/** 商品名の表示用の整形（特典・限定などの記号部分を外す。データ自体は変えない） */
function cleanProductTitle(title: string): string {
  const cleaned = title
    .replace(/【[^】]*】/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/★[^★]*★/g, ' ')
    .replace(/[★☆]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || title;
}

/** カテゴリの商品名（最大3件）から、記号の少ない読みやすいものを1件選ぶ */
function pickExample(titles: string[]): string | null {
  if (titles.length === 0) return null;
  const noise = (t: string) => (t.match(/[★☆【】\[\]]/g) ?? []).length;
  return cleanProductTitle([...titles].sort((x, y) => noise(x) - noise(y))[0]);
}

/** 2行に収める（2行目に入らない分は「…」）。英数字の単語の途中では改行せず、直前の空白で改行する */
function twoLines(text: string, width: number, size: number): string[] {
  const perLine = width / size;
  let rest = Array.from(text);
  const lines: string[] = [];
  while (rest.length > 0 && lines.length < 2) {
    let n = 0;
    while (n < rest.length && estimateTextUnits(rest.slice(0, n + 1).join('')) <= perLine) n++;
    if (n < rest.length && /[A-Za-z0-9.．]/.test(rest[n] ?? '') && /[A-Za-z0-9.．]/.test(rest[n - 1] ?? '')) {
      const space = rest.slice(0, n).lastIndexOf(' ');
      if (space > 0) n = space + 1;
    }
    lines.push(rest.slice(0, n).join('').trimEnd());
    rest = rest.slice(n);
    while (rest[0] === ' ') rest = rest.slice(1);
  }
  if (rest.length > 0) {
    let last = Array.from(lines[1]);
    while (last.length > 1 && estimateTextUnits(last.join('') + '…') > perLine) last = last.slice(0, -1);
    lines[1] = `${last.join('').trimEnd()}…`;
  }
  return lines;
}

/** 人物ページの関連商品欄の「商品カード」風（商品画像は使わず、カテゴリのアイコンを置く） */
function ProductCard({ label, title }: { label: ProductKind; title: string }): ReactElement {
  const lines = twoLines(title, 290, 26);
  return (
    <div style={{ flex: 1, display: 'flex', gap: 16, padding: '16px', border: `2px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.surface }}>
      <div style={{ width: 104, height: 104, borderRadius: 8, background: COLORS.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <ProductIcon kind={label} size={52} color={COLORS.accent} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
        <span style={{ alignSelf: 'flex-start', fontSize: 20, fontWeight: 700, color: COLORS.accent, border: `2px solid ${COLORS.accent}`, borderRadius: 4, padding: '1px 8px', display: 'flex' }}>{label}</span>
        {lines.map((l, i) => (
          <span key={i} style={{ fontSize: 26, fontWeight: 700, color: COLORS.ink, lineHeight: 1.3, display: 'flex', whiteSpace: 'nowrap' }}>{l}</span>
        ))}
      </div>
    </div>
  );
}

function J3({ data }: { data: SiteUiTemplateData }): ReactElement {
  const sections = data.productSections.slice(0, 4);
  const cards = sections.map((s) => ({ label: s.label, title: pickExample(s.titles) })).filter((c): c is { label: ProductKind; title: string } => !!c.title);
  const rows = [cards.slice(0, 2), cards.slice(2, 4)].filter((r) => r.length > 0);
  return (
    <Canvas bg="white">
      <div style={{ padding: '52px 64px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TopRow focus={['products']} />
        <Headline first="関連商品も、" second="一緒に探せる。" />
      </div>
      <div style={PANEL_STYLE}>
        <PanelHead en="SHOP" title={`${data.personName}の関連商品`} count={`${data.productCount}件`} />
        {/* サイトの関連商品欄と同じく、カテゴリのタブ（件数つき） */}
        <div style={{ display: 'flex', gap: 10, padding: '16px 22px', borderBottom: `2px solid ${COLORS.border}`, background: COLORS.surface }}>
          {sections.map((s, i) => (
            <div
              key={s.label}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 6,
                border: `2px solid ${COLORS.ink}`,
                background: i === 0 ? COLORS.ink : COLORS.white,
                color: i === 0 ? COLORS.white : COLORS.ink,
              }}
            >
              <span style={{ fontSize: 24, fontWeight: 700, display: 'flex', whiteSpace: 'nowrap' }}>{s.label}</span>
              <span style={{ fontSize: 24, fontWeight: 700, color: i === 0 ? COLORS.white : COLORS.accent, display: 'flex' }}>{s.count}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 22px 20px', background: COLORS.surface }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 12 }}>
              {r.map((c) => <ProductCard key={c.label} label={c.label} title={c.title} />)}
              {r.length === 1 && <div style={{ flex: 1, display: 'flex' }} />}
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: 44, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 34, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>作品を見たあとに、推し活で欲しい物まで。</span>
        <span style={{ fontSize: 20, color: COLORS.muted, display: 'flex' }}>※商品情報は確認時点の情報です。商品画像は掲載していません</span>
      </div>
    </Canvas>
  );
}

// ─── 4枚目：まとめ＋CTA ──────────────────────────────────────────────────────
function SummaryCard({ icon, label, value, unit }: { icon: ReactNode; label: string; value: number; unit: string }): ReactElement {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '32px 10px', border: `3px solid ${COLORS.ink}`, borderRadius: 12, background: COLORS.surface }}>
      <div style={{ width: 84, height: 84, borderRadius: 42, background: COLORS.accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
      <span style={{ fontSize: 30, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.05, color: COLORS.accent, display: 'flex' }}>{value}</span>
        <span style={{ fontSize: 30, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{unit}</span>
      </div>
    </div>
  );
}

function J4({ data }: { data: SiteUiTemplateData }): ReactElement {
  return (
    <Canvas bg="white">
      <div style={{ padding: '52px 64px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TopRow focus={['works', 'services', 'products']} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.14, color: COLORS.ink, display: 'flex' }}>作品も、配信先も、</span>
          <span style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.14, color: COLORS.accent, display: 'flex' }}>関連商品も、まとめて。</span>
        </div>
      </div>
      {/* 1〜3枚目と同じ「サイト画面」の枠：検索欄 → 3つの件数 */}
      <div style={PANEL_STYLE}>
        <div style={{ padding: '22px 26px', borderBottom: `3px solid ${COLORS.ink}`, display: 'flex', alignItems: 'center', gap: 20, background: COLORS.bg }}>
          <SiteLogo fontSize={30} />
          <SearchBar text={data.personName} width={690} fontSize={36} />
        </div>
        <div style={{ display: 'flex', gap: 14, padding: '24px 22px', background: COLORS.surface }}>
          <SummaryCard icon={<FilmIcon size={46} color={COLORS.accent} />} label="出演作品" value={data.workCount} unit="件" />
          <SummaryCard icon={<PlayIcon size={46} color={COLORS.accent} />} label="配信サービス" value={data.serviceCount} unit="社" />
          <SummaryCard icon={<ProductIcon kind="グッズ" size={46} color={COLORS.accent} />} label="関連商品" value={data.productCount} unit="件" />
        </div>
      </div>
      {/* CTA はページ下端に固定せず、枠のすぐ下に一定の間隔で置く（検索欄・件数カード・CTAをひとまとまりに見せる） */}
      <div style={{ padding: '58px 64px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={{ fontSize: 34, fontWeight: 700, color: COLORS.muted, display: 'flex' }}>気になる推しができたら、まず推しサーチへ。</span>
        <div style={{ display: 'flex', alignItems: 'baseline', fontSize: 42, fontWeight: 700 }}>
          <span style={{ color: COLORS.ink, display: 'flex' }}>プロフィールのリンクから</span>
          <span style={{ color: COLORS.accent, display: 'flex', borderBottom: `5px solid ${COLORS.accent}` }}>『推しサーチ』</span>
          <span style={{ color: COLORS.ink, display: 'flex' }}>へ</span>
        </div>
      </div>
    </Canvas>
  );
}

export function buildRealScreenPages(data: SiteUiTemplateData): ReactElement[] {
  return [<J1 key="1" data={data} />, <J2 key="2" data={data} />, <J3 key="3" data={data} />, <J4 key="4" data={data} />];
}
