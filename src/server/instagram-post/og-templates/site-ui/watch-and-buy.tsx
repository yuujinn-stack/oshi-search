/**
 * H「観るもの・買うもの、まとめて」（watch-and-buy）。Preview専用。
 *
 * 3枚の役割:
 * 1枚目: スクロールを止める（「○○を追うなら」＋大きな「観る」「買う」）
 * 2枚目: 推しサーチで何が分かるかを実データで示す（配信中・配信サービス・作品2件／商品カテゴリ別件数）
 * 3枚目: 推しサーチ人物ページ上部（スマホ表示）を同じ配色・同じ集計値でサーバー側描画して見せ、プロフィールのリンクへ案内する
 *
 * 数字は人物ページと同じ集計（src/server/instagram-post/site-ui/data.ts）を使う（3枚目の画面の数字も同じ集計値）。
 * 商品画像は使わず、カテゴリ名と件数だけで表す。2枚目の作品は配信先がYouTube系だけの作品を除いて選ぶ（呼び出し側）。
 */
import type { ReactElement } from 'react';
import { COLORS } from './theme';
import { Page, ServiceChip, SiteLogo, WorkThumb, estimateTextUnits, fitFontSize } from './shared';
import type { SiteUiTemplateData } from './types';
import { PersonPageScreen } from './person-page-screen';

/** 1枚目「買う」の説明に使う、実データにある商品カテゴリだけの一覧（例: 写真集・CD・Blu-ray/DVD・グッズ） */
function buyLine(data: SiteUiTemplateData): string {
  return data.productSections
    .map((s) => (s.label === '写真集・書籍' ? '写真集' : s.label === 'Blu-ray・DVD' ? 'Blu-ray/DVD' : s.label))
    .join('・');
}

