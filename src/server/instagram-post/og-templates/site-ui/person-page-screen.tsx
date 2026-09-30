/**
 * H「観るもの・買うもの、まとめて」3枚目に入れる、推しサーチ人物ページ上部（スマホ表示）の再構成。
 *
 * 公開サイトの人物ページ（src/app/person/[slug]/page.tsx ＋ person-graphic.css）の上部と同じ配色・構成
 * （ヘッダーの「● 推しサーチ」と検索欄、パンくず「ホーム › ジャンル › グループ › 人物名」、
 * 「PROFILE / PERSON」ラベル、頭文字の枠、人物名、統計ボックス「配信中・出演作品・関連商品・配信サービス」）を、
 * 同じ集計（../../site-ui/data.ts）の実データからサーバー側で描画する。
 * ブラウザでの撮影に依存しないため、Vercel上（予約作成時）でも生成できる。
 *
 * 人物ページ側で複雑な判定を経て表示するプロフィールのタグ・紹介文は描かない（誤った内容を出さないため）。
 * 寸法はスマホ幅390pxの画面を基準にし、scale 倍で描画する。
 */
import type { ReactElement } from 'react';
import { COLORS } from './theme';
import { fallbackInitial } from './shared';

export interface PersonPageScreenData {
  personName: string;
  genre: string;
  group: string | null;
  streamingWorkCount: number;
  workCount: number;
  productCount: number;
  serviceCount: number;
}

/** 画面の縦の長さ（スマホ幅390px基準） */
export const PERSON_PAGE_SCREEN_BASE_HEIGHT = 356;

function Stat({ label, value, unit, u }: { label: string; value: number; unit: string; u: (n: number) => number }): ReactElement {
  return (
    <div
      style={{
        flex: 1,
        height: u(58),
        border: `${u(2)}px solid ${COLORS.ink}`,
        background: COLORS.surface,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: u(2),
      }}
    >
      <span style={{ fontSize: u(10), color: COLORS.muted, display: 'flex' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: u(2) }}>
        <span style={{ fontSize: u(19), fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{value}</span>
        <span style={{ fontSize: u(11), fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{unit}</span>
      </div>
    </div>
  );
}

export function PersonPageScreen({ data, scale }: { data: PersonPageScreenData; scale: number }): ReactElement {
  const u = (n: number) => Math.round(n * scale);
  const crumbs = ['ホーム', data.genre, ...(data.group ? [data.group] : [])];
  return (
    <div style={{ width: u(390), height: u(PERSON_PAGE_SCREEN_BASE_HEIGHT), background: COLORS.bg, display: 'flex', flexDirection: 'column' }}>
      {/* ヘッダー：● 推しサーチ＋検索欄（人物名を入力した状態） */}
      <div style={{ height: u(58), padding: `0 ${u(14)}px`, borderBottom: `${u(2)}px solid ${COLORS.ink}`, display: 'flex', alignItems: 'center', gap: u(10) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: u(5), flexShrink: 0 }}>
          <div style={{ width: u(8), height: u(8), borderRadius: '50%', background: COLORS.accent, display: 'flex' }} />
          <span style={{ fontSize: u(17), fontWeight: 700, color: COLORS.ink, display: 'flex' }}>推しサーチ</span>
        </div>
        <div style={{ flex: 1, height: u(34), border: `${u(1.5)}px solid ${COLORS.ink}`, background: COLORS.surface, padding: `0 ${u(8)}px`, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
          <span style={{ fontSize: u(12), color: COLORS.ink, whiteSpace: 'nowrap', display: 'flex' }}>{data.personName}</span>
        </div>
        <div style={{ width: u(46), height: u(34), background: COLORS.ink, color: COLORS.white, fontSize: u(12), fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          検索
        </div>
      </div>
      {/* パンくず */}
      <div style={{ height: u(34), padding: `0 ${u(16)}px`, borderBottom: `${u(1)}px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', gap: u(5), fontSize: u(10.5), color: COLORS.muted }}>
        {crumbs.map((c) => (
          <div key={c} style={{ display: 'flex', alignItems: 'center', gap: u(5) }}>
            <span style={{ display: 'flex' }}>{c}</span>
            <span style={{ opacity: 0.4, display: 'flex' }}>›</span>
          </div>
        ))}
        <span style={{ color: COLORS.text, fontWeight: 700, display: 'flex' }}>{data.personName}</span>
      </div>
      {/* プロフィール */}
      <div style={{ padding: `${u(18)}px ${u(16)}px ${u(14)}px`, display: 'flex', alignItems: 'center', gap: u(14) }}>
        <div style={{ width: u(66), height: u(66), border: `${u(2)}px solid ${COLORS.accent}`, background: COLORS.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: u(30), fontWeight: 700, color: COLORS.accent, display: 'flex' }}>{fallbackInitial(data.personName)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: u(3) }}>
          <span style={{ fontSize: u(9), fontWeight: 700, letterSpacing: u(2), color: COLORS.accent, display: 'flex' }}>PROFILE / PERSON</span>
          <span style={{ fontSize: u(26), fontWeight: 700, color: COLORS.ink, display: 'flex' }}>{data.personName}</span>
          {data.group && <span style={{ fontSize: u(11), color: COLORS.muted, display: 'flex' }}>{data.group}</span>}
        </div>
      </div>
      {/* 統計ボックス（人物ページと同じ4項目・同じ集計値） */}
      <div style={{ padding: `0 ${u(16)}px`, display: 'flex', flexDirection: 'column', gap: u(8) }}>
        <div style={{ display: 'flex', gap: u(8) }}>
          <Stat label="配信中" value={data.streamingWorkCount} unit="件" u={u} />
          <Stat label="出演作品" value={data.workCount} unit="件" u={u} />
        </div>
        <div style={{ display: 'flex', gap: u(8) }}>
          <Stat label="関連商品" value={data.productCount} unit="件" u={u} />
          <Stat label="配信サービス" value={data.serviceCount} unit="社" u={u} />
        </div>
      </div>
    </div>
  );
}
