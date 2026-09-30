/**
 * テンプレート候補D「推しの現在地」データカード（oshi-status）。Preview専用。
 * 推しサーチに登録・確認済みのデータから、取得できる数字だけ（2〜4項目）をカードで見せる。
 * ランキング化・他人物との比較はしない。
 */
import type { ReactElement } from 'react';
import { BACKGROUNDS, COLORS } from './theme';
import { BottomNote, BrandLogo, CtaBand, MarkedText, Page, SwipeHint, fitFontSize } from './shared';

export interface OshiStatusStat {
  label: string;
  value: number;
  unit: string;
}

export interface OshiStatusData {
  personName: string;
  /** 例: 「2026年9月時点」 */
  dateLabel: string;
  /** 2〜4項目 */
  stats: OshiStatusStat[];
  /** 配信確認できたサービス名（最大4件、多い順） */
  topServices: string[];
  serviceTotal: number;
}

function Page1({ data }: { data: OshiStatusData }): ReactElement {
  const nameSize = fitFontSize(data.personName, 760, 110, 56);
  return (
    <Page background={BACKGROUNDS.cyan} brand overlay={<SwipeHint />}>
      <div
        style={{
          width: 880,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          background: COLORS.white,
          borderRadius: 40,
          boxShadow: '0 24px 50px rgba(16,51,73,0.18)',
          overflow: 'hidden',
        }}
      >
        <div style={{ width: '100%', padding: '22px 0', background: COLORS.navy, display: 'flex', justifyContent: 'center', gap: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 36, fontWeight: 700, color: COLORS.white, letterSpacing: 4, display: 'flex' }}>推しの現在地</span>
        </div>
        <div style={{ padding: '46px 40px 50px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <MarkedText text={data.personName} fontSize={nameSize} markerColor={COLORS.accentSoft} />
          <span style={{ marginTop: 22, fontSize: 52, fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>今どれくらい見られる？</span>
          <div style={{ marginTop: 30, padding: '10px 28px', borderRadius: 999, background: COLORS.accentSoft, color: COLORS.accentDark, fontSize: 32, fontWeight: 700, display: 'flex' }}>
            {data.dateLabel}
          </div>
        </div>
      </div>
    </Page>
  );
}

function StatCard({ stat, width }: { stat: OshiStatusStat; width: number }): ReactElement {
  // 数字＋単位がカード幅に収まるよう、桁数に応じて数字の文字サイズを決める（最大120px）
  const unitSize = 32;
  const numberWidth = width - 44 - stat.unit.length * unitSize - 8;
  const numberSize = Math.min(120, Math.floor(numberWidth / (String(stat.value).length * 0.6)));
  return (
    <div
      style={{
        width,
        height: 300,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        background: COLORS.white,
        borderRadius: 30,
        boxShadow: '0 14px 30px rgba(0,0,0,0.20)',
      }}
    >
      <span style={{ fontSize: 34, fontWeight: 700, color: COLORS.textMuted, display: 'flex' }}>{stat.label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: numberSize, fontWeight: 700, lineHeight: 1, color: COLORS.accentDark, display: 'flex' }}>{stat.value}</span>
        <span style={{ fontSize: unitSize, fontWeight: 700, color: COLORS.accentDark, display: 'flex' }}>{stat.unit}</span>
      </div>
    </div>
  );
}

function Page2({ data }: { data: OshiStatusData }): ReactElement {
  const stats = data.stats.slice(0, 4);
  const columns = stats.length === 4 ? 2 : stats.length;
  const cardWidth = columns === 3 ? 290 : 440;
  const heading = `${data.personName}の現在地`;
  return (
    <Page background={BACKGROUNDS.navy} tone="navy" brand overlay={<BottomNote tone="navy" text="※推しサーチに登録・確認済みのデータ（配信情報は確認時点）" />}>
      <span style={{ fontSize: fitFontSize(heading, 940, 56, 36), fontWeight: 700, color: COLORS.white, display: 'flex' }}>{heading}</span>
      <span style={{ marginTop: 6, fontSize: 30, fontWeight: 700, color: COLORS.textOnNavyMuted, display: 'flex' }}>{data.dateLabel}</span>
      <div style={{ marginTop: 34, width: columns * cardWidth + (columns - 1) * 24, display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'center' }}>
        {stats.map((s) => (
          <StatCard key={s.label} stat={s} width={cardWidth} />
        ))}
      </div>
      {data.topServices.length > 0 && (
        <div style={{ marginTop: 30, maxWidth: 940, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 10 }}>
          {data.topServices.map((s) => (
            <div key={s} style={{ fontSize: 28, fontWeight: 700, color: COLORS.navy, background: COLORS.accentSoft, borderRadius: 999, padding: '6px 20px', display: 'flex' }}>
              {s}
            </div>
          ))}
          {data.serviceTotal > data.topServices.length && (
            <span style={{ fontSize: 28, fontWeight: 700, color: COLORS.textOnNavyMuted, display: 'flex' }}>{`ほか${data.serviceTotal - data.topServices.length}`}</span>
          )}
        </div>
      )}
    </Page>
  );
}

function Page3(): ReactElement {
  return (
    <Page background={BACKGROUNDS.cyan}>
      <span style={{ fontSize: 80, fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>気になったら</span>
      <div style={{ marginTop: 8, display: 'flex' }}>
        <MarkedText text="名前からチェック" fontSize={80} markerColor={COLORS.white} />
      </div>
      <div style={{ marginTop: 64, display: 'flex' }}>
        <BrandLogo fontSize={80} />
      </div>
      <CtaBand marginTop={56} />
    </Page>
  );
}

export function buildOshiStatusPages(data: OshiStatusData): [ReactElement, ReactElement, ReactElement] {
  return [<Page1 key="1" data={data} />, <Page2 key="2" data={data} />, <Page3 key="3" />];
}