// ─── 1枚目：スクロールを止める ─────────────────────────────────────────────────
function Page1({ data }: { data: SiteUiTemplateData }): ReactElement {
  const lead = `${data.personName}を追うなら`;
  const buy = buyLine(data);
  return (
    <Page>
      <div style={{ padding: '44px 64px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: fitFontSize(lead, 720, 64, 40), fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{lead}</span>
        <SiteLogo fontSize={24} />
      </div>
      <div style={{ flex: 1, padding: '24px 64px 0', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ flex: 1, background: COLORS.surface, border: `4px solid ${COLORS.ink}`, borderRadius: 2, display: 'flex', alignItems: 'center', padding: '0 40px', gap: 30 }}>
          <span style={{ fontSize: 180, fontWeight: 700, lineHeight: 1, color: COLORS.ink, display: 'flex', flexShrink: 0 }}>観る</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 50, fontWeight: 700, color: COLORS.ink, whiteSpace: 'nowrap', display: 'flex' }}>今 観るもの。</span>
            <span style={{ fontSize: 30, fontWeight: 700, color: COLORS.muted, whiteSpace: 'nowrap', display: 'flex' }}>出演作品・配信先</span>
          </div>
        </div>
        <div style={{ flex: 1, background: COLORS.ink, border: `4px solid ${COLORS.ink}`, borderRadius: 2, display: 'flex', alignItems: 'center', padding: '0 40px', gap: 30 }}>
          <span style={{ fontSize: 180, fontWeight: 700, lineHeight: 1, color: COLORS.accent, display: 'flex', flexShrink: 0 }}>買う</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontSize: 50, fontWeight: 700, color: COLORS.white, whiteSpace: 'nowrap', display: 'flex' }}>今 買えるもの。</span>
            <span style={{ fontSize: fitFontSize(buy, 470, 30, 22), fontWeight: 700, color: COLORS.onInkMuted, whiteSpace: 'nowrap', display: 'flex' }}>{buy}</span>
          </div>
        </div>
      </div>
      {/* 下部の補助要素は2つだけ（①「名前を入れるだけで、」＋一文 ②続きへの誘導） */}
      <div style={{ padding: '22px 64px 38px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 32, fontWeight: 700, color: COLORS.muted, display: 'flex' }}>名前を入れるだけで、</span>
          <span style={{ fontSize: 38, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>作品も、配信先も、推し活商品も。</span>
        </div>
        <span style={{ fontSize: 32, fontWeight: 700, color: COLORS.accent, whiteSpace: 'nowrap', display: 'flex' }}>続きで一覧を見る →</span>
      </div>
    </Page>
  );
}

// ─── 2枚目：実データで証明 ─────────────────────────────────────────────────────
function BigNumber({ label, value, unit }: { label: string; value: number; unit: string }): ReactElement {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 24, fontWeight: 700, color: COLORS.muted, display: 'flex' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 76, fontWeight: 700, lineHeight: 1, color: COLORS.ink, display: 'flex' }}>{value}</span>
        <span style={{ fontSize: 28, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{unit}</span>
      </div>
    </div>
  );
}

function Page2({ data }: { data: SiteUiTemplateData }): ReactElement {
  const colWidth = 468;
  const inner = colWidth - 48;
  return (
    <Page
      overlay={
        <div style={{ position: 'absolute', left: 56, right: 56, bottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 22, color: COLORS.muted, display: 'flex' }}>※配信・商品情報は確認時点の情報です</span>
          <SiteLogo fontSize={24} />
        </div>
      }
    >
      <div style={{ padding: '40px 56px 0', display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 50, fontWeight: 700, lineHeight: 1.2, color: COLORS.ink, display: 'flex' }}>名前ひとつで、</span>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span style={{ fontSize: 70, fontWeight: 700, lineHeight: 1.2, color: COLORS.ink, display: 'flex' }}>観るものも。</span>
          <span style={{ fontSize: 70, fontWeight: 700, lineHeight: 1.2, color: COLORS.accent, display: 'flex' }}>買うものも。</span>
        </div>
      </div>
      <div style={{ flex: 1, padding: '26px 56px 70px', display: 'flex', gap: 32 }}>
        {/* 観る（黒） */}
        <div style={{ width: colWidth, background: COLORS.surface, border: `4px solid ${COLORS.ink}`, borderRadius: 2, display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 96, padding: '0 24px', background: COLORS.ink, display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 60, fontWeight: 700, color: COLORS.white, display: 'flex' }}>観る</span>
          </div>
          <div style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-around' }}>
            <div style={{ display: 'flex', gap: 12, paddingBottom: 16, borderBottom: `2px solid ${COLORS.border}` }}>
              <BigNumber label="配信中" value={data.streamingWorkCount} unit="件" />
              <BigNumber label="配信サービス" value={data.serviceCount} unit="社" />
            </div>
            {data.works.slice(0, 2).map((w, i) => {
              const services = estimateTextUnits(w.services.join('')) > 12 ? w.services.slice(0, 1) : w.services.slice(0, 2);
              return (
                <div key={`${i}-${w.title}`} style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  <WorkThumb image={w.image} width={110} height={154} />
                  <div style={{ width: inner - 110 - 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.25, color: COLORS.ink, wordBreak: 'break-word', display: 'block', lineClamp: 2 }}>{w.title}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {services.map((s) => (
                        <ServiceChip key={s} name={s} fontSize={fitFontSize(s, 260, 22, 16)} />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* 買う（オレンジ） */}
        <div style={{ width: colWidth, background: COLORS.surface, border: `4px solid ${COLORS.accent}`, borderRadius: 2, display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: 96, padding: '0 24px', background: COLORS.accent, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 60, fontWeight: 700, color: COLORS.white, display: 'flex' }}>買う</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: COLORS.white, display: 'flex' }}>関連商品</span>
              <span style={{ fontSize: 44, fontWeight: 700, color: COLORS.white, display: 'flex' }}>{data.productCount}</span>
              <span style={{ fontSize: 24, fontWeight: 700, color: COLORS.white, display: 'flex' }}>件</span>
            </div>
          </div>
          <div style={{ flex: 1, padding: '8px 24px', display: 'flex', flexDirection: 'column' }}>
            {data.productSections.map((s, i) => (
              <div key={s.label} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: i === 0 ? '0px solid transparent' : `2px solid ${COLORS.border}` }}>
                <span style={{ fontSize: 32, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{s.label}</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span style={{ fontSize: 64, fontWeight: 700, lineHeight: 1, color: COLORS.accent, display: 'flex' }}>{s.count}</span>
                  <span style={{ fontSize: 28, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>件</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Page>
  );
}

// ─── 3枚目：推しサーチ人物ページ画面＋プロフィールへの案内 ─────────────────────────
function Page3({ data }: { data: SiteUiTemplateData }): ReactElement {
  // 人物ページ上部（スマホ表示）を同じ配色・同じ集計値でサーバー側描画した画面（person-page-screen.tsx）
  const scale = 500 / 390;
  return (
    <Page>
      <div style={{ padding: '44px 64px 0', display: 'flex' }}>
        <SiteLogo fontSize={26} />
      </div>
      <div style={{ padding: '26px 64px 0', display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 80, fontWeight: 700, lineHeight: 1.18, color: COLORS.ink, display: 'flex' }}>推しの名前から、</span>
        <span style={{ fontSize: 80, fontWeight: 700, lineHeight: 1.18, color: COLORS.accent, display: 'flex' }}>まとめて探せます。</span>
      </div>
      <div style={{ position: 'absolute', left: 64, top: 330, width: 360, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.4, color: COLORS.muted, display: 'flex' }}>出演作品・配信先・</span>
        <span style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.4, color: COLORS.muted, display: 'flex' }}>関連商品を</span>
        <span style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.4, color: COLORS.muted, display: 'flex' }}>ひとつのページで。</span>
      </div>
      {/* 最下部：Instagram上では押せない前提の案内文（ボタンにしない） */}
      <div style={{ position: 'absolute', left: 64, bottom: 48, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span style={{ fontSize: 38, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>プロフィールのリンクから</span>
          <span style={{ fontSize: 44, fontWeight: 700, color: COLORS.accent, display: 'flex' }}>『推しサーチ』へ</span>
        </div>
        <div style={{ width: 800, height: 4, background: COLORS.accent, display: 'flex' }} />
      </div>
      {/* 右：推しサーチ人物ページ（スマホ表示）をスマホ画面風の枠に */}
      <div style={{ position: 'absolute', right: 56, top: 310, padding: 14, background: COLORS.ink, borderRadius: 50, boxShadow: '0 26px 50px rgba(10,10,10,0.22)', display: 'flex' }}>
        <div style={{ borderRadius: 38, overflow: 'hidden', display: 'flex' }}>
          <PersonPageScreen
            scale={scale}
            data={{
              personName: data.personName,
              genre: data.genre,
              group: data.group,
              streamingWorkCount: data.streamingWorkCount,
              workCount: data.workCount,
              productCount: data.productCount,
              serviceCount: data.serviceCount,
            }}
          />
        </div>
      </div>
    </Page>
  );
}

export function buildWatchAndBuyPages(data: SiteUiTemplateData): [ReactElement, ReactElement, ReactElement] {
  return [<Page1 key="1" data={data} />, <Page2 key="2" data={data} />, <Page3 key="3" data={data} />];
}
