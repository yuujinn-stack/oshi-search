/**
 * G「推し活、検索しすぎ問題」（search-too-much）。Preview専用。
 * 1枚目で推し活中の検索履歴を見せて共感を取り、2枚目で「人物名を1回検索」から
 * 出演作品・配信先・関連商品へ分岐する様子を、推しサーチの検索窓・統計ボックスと同じ見た目で見せる。
 * 特定の検索サービス（Google等）の画面は模さない。データが無い分岐は表示しない。
 */
import type { ReactElement } from 'react';
import { COLORS, COMMON_TEXT } from './theme';
import {
  BottomNote,
  ClockIcon,
  ClosingBrand,
  Page,
  ProductIcon,
  SearchBar,
  SectionLabel,
  ServiceChip,
  SiteLogo,
  WorkThumb,
  fitFontSize,
} from './shared';
import type { SiteUiTemplateData } from './types';

/**
 * 1枚目: 検索窓が何枚も重なっていく様子で「検索しすぎて面倒」を見せる。
 * 特定の検索サービスの画面は模さず、推しサーチと同じ汎用の検索窓の見た目を使う。
 */
function Page1({ data }: { data: SiteUiTemplateData }): ReactElement {
  const queries = [
    `${data.personName} 何に出てた？`,
    `${data.sampleWorkTitle ?? data.personName} どこで見れる？`,
    `${data.personName} 写真集 ある？`,
    `${data.personName} 商品 どこ？`,
  ];
  const barWidth = 700;
  const step = 32;
  return (
    <Page>
      <div style={{ padding: '40px 64px 0', display: 'flex' }}>
        <SiteLogo fontSize={26} />
      </div>
      <div style={{ flex: 1, padding: '0 64px 40px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <span style={{ fontSize: 100, fontWeight: 700, lineHeight: 1.18, color: COLORS.ink, display: 'flex' }}>推し活、</span>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span style={{ fontSize: 100, fontWeight: 700, lineHeight: 1.18, color: COLORS.accent, display: 'flex' }}>検索しすぎ</span>
          <span style={{ fontSize: 100, fontWeight: 700, lineHeight: 1.18, color: COLORS.ink, display: 'flex' }}>問題。</span>
        </div>
        {/* 重なっていく検索窓（後ろほど薄く、最後の1枚をオレンジ枠で強調） */}
        <div style={{ position: 'relative', marginTop: 44, height: 4 * 104 + 3 * 10, display: 'flex' }}>
          {queries.map((q, i) => {
            const last = i === queries.length - 1;
            return (
              <div
                key={q}
                style={{
                  position: 'absolute',
                  left: i * step,
                  top: i * 114,
                  width: barWidth,
                  height: 96,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '0 22px',
                  background: COLORS.surface,
                  border: `${last ? 5 : 3}px solid ${last ? COLORS.accent : COLORS.ink}`,
                  borderRadius: 2,
                  opacity: last ? 1 : 0.55 + i * 0.12,
                  boxShadow: '0 8px 0 rgba(10,10,10,0.12)',
                }}
              >
                <span style={{ fontSize: 22, fontWeight: 700, color: last ? COLORS.accent : COLORS.muted, whiteSpace: 'nowrap', display: 'flex', flexShrink: 0 }}>{`${i + 1}回目`}</span>
                <span
                  style={{
                    flex: 1,
                    fontSize: fitFontSize(q, barWidth - 230, 38, 26),
                    fontWeight: 700,
                    color: COLORS.ink,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'block',
                  }}
                >
                  {q}
                </span>
                <div style={{ padding: '10px 18px', background: COLORS.ink, color: COLORS.white, fontSize: 24, fontWeight: 700, display: 'flex' }}>検索</div>
              </div>
            );
          })}
          <div
            style={{
              position: 'absolute',
              right: -6,
              top: 140,
              width: 176,
              height: 176,
              borderRadius: '50%',
              background: COLORS.accent,
              color: COLORS.white,
              transform: 'rotate(-12deg)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 10px 20px rgba(10,10,10,0.18)',
            }}
          >
            <span style={{ fontSize: 34, fontWeight: 700, display: 'flex' }}>まだ</span>
            <span style={{ fontSize: 40, fontWeight: 700, display: 'flex' }}>検索…</span>
          </div>
        </div>
      </div>
    </Page>
  );
}

/** 2枚目の分岐の列幅（分岐数で決まる。本文の列幅計算と同じ値） */
function colWidthFor(data: SiteUiTemplateData): number {
  const n = 1 + (data.streamingWorkCount > 0 && data.services.length > 0 ? 1 : 0) + (data.productCount > 0 ? 1 : 0);
  return n === 3 ? 296 : n === 2 ? 444 : 600;
}

interface Branch {
  num: string;
  en: string;
  title: string;
  value: number;
  unit: string;
  body: ReactElement;
}

function Page2({ data }: { data: SiteUiTemplateData }): ReactElement {
  const branches: Branch[] = [
    {
      num: '01',
      en: 'WORKS',
      title: '出演作品',
      value: data.workCount,
      unit: '件',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            {data.works.slice(0, 2).map((w, i) => (
              <WorkThumb key={`${i}-${w.title}`} image={w.image} width={120} height={168} />
            ))}
          </div>
          {data.works[0] && (
            <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3, color: COLORS.ink, wordBreak: 'break-word', display: 'block', lineClamp: 2 }}>{data.works[0].title}</span>
          )}
        </div>
      ),
    },
  ];
  if (data.streamingWorkCount > 0 && data.services.length > 0) {
    branches.push({
      num: '02',
      en: 'WATCH NOW',
      title: '配信先',
      value: data.serviceCount,
      unit: '社',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          {data.services.slice(0, 5).map((s) => (
            // 長いサービス名（例: Prime Video内の各チャンネル）が列からはみ出さないよう列幅に合わせて縮める
            <ServiceChip key={s.name} name={s.name} fontSize={fitFontSize(s.name, colWidthFor(data) - 80, 24, 14)} />
          ))}
        </div>
      ),
    });
  }
  if (data.productCount > 0) {
    branches.push({
      num: String(branches.length + 1).padStart(2, '0'),
      en: 'PICK UP',
      title: '関連商品',
      value: data.productCount,
      unit: '件',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.productSections.slice(0, 4).map((s) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ProductIcon kind={s.label} size={36} />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{s.label}</span>
                <span style={{ fontSize: 22, fontWeight: 700, color: COLORS.accent, display: 'flex' }}>{`${s.count}件`}</span>
              </div>
            </div>
          ))}
        </div>
      ),
    });
  }
  const n = branches.length;
  const colWidth = colWidthFor(data);
  const gap = 22;
  const rowWidth = n * colWidth + (n - 1) * gap;
  return (
    <Page overlay={<BottomNote text={data.productCount > 0 ? '※配信・商品情報は確認時点の情報です' : COMMON_TEXT.vodNote} />}>
      <div style={{ padding: '44px 56px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 56, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>人物名を</span>
          <span style={{ fontSize: 56, fontWeight: 700, color: COLORS.accent, display: 'flex' }}>1回</span>
          <span style={{ fontSize: 56, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>検索</span>
        </div>
        {/* 1枚目の「4回検索」との対比（Before → After） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', background: COLORS.ink, borderRadius: 2 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: COLORS.onInkMuted, textDecoration: 'line-through', display: 'flex' }}>検索4回</span>
          <span style={{ fontSize: 28, fontWeight: 700, color: COLORS.white, display: 'flex' }}>→</span>
          <span style={{ fontSize: 34, fontWeight: 700, color: COLORS.accent, display: 'flex' }}>1回</span>
        </div>
      </div>
      <div style={{ marginTop: 26, display: 'flex', justifyContent: 'center' }}>
        <SearchBar text={data.personName} width={968} fontSize={42} />
      </div>
      {/* 検索窓から各分岐へ伸びる線 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 4, height: 30, background: COLORS.ink, display: 'flex' }} />
        {n > 1 && <div style={{ width: rowWidth - colWidth + 4, height: 4, background: COLORS.ink, display: 'flex' }} />}
        <div style={{ width: rowWidth, display: 'flex', justifyContent: 'space-between', padding: `0 ${colWidth / 2 - 2}px` }}>
          {branches.map((b) => (
            <div key={b.title} style={{ width: 4, height: 26, background: COLORS.ink, display: 'flex' }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap }}>
        {branches.map((b) => (
          <div
            key={b.title}
            style={{
              width: colWidth,
              height: 560,
              padding: '22px 22px',
              background: COLORS.surface,
              border: `3px solid ${COLORS.ink}`,
              borderRadius: 2,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <SectionLabel num={b.num} en={b.en} fontSize={18} />
            <span style={{ fontSize: 34, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{b.title}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, paddingBottom: 12, borderBottom: `2px solid ${COLORS.border}` }}>
              <span style={{ fontSize: 64, fontWeight: 700, lineHeight: 1, color: COLORS.accent, display: 'flex' }}>{b.value}</span>
              <span style={{ fontSize: 28, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{b.unit}</span>
            </div>
            <div style={{ marginTop: 6, display: 'flex' }}>{b.body}</div>
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
        <span style={{ fontSize: 92, fontWeight: 700, lineHeight: 1.25, color: COLORS.white, display: 'flex' }}>その検索、</span>
        <span style={{ fontSize: 92, fontWeight: 700, lineHeight: 1.25, color: COLORS.accent, display: 'flex' }}>推しの名前から</span>
        <span style={{ fontSize: 92, fontWeight: 700, lineHeight: 1.25, color: COLORS.white, display: 'flex' }}>まとめられます。</span>
        <ClosingBrand />
      </div>
    </Page>
  );
}

export function buildSearchTooMuchPages(data: SiteUiTemplateData): [ReactElement, ReactElement, ReactElement] {
  return [<Page1 key="1" data={data} />, <Page2 key="2" data={data} />, <Page3 key="3" />];
}
