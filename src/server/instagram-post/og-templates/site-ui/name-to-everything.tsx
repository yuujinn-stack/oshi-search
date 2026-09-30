/**
 * F「名前を入れたら、ここまで出る」（name-to-everything）。Preview専用。
 * 1枚目は文字だけで興味を引き、2枚目で推しサーチの人物ページを「出演作品 → 配信先 → 関連商品」の順に
 * 切り出したような画面で見せる。商品が0件の人物は関連商品のセクションを出さない。
 */
import type { ReactElement } from 'react';
import { COLORS, COMMON_TEXT } from './theme';
import {
  ArrowDown,
  BottomNote,
  ClosingBrand,
  FilmIcon,
  Page,
  PlayIcon,
  ProductIcon,
  SectionLabel,
  ServiceChip,
  SiteLogo,
  SearchBar,
  StatBox,
  WorkThumb,
  fitFontSize,
} from './shared';
import type { SiteUiTemplateData } from './types';

/**
 * 1枚目: 検索窓に人物名を1回入れる → 出演作品・配信サービス・関連商品の数がまとまって出る、を
 * 実際のサイトと同じ検索窓・統計ボックスの見た目で見せる（数字は人物ページと同じ集計値）。
 */
function Page1({ data }: { data: SiteUiTemplateData }): ReactElement {
  const stats = [
    { label: '出演作品', value: data.workCount, unit: '件', icon: <FilmIcon size={32} color={COLORS.muted} /> },
    ...(data.serviceCount > 0 ? [{ label: '配信サービス', value: data.serviceCount, unit: '社', icon: <PlayIcon size={32} color={COLORS.muted} /> }] : []),
    ...(data.productCount > 0 ? [{ label: '関連商品', value: data.productCount, unit: '件', icon: <ProductIcon kind="グッズ" size={32} color={COLORS.muted} /> }] : []),
  ];
  const statWidth = Math.floor((952 - (stats.length - 1) * 18) / stats.length);
  return (
    <Page>
      <div style={{ padding: '40px 64px 0', display: 'flex' }}>
        <SiteLogo fontSize={26} />
      </div>
      <div style={{ flex: 1, padding: '0 64px 40px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 80, fontWeight: 700, lineHeight: 1.2, color: COLORS.white, background: COLORS.ink, padding: '0 14px', display: 'flex' }}>名前を1回</span>
          <span style={{ fontSize: 80, fontWeight: 700, lineHeight: 1.2, color: COLORS.ink, display: 'flex' }}>入れたら、</span>
        </div>
        <span style={{ fontSize: 96, fontWeight: 700, lineHeight: 1.2, color: COLORS.accent, display: 'flex' }}>ここまで出る。</span>
        <div style={{ marginTop: 44, display: 'flex' }}>
          <SearchBar text={data.personName} width={952} fontSize={50} />
        </div>
        <div style={{ margin: '14px 0', display: 'flex', justifyContent: 'center' }}>
          <ArrowDown size={56} color={COLORS.accent} />
        </div>
        <div style={{ display: 'flex', gap: 18 }}>
          {stats.map((s) => (
            <StatBox key={s.label} label={s.label} value={s.value} unit={s.unit} width={statWidth} height={176} maxNumberSize={84} labelSize={26} icon={s.icon} />
          ))}
        </div>
        <span style={{ marginTop: 30, fontSize: 32, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>中身を見る →</span>
      </div>
    </Page>
  );
}

function SectionHead({ num, en, title }: { num: string; en: string; title: string }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
      <SectionLabel num={num} en={en} fontSize={20} />
      <span style={{ fontSize: 32, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{title}</span>
    </div>
  );
}

function Connector(): ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0' }}>
      <ArrowDown size={34} color={COLORS.accent} />
    </div>
  );
}

function Page2({ data }: { data: SiteUiTemplateData }): ReactElement {
  const hasVod = data.streamingWorkCount > 0 && data.services.length > 0;
  const hasProducts = data.productCount > 0;
  const stats = [
    { label: '出演作品', value: data.workCount, unit: '件' },
    ...(hasVod ? [{ label: '配信中', value: data.streamingWorkCount, unit: '件' }] : []),
    ...(hasProducts ? [{ label: '関連商品', value: data.productCount, unit: '件' }] : []),
  ];
  const statWidth = Math.floor((912 - (stats.length - 1) * 16) / stats.length);
  const works = data.works.slice(0, hasVod && hasProducts ? 2 : 3);
  return (
    <Page overlay={<BottomNote text={hasProducts ? '※配信・商品情報は確認時点の情報です' : COMMON_TEXT.vodNote} />}>
      <div style={{ padding: '44px 56px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 60, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{hasProducts ? '作品だけじゃない。' : '名前を入れると、ここまで。'}</span>
        <SiteLogo fontSize={26} />
      </div>
      <div
        style={{
          margin: '24px 56px 0',
          padding: '26px 28px',
          background: COLORS.surface,
          border: `3px solid ${COLORS.ink}`,
          borderRadius: 2,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', gap: 16 }}>
          {stats.map((s) => (
            <StatBox key={s.label} label={s.label} value={s.value} unit={s.unit} width={statWidth} height={112} />
          ))}
        </div>
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SectionHead num="01" en="WORKS" title="出演作品" />
          {works.map((w, i) => (
            <div key={`${i}-${w.title}`} style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <WorkThumb image={w.image} width={70} height={98} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
                <span style={{ fontSize: 30, fontWeight: 700, color: COLORS.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{w.title}</span>
                {w.releaseYear && <span style={{ fontSize: 22, color: COLORS.muted, display: 'flex' }}>{`${w.releaseYear}年`}</span>}
              </div>
            </div>
          ))}
        </div>
        {hasVod && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Connector />
            <SectionHead num="02" en="WATCH NOW" title="配信先" />
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              {data.services.slice(0, 4).map((s) => (
                <ServiceChip key={s.name} name={s.name} fontSize={24} />
              ))}
              {data.serviceCount > 4 && <span style={{ fontSize: 24, fontWeight: 700, color: COLORS.muted, display: 'flex' }}>{`ほか${data.serviceCount - 4}社`}</span>}
            </div>
          </div>
        )}
        {hasProducts && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Connector />
            <SectionHead num="03" en="PICK UP" title="関連商品" />
            <div style={{ marginTop: 10, display: 'flex', gap: 12 }}>
              {data.productSections.map((s) => (
                <div
                  key={s.label}
                  style={{
                    flex: 1,
                    height: 104,
                    border: `2px solid ${COLORS.ink}`,
                    borderRadius: 2,
                    background: COLORS.inkSoft,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '0 14px',
                  }}
                >
                  <ProductIcon kind={s.label} size={44} />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: s.label.length > 4 ? 20 : 24, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{s.label}</span>
                    <span style={{ fontSize: 28, fontWeight: 700, color: COLORS.accent, display: 'flex' }}>{`${s.count}件`}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}

function Page3(): ReactElement {
  return (
    <Page dark>
      <div style={{ flex: 1, padding: '0 90px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <span style={{ fontSize: 100, fontWeight: 700, lineHeight: 1.25, color: COLORS.white, display: 'flex' }}>観るものも。</span>
        <span style={{ fontSize: 100, fontWeight: 700, lineHeight: 1.25, color: COLORS.white, display: 'flex' }}>買うものも。</span>
        <span style={{ fontSize: 100, fontWeight: 700, lineHeight: 1.25, color: COLORS.accent, display: 'flex' }}>推しの名前から。</span>
        <ClosingBrand />
      </div>
    </Page>
  );
}

export function buildNameToEverythingPages(data: SiteUiTemplateData): [ReactElement, ReactElement, ReactElement] {
  return [<Page1 key="1" data={data} />, <Page2 key="2" data={data} />, <Page3 key="3" />];
}
