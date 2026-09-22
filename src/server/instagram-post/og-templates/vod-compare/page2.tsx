/**
 * vod-compareテンプレート 2枚目: 配信サービスごとの作品数比較（実データ）。
 * 0作品のサービスはVodCountEntry配列に含めない前提（呼び出し側で集計済みのものを渡す）。
 * バーの幅はCSSのパーセント指定に頼らず、この時点でpx単位まで計算してから描画する
 * （Satori上での挙動を確実にするため）。
 */
import type { ReactElement } from 'react';
import { CANVAS, COLORS, FONT_FAMILY, PAGE2 } from './theme';
import { BrandLabel, Decorations } from './shared';

export interface VodCountEntry {
  providerName: string;
  count: number;
}

export interface VodComparePage2Data {
  personName: string;
  counts: VodCountEntry[];
}

export function buildVodComparePage2Element(data: VodComparePage2Data): ReactElement {
  const { panel, row } = PAGE2;
  const trackWidth = panel.width - panel.paddingX * 2;
  const maxCount = Math.max(...data.counts.map((c) => c.count), 1);

  return (
    <div
      style={{
        position: 'relative',
        width: CANVAS.width,
        height: CANVAS.height,
        background: COLORS.background,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: FONT_FAMILY,
      }}
    >
      <Decorations circles={[...PAGE2.decorations.circles]} dots={[...PAGE2.decorations.dots]} />
      <BrandLabel marginTop={PAGE2.brandLabelMarginTop} />
      <div
        style={{
          marginTop: PAGE2.title.marginTop,
          textAlign: 'center',
          fontSize: PAGE2.title.fontSize,
          fontWeight: 700,
          color: COLORS.textDark,
          display: 'flex',
        }}
      >
        {PAGE2.buildTitle(data.personName)}
      </div>

      {/* サービス数（行数）はデータに応じて変動するため、残りの縦スペースの中でパネルを
          中央に配置する。行数が少ない人物でも下部が大きく空きすぎないようにするため。 */}
      <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            position: 'relative',
            width: panel.width,
            background: COLORS.panelBackground,
            border: `${panel.borderWidth}px solid ${COLORS.panelBorder}`,
            borderRadius: panel.borderRadius,
            padding: `${panel.paddingY}px ${panel.paddingX}px`,
            display: 'flex',
            flexDirection: 'column',
            gap: row.gap,
            boxShadow: panel.boxShadow,
          }}
        >
          {data.counts.map((entry) => {
            const barWidth = Math.max(Math.round((entry.count / maxCount) * trackWidth), row.minBarWidth);
            return (
              <div key={entry.providerName} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: row.labelFontSize, fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>
                    {entry.providerName}
                  </span>
                  <span style={{ fontSize: row.countFontSize, fontWeight: 700, color: COLORS.accentDark, display: 'flex' }}>
                    {entry.count}作品
                  </span>
                </div>
                <div
                  style={{
                    width: trackWidth,
                    height: row.barHeight,
                    borderRadius: row.barRadius,
                    background: COLORS.barTrack,
                    display: 'flex',
                  }}
                >
                  <div
                    style={{
                      width: barWidth,
                      height: row.barHeight,
                      borderRadius: row.barRadius,
                      background: COLORS.barFill,
                      display: 'flex',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
