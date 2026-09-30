/**
 * テンプレート候補E「推し活で地味に面倒なこと」（search-pain）。Preview専用。
 * 人物に依存せず、推し活での「検索の面倒さ」を問題提起する。人物名・作品・配信データは使わない。
 * 特定サービス（Google・Netflix等）の検索画面を模したUIは使わず、汎用のカードと矢印だけで表現する。
 */
import type { ReactElement } from 'react';
import { BACKGROUNDS, COLORS } from './theme';
import { ArrowDown, BrandLogo, CtaBand, MarkedText, Page, SearchIcon, SwipeHint } from './shared';

const STEPS = ['人物名を検索', '出演作品を検索', 'その作品どこで見れる？', 'サブスクをまた検索'];

function Page1(): ReactElement {
  return (
    <Page background={BACKGROUNDS.navy} tone="navy" brand overlay={<SwipeHint tone="navy" />}>
      <span style={{ fontSize: 96, fontWeight: 700, color: COLORS.white, display: 'flex' }}>推し活で</span>
      <div style={{ marginTop: 6, display: 'flex' }}>
        <MarkedText text="地味に面倒なこと。" fontSize={96} markerColor="rgba(31,182,224,0.55)" color={COLORS.white} />
      </div>
      <div
        style={{
          marginTop: 70,
          padding: '34px 56px',
          borderRadius: 40,
          background: COLORS.white,
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <span style={{ fontSize: 54, fontWeight: 700, color: COLORS.navy, display: 'flex' }}>この人何に出てたっけ？</span>
      </div>
    </Page>
  );
}

function Page2(): ReactElement {
  return (
    <Page background={BACKGROUNDS.pale} brand>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div
              style={{
                width: 780,
                height: 108,
                display: 'flex',
                alignItems: 'center',
                gap: 22,
                padding: '0 34px',
                background: COLORS.white,
                borderRadius: 999,
                border: `3px solid ${COLORS.cardBorder}`,
                boxShadow: '0 8px 18px rgba(16,51,73,0.08)',
              }}
            >
              <SearchIcon size={44} color={COLORS.accent} />
              <span style={{ fontSize: 42, fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>{s}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ margin: '10px 0', display: 'flex' }}>
                <ArrowDown size={42} color={COLORS.accent} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 40, display: 'flex' }}>
        <MarkedText text="……検索しすぎ。" fontSize={76} markerColor={COLORS.white} color={COLORS.accentDark} />
      </div>
    </Page>
  );
}

function Page3(): ReactElement {
  return (
    <Page background={BACKGROUNDS.cyan}>
      <span style={{ fontSize: 84, fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>人物名から</span>
      <div style={{ marginTop: 8, display: 'flex' }}>
        <MarkedText text="まとめて探せます。" fontSize={84} markerColor={COLORS.white} />
      </div>
      <div style={{ marginTop: 60, display: 'flex' }}>
        <BrandLogo fontSize={80} />
      </div>
      <span style={{ marginTop: 30, fontSize: 36, fontWeight: 700, color: COLORS.textDark, display: 'flex' }}>出演作品・配信先・関連情報をまとめてチェック</span>
      <CtaBand marginTop={46} />
    </Page>
  );
}

export function buildSearchPainPages(): [ReactElement, ReactElement, ReactElement] {
  return [<Page1 key="1" />, <Page2 key="2" />, <Page3 key="3" />];
}
