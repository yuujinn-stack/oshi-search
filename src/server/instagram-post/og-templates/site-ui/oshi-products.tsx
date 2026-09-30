/**
 * I「○○の商品、どこまで知ってる？」（oshi-products）。Preview専用。
 * 推しサーチの人物ページに掲載している関連商品を、写真集・書籍／CD／Blu-ray・DVD／グッズに分けて見せる。
 * 関連商品が1件以上ある人物だけ生成する（呼び出し側で判定）。商品画像は使わず、カテゴリのアイコン＋実際の商品名で表す。
 */
import type { ReactElement } from 'react';
import { COLORS, COMMON_TEXT } from './theme';
import { BottomNote, ClosingBrand, Page, ProductIcon, SiteLogo, TopBar, fitFontSize } from './shared';
import type { SiteUiTemplateData } from './types';

function Page1({ data }: { data: SiteUiTemplateData }): ReactElement {
  const line1 = `${data.personName}の商品、`;
  const sections = data.productSections.slice(0, 4);
  const tileWidth = sections.length >= 3 ? 460 : 940 / Math.max(sections.length, 1) - (sections.length > 1 ? 10 : 0);
  return (
    <Page>
      <TopBar />
      <div style={{ flex: 1, padding: '0 70px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <span style={{ fontSize: fitFontSize(line1, 940, 96, 56), fontWeight: 700, lineHeight: 1.25, color: COLORS.ink, display: 'flex' }}>{line1}</span>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span style={{ fontSize: 96, fontWeight: 700, lineHeight: 1.25, color: COLORS.accent, display: 'flex' }}>どこまで</span>
          <span style={{ fontSize: 96, fontWeight: 700, lineHeight: 1.25, color: COLORS.ink, display: 'flex' }}>知ってる？</span>
        </div>
        <div style={{ marginTop: 50, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          {sections.map((s) => (
            <div
              key={s.label}
              style={{
                width: tileWidth,
                height: 150,
                background: COLORS.surface,
                border: `3px solid ${COLORS.ink}`,
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 22,
                padding: '0 28px',
              }}
            >
              <ProductIcon kind={s.label} size={78} />
              <span style={{ flex: 1, fontSize: fitFontSize(s.label, tileWidth - 220, 36, 24), fontWeight: 700, color: COLORS.ink, whiteSpace: 'nowrap', display: 'flex' }}>{s.label}</span>
              <span style={{ fontSize: 60, fontWeight: 700, color: COLORS.accent, display: 'flex' }}>？</span>
            </div>
          ))}
        </div>
      </div>
    </Page>
  );
}

function Page2({ data }: { data: SiteUiTemplateData }): ReactElement {
  const sections = data.productSections.slice(0, 4);
  const titlesPerSection = sections.length >= 4 ? 2 : 3;
  const heading = `${data.personName}の関連商品`;
  return (
    <Page overlay={<BottomNote text={COMMON_TEXT.productNote} />}>
      <div style={{ padding: '44px 56px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: fitFontSize(heading, 720, 52, 34), fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{heading}</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 26, fontWeight: 700, color: COLORS.muted, display: 'flex' }}>推しサーチに掲載中</span>
            <span style={{ fontSize: 40, fontWeight: 700, color: COLORS.accent, display: 'flex' }}>{data.productCount}</span>
            <span style={{ fontSize: 26, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>件</span>
          </div>
        </div>
        <SiteLogo fontSize={26} />
      </div>
      <div style={{ flex: 1, padding: '24px 56px 70px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
        {sections.map((s) => (
          <div
            key={s.label}
            style={{
              background: COLORS.surface,
              border: `3px solid ${COLORS.ink}`,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'stretch',
            }}
          >
            <div style={{ width: 150, background: COLORS.accentSoft, borderRight: `3px solid ${COLORS.ink}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 0 }}>
              <ProductIcon kind={s.label} size={62} />
              <span style={{ fontSize: 30, fontWeight: 700, color: COLORS.accent, display: 'flex' }}>{`${s.count}件`}</span>
            </div>
            <div style={{ flex: 1, padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
              <span style={{ fontSize: 32, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{s.label}</span>
              {s.titles.slice(0, titlesPerSection).map((t, i) => (
                <span
                  key={`${i}-${t}`}
                  style={{ fontSize: 24, fontWeight: 700, color: COLORS.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}
                >
                  {`・${t}`}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}

function Page3(): ReactElement {
  return (
    <Page dark>
      <div style={{ flex: 1, padding: '0 90px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <span style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.25, color: COLORS.white, display: 'flex' }}>作品だけじゃない。</span>
        <span style={{ marginTop: 10, fontSize: 88, fontWeight: 700, lineHeight: 1.25, color: COLORS.accent, display: 'flex' }}>推しの商品も</span>
        <span style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.25, color: COLORS.white, display: 'flex' }}>名前から探せます。</span>
        <ClosingBrand />
      </div>
    </Page>
  );
}

export function buildOshiProductsPages(data: SiteUiTemplateData): [ReactElement, ReactElement, ReactElement] {
  return [<Page1 key="1" data={data} />, <Page2 key="2" data={data} />, <Page3 key="3" />];
}
