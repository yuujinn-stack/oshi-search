/**
 * G「推し活、検索しすぎ問題」（search-too-much）。予約画面で管理者が明示的に選んだ場合だけ使う（自動選択には入らない）。
 * 役割：推し活で何度も検索してしまう面倒さへの共感から入る（H＝機能を一瞬で理解させる、J＝実際のサイトを使う体験を見せる）。
 *
 * 1枚目: 「○○を追うなら」＋「推し活、検索しすぎ問題。」＋スマホの「最近の検索」（出演作品はどこ？／どのサブスクで見れる？／関連商品は？）
 * 2枚目: 左「今までは…」（検索1〜3回目）／右「推しサーチなら人物名ひとつ。」＋検索欄＋出演作品・配信サービス・関連商品の件数（実データ）
 * 3枚目: 「その検索、1回でよくない？」→ 3つの検索 → 「推しサーチなら、まとめて検索。」＋プロフィールへの案内
 * 黒背景が主役（H＝生成りのドット、J＝白）。数字は人物ページと同じ集計（site-ui/data.ts）。
 */
import type { ReactElement } from 'react';
import { COLORS } from './theme';
import { ClockIcon, SearchBar, SiteLogo, fitFontSize } from './shared';
import { Canvas, MagnifierIcon } from './gj-parts';
import type { SiteUiTemplateData } from './types';

/** スマホの検索欄の「検索履歴」風の行（広告バナーの吹き出しではなく、普段見ている画面に寄せる） */
function HistoryRow({ text, last }: { text: string; last?: boolean }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '22px 30px', borderBottom: last ? 'none' : '2px solid #34342F' }}>
      <ClockIcon size={38} color={COLORS.onInkMuted} />
      <span style={{ fontSize: 46, fontWeight: 700, color: COLORS.white, display: 'flex', whiteSpace: 'nowrap' }}>{text}</span>
      <span style={{ fontSize: 40, color: COLORS.onInkMuted, display: 'flex', marginLeft: 'auto' }}>↖</span>
    </div>
  );
}

function G1({ data }: { data: SiteUiTemplateData }): ReactElement {
  const lead = `${data.personName}を追うなら`;
  return (
    <Canvas bg="ink">
      <div style={{ padding: '56px 64px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: fitFontSize(lead, 700, 48, 34), fontWeight: 700, color: COLORS.accent, display: 'flex' }}>{lead}</span>
        <SiteLogo fontSize={26} onDark />
      </div>
      <div style={{ padding: '26px 64px 0', display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 118, fontWeight: 700, lineHeight: 1.12, display: 'flex' }}>推し活、</span>
        <div style={{ display: 'flex', fontSize: 118, fontWeight: 700, lineHeight: 1.12 }}>
          <span style={{ color: COLORS.accent, display: 'flex' }}>検索しすぎ</span>
          <span style={{ display: 'flex' }}>問題。</span>
        </div>
      </div>
      <div style={{ margin: '44px 64px 0', border: '3px solid #34342F', borderRadius: 22, background: '#161614', display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: COLORS.onInkMuted, display: 'flex', padding: '18px 30px 4px' }}>最近の検索</span>
        <HistoryRow text="出演作品はどこ？" />
        <HistoryRow text="どのサブスクで見れる？" />
        <HistoryRow text="関連商品は？" last />
      </div>
      <div style={{ position: 'absolute', left: 64, bottom: 64, display: 'flex', alignItems: 'flex-end', fontSize: 60, fontWeight: 700 }}>
        <span style={{ display: 'flex', paddingBottom: 8 }}>これ、</span>
        <span style={{ color: COLORS.accent, display: 'flex', paddingBottom: 2, borderBottom: `6px solid ${COLORS.accent}` }}>1か所</span>
        <span style={{ display: 'flex', paddingBottom: 8 }}>で探せます。</span>
      </div>
    </Canvas>
  );
}

function OldStep({ n, text }: { n: number; text: string }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: 400, height: 124, padding: '0 22px', border: `3px solid #4A4A45`, borderRadius: 14, background: '#1C1C1A' }}>
      <MagnifierIcon size={36} color={COLORS.onInkMuted} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: COLORS.accent, display: 'flex' }}>{`検索 ${n}回目`}</span>
        <span style={{ fontSize: 38, fontWeight: 700, color: COLORS.white, display: 'flex', whiteSpace: 'nowrap' }}>{text}</span>
      </div>
    </div>
  );
}

function GStat({ label, value, unit }: { label: string; value: number; unit: string }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '14px 0', borderBottom: `3px solid ${COLORS.ink}` }}>
      <span style={{ fontSize: 34, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 84, fontWeight: 700, lineHeight: 1, color: COLORS.accent, display: 'flex' }}>{value}</span>
        <span style={{ fontSize: 34, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{unit}</span>
      </div>
    </div>
  );
}

