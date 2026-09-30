/**
 * テンプレート候補C「この推し、サブスク何個必要？」（subscription-count）。Preview専用。
 * 見放題サービスごとに、配信確認できる出演作の数を実データから集計して見せる。
 * 「おすすめ」表現は使わず、単純な現在の配信確認数として扱う。
 */
import type { ReactElement } from 'react';
import { BACKGROUNDS, COLORS } from './theme';
import { BottomNote, BrandLogo, CtaBand, MarkedText, Page, SwipeHint, fitFontSize } from './shared';

export interface SubscriptionCountData {
  personName: string;
  /** 見放題サービス別の作品数（多い順、1件以上） */
  services: { name: string; count: number }[];
}

const MAX_SERVICES_SHOWN = 6;

function Page1({ data }: { data: SubscriptionCountData }): ReactElement {
  const line1 = `${data.personName}を追うなら`;
  return (
    <Page background={BACKGROUNDS.navy} tone="navy" brand overlay={<SwipeHint tone="navy" />}>
      <span style={{ fontSize: fitFontSize(line1, 940, 64, 42), fontWeight: 700, color: COLORS.white, display: 'flex' }}>{line1}</span>
      <span style={{ marginTop: 8, fontSize: 76, fontWeight: 700, color: COLORS.white, display: 'flex' }}>サブスク何個必要？</span>
      <div style={{ marginTop: 40, display: 'flex', alignItems: 'flex-end', gap: 0 }}>
        <span style={{ fontSize: 280, fontWeight: 700, lineHeight: 1, color: COLORS.accent, display: 'flex', marginRight: -40 }}>？</span>
        <span style={{ fontSize: 76, fontWeight: 700, color: COLORS.white, display: 'flex' }}>サービス</span>
      </div>
    </Page>
  );
}

function ServiceCard({ name, count, width }: { name: string; count: number; width: number }): ReactElement {
  return (
    <div
      style={{
        width,
        height: 170,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 6,
        padding: '0 30px',
        background: COLORS.white,
        borderRadius: 26,
        border: `1.5px solid ${COLORS.cardBorder}`,
        boxShadow: '0 10px 24px rgba(16,51,73,0.10)',
      }}
    >
      <span style={{ fontSize: fitFontSize(name, width - 60, 38, 24), fontWeight: 700, color: COLORS.textDark, display: 'flex', whiteSpace: 'nowrap' }}>{name}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 76, fontWeight: 700, lineHeight: 1, color: COLORS.accentDark, display: 'flex' }}>{count}</span>
        <span style={{ fontSize: 32, fontWeight: 700, color: COLORS.accentDark, display: 'flex' }}>作品</span>
      </div>
    </div>
  );
}

function Page2({ data }: { data: SubscriptionCountData }): ReactElement {
  const shown = data.services.slice(0, MAX_SERVICES_SHOWN);
  const twoColumns = shown.length > 3;
  const cardWidth = twoColumns ? 450 : 760;
  const heading = `${data.personName}の出演作が見られるサブスク`;
  return (
    <Page background={BACKGROUNDS.pale} brand overlay={<BottomNote />} bodyPaddingBottom={70}>
      <span style={{ fontSize: fitFontSize(heading, 960, 46, 30), fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>{heading}</span>
      <span style={{ marginTop: 6, fontSize: 28, fontWeight: 700, color: COLORS.textMuted, display: 'flex' }}>見放題で配信確認できた作品数</span>
      <div style={{ marginTop: 28, width: twoColumns ? 920 : cardWidth, display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center' }}>
        {shown.map((s) => (
          <ServiceCard key={s.name} name={s.name} count={s.count} width={cardWidth} />
        ))}
      </div>
      {data.services.length > shown.length && (
        <div style={{ marginTop: 18, fontSize: 30, fontWeight: 700, color: COLORS.textMuted, display: 'flex' }}>{`ほか${data.services.length - shown.length}サービス`}</div>
      )}
    </Page>
  );
}

function Page3({ data }: { data: SubscriptionCountData }): ReactElement {
  const sub = `${data.personName}の配信先をまとめてチェック`;
  return (
    <Page background={BACKGROUNDS.cyan} overlay={<BottomNote />}>
      <span style={{ fontSize: 54, fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>現在確認できたのは</span>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span style={{ fontSize: 210, fontWeight: 700, lineHeight: 1.05, color: COLORS.accentDark, display: 'flex' }}>{data.services.length}</span>
        <MarkedText text="サービス" fontSize={80} markerColor={COLORS.white} />
      </div>
      <span style={{ marginTop: 22, fontSize: fitFontSize(sub, 940, 38, 28), fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>{sub}</span>
      <div style={{ marginTop: 44, display: 'flex' }}>
        <BrandLogo fontSize={70} />
      </div>
      <CtaBand marginTop={40} />
    </Page>
  );
}

export function buildSubscriptionCountPages(data: SubscriptionCountData): [ReactElement, ReactElement, ReactElement] {
  return [<Page1 key="1" data={data} />, <Page2 key="2" data={data} />, <Page3 key="3" data={data} />];
}
