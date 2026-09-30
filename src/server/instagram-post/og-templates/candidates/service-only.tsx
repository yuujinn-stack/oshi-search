/**
 * テンプレート候補B「○○だけ契約してる人へ」（service-only）。Preview専用。
 * 特定の見放題サービスの利用者に向けて、そのサービスで配信確認できる出演作（最大3件）を見せる。
 * サービスの優劣・おすすめ表現は使わない。対象サービスで確認できる作品が0件なら生成しない（呼び出し側で判定）。
 */
import type { ReactElement } from 'react';
import { BACKGROUNDS, COLORS } from './theme';
import {
  BottomNote,
  BrandLogo,
  CtaBand,
  MarkedText,
  Page,
  SwipeHint,
  WorkThumb,
  fitFontSize,
  thumbSize,
  type CandidateImage,
} from './shared';

export interface ServiceOnlyWork {
  image: CandidateImage;
  releaseYear: number | null;
}

export interface ServiceOnlyData {
  personName: string;
  serviceName: string;
  /** 対象サービスで配信確認できる作品（1〜3件） */
  works: ServiceOnlyWork[];
  /** 対象サービスで配信確認できる作品の総数 */
  total: number;
}

function Page1({ data }: { data: ServiceOnlyData }): ReactElement {
  const serviceSize = fitFontSize(data.serviceName, 820, 130, 64);
  const nameLine = `${data.personName}ファンへ。`;
  return (
    <Page background={BACKGROUNDS.cyan} brand overlay={<SwipeHint />}>
      <div
        style={{
          padding: '26px 60px',
          borderRadius: 36,
          background: COLORS.navy,
          color: COLORS.white,
          fontSize: serviceSize,
          fontWeight: 700,
          boxShadow: '0 18px 40px rgba(16,51,73,0.25)',
          display: 'flex',
        }}
      >
        {data.serviceName}
      </div>
      <span style={{ marginTop: 30, fontSize: 60, fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>だけ契約してる</span>
      <div style={{ marginTop: 10, display: 'flex' }}>
        <MarkedText text={nameLine} fontSize={fitFontSize(nameLine, 940, 80, 48)} markerColor={COLORS.white} />
      </div>
      <div style={{ marginTop: 44, fontSize: 36, fontWeight: 700, color: COLORS.accentDark, display: 'flex' }}>今見られる出演作品をチェック</div>
    </Page>
  );
}

function WorkRow({ work, serviceName, height }: { work: ServiceOnlyWork; serviceName: string; height: number }): ReactElement {
  const size = thumbSize(work.image, height - 40, 200);
  return (
    <div
      style={{
        width: 920,
        height,
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        padding: '0 26px',
        background: COLORS.white,
        borderRadius: 26,
        border: `1.5px solid ${COLORS.cardBorder}`,
        boxShadow: '0 10px 24px rgba(16,51,73,0.10)',
      }}
    >
      <WorkThumb image={work.image} width={size.width} height={size.height} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
        <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.28, color: COLORS.textDark, wordBreak: 'break-word', display: 'block', lineClamp: 2 }}>
          {work.image.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: COLORS.white, background: COLORS.accentDark, borderRadius: 999, padding: '6px 18px', display: 'flex' }}>
            {serviceName}
          </div>
          {work.releaseYear && <span style={{ fontSize: 26, fontWeight: 700, color: COLORS.textMuted, display: 'flex' }}>{`${work.releaseYear}年`}</span>}
        </div>
      </div>
    </div>
  );
}

function Page2({ data }: { data: ServiceOnlyData }): ReactElement {
  const works = data.works.slice(0, 3);
  const rowHeight = ({ 1: 300, 2: 250, 3: 196 } as Record<number, number>)[works.length] ?? 196;
  const line1 = `${data.serviceName}で見られる`;
  const line2 = `${data.personName}出演作`;
  return (
    <Page background={BACKGROUNDS.pale} brand overlay={<BottomNote />} bodyPaddingBottom={76}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <span style={{ fontSize: fitFontSize(line1, 920, 50, 34), fontWeight: 700, color: COLORS.accentDark, display: 'flex' }}>{line1}</span>
        <span style={{ fontSize: fitFontSize(line2, 920, 50, 34), fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>{line2}</span>
      </div>
      <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {works.map((w, i) => (
          <WorkRow key={`${i}-${w.image.title}`} work={w} serviceName={data.serviceName} height={rowHeight} />
        ))}
      </div>
      {data.total > works.length && (
        <div style={{ marginTop: 14, fontSize: 30, fontWeight: 700, color: COLORS.textMuted, display: 'flex' }}>{`ほか${data.total - works.length}作品`}</div>
      )}
    </Page>
  );
}

function Page3({ data }: { data: ServiceOnlyData }): ReactElement {
  const line1 = `${data.personName}の出演作・配信先を`;
  return (
    <Page background={BACKGROUNDS.navy} tone="navy">
      <span style={{ fontSize: 86, fontWeight: 700, color: COLORS.white, display: 'flex' }}>他のサブスクでは？</span>
      <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: fitFontSize(line1, 920, 42, 30), fontWeight: 700, color: COLORS.textOnNavyMuted, display: 'flex' }}>{line1}</span>
        <span style={{ fontSize: 42, fontWeight: 700, color: COLORS.textOnNavyMuted, display: 'flex' }}>まとめて確認</span>
      </div>
      <div style={{ marginTop: 56, display: 'flex' }}>
        <BrandLogo fontSize={76} tone="navy" />
      </div>
      <CtaBand tone="navy" marginTop={54} />
    </Page>
  );
}

export function buildServiceOnlyPages(data: ServiceOnlyData): [ReactElement, ReactElement, ReactElement] {
  return [<Page1 key="1" data={data} />, <Page2 key="2" data={data} />, <Page3 key="3" data={data} />];
}