function G2({ data }: { data: SiteUiTemplateData }): ReactElement {
  return (
    <Canvas bg="dots">
      <div style={{ display: 'flex', height: '100%' }}>
        {/* 左：今まで（黒） */}
        <div style={{ width: 492, height: '100%', background: COLORS.ink, padding: '0 46px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <span style={{ fontSize: 72, fontWeight: 700, color: COLORS.white, display: 'flex', marginBottom: 44 }}>今までは…</span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <OldStep n={1} text="出演作品を検索" />
            <span style={{ fontSize: 48, color: COLORS.onInkMuted, display: 'flex', lineHeight: 1 }}>↓</span>
            <OldStep n={2} text="配信先を検索" />
            <span style={{ fontSize: 48, color: COLORS.onInkMuted, display: 'flex', lineHeight: 1 }}>↓</span>
            <OldStep n={3} text="商品をまた検索" />
          </div>
          <span style={{ fontSize: 36, fontWeight: 700, color: COLORS.onInkMuted, display: 'flex', marginTop: 44, whiteSpace: 'nowrap' }}>調べる場所がバラバラ。</span>
        </div>
        {/* 右：推しサーチなら */}
        <div style={{ flex: 1, padding: '0 52px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <span style={{ fontSize: 44, fontWeight: 700, color: COLORS.ink, display: 'flex' }}>推しサーチなら</span>
          <span style={{ fontSize: 80, fontWeight: 700, color: COLORS.accent, lineHeight: 1.15, display: 'flex' }}>人物名</span>
          <span style={{ fontSize: 80, fontWeight: 700, color: COLORS.accent, lineHeight: 1.15, display: 'flex', marginBottom: 30 }}>ひとつ。</span>
          <SearchBar text={data.personName} width={484} fontSize={30} />
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 26 }}>
            <GStat label="出演作品" value={data.workCount} unit="件" />
            <GStat label="配信サービス" value={data.serviceCount} unit="社" />
            <GStat label="関連商品" value={data.productCount} unit="件" />
          </div>
          <span style={{ fontSize: 22, color: COLORS.muted, display: 'flex', marginTop: 18 }}>※人物ページの件数（確認時点）</span>
        </div>
      </div>
    </Canvas>
  );
}

function SmallSearch({ text }: { text: string }): ReactElement {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, height: 96, border: '3px solid #4A4A45', borderRadius: 48, background: '#1C1C1A' }}>
      <MagnifierIcon size={32} color={COLORS.onInkMuted} />
      <span style={{ fontSize: 36, fontWeight: 700, color: COLORS.white, display: 'flex', whiteSpace: 'nowrap' }}>{text}</span>
    </div>
  );
}

function G3({ data }: { data: SiteUiTemplateData }): ReactElement {
  return (
    <Canvas bg="ink">
      <div style={{ padding: '60px 64px 0', display: 'flex' }}>
        <SiteLogo fontSize={26} onDark />
      </div>
      <div style={{ padding: '24px 64px 0', display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 104, fontWeight: 700, lineHeight: 1.15, display: 'flex' }}>その検索、</span>
        <span style={{ fontSize: 104, fontWeight: 700, lineHeight: 1.15, color: COLORS.accent, display: 'flex' }}>1回でよくない？</span>
      </div>
      <div style={{ padding: '50px 64px 0', display: 'flex', gap: 18 }}>
        <SmallSearch text="作品を探す" />
        <SmallSearch text="配信先を探す" />
        <SmallSearch text="商品を探す" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '14px 0' }}>
        <span style={{ fontSize: 64, fontWeight: 700, color: COLORS.accent, lineHeight: 1, display: 'flex' }}>↓</span>
      </div>
      <div style={{ margin: '0 64px', padding: '26px 30px 30px', border: `4px solid ${COLORS.accent}`, borderRadius: 18, background: '#1C1C1A', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <span style={{ fontSize: 50, fontWeight: 700, display: 'flex' }}>推しサーチなら、まとめて検索。</span>
        <SearchBar text={data.personName} width={884} fontSize={36} />
      </div>
      <div style={{ position: 'absolute', left: 64, bottom: 58, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 36, fontWeight: 700, color: COLORS.onInkMuted, display: 'flex' }}>気になる推しができたら</span>
        <div style={{ display: 'flex', fontSize: 44, fontWeight: 700 }}>
          <span style={{ display: 'flex' }}>プロフィールから</span>
          <span style={{ color: COLORS.accent, display: 'flex' }}>『推しサーチ』</span>
          <span style={{ display: 'flex' }}>へ</span>
        </div>
      </div>
    </Canvas>
  );
}

export function buildSearchTooMuchPages(data: SiteUiTemplateData): ReactElement[] {
  return [<G1 key="1" data={data} />, <G2 key="2" data={data} />, <G3 key="3" data={data} />];
}
