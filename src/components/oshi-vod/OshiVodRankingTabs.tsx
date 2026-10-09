'use client';

// 3種類のランキングを切り替えるタブ（スマホで縦に長くなりすぎないようにする）。
// 各パネルの中身はサーバー側で描画済みのものを受け取り、表示切替だけを行う。
import { useState, type ReactNode } from 'react';

export interface RankingTab {
  id: string;
  label: string;
  /** タブ内に小さく表示する1位のサービス名（無ければ「該当なし」） */
  leader: string | null;
  content: ReactNode;
}

export default function OshiVodRankingTabs({ tabs }: { tabs: RankingTab[] }) {
  const [active, setActive] = useState(0);
  return (
    <div className="ov-tabs">
      <div role="tablist" aria-label="ランキングの種類" className="ov-tablist">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`ov-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={active === i}
            aria-controls={`ov-tabpanel-${t.id}`}
            className={`ov-tab${active === i ? ' is-active' : ''}`}
            onClick={() => setActive(i)}
          >
            <span className="ov-tab-label">{t.label}</span>
            <span className="ov-tab-leader">{t.leader ? `1位 ${t.leader}` : '該当なし'}</span>
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.id}
          id={`ov-tabpanel-${t.id}`}
          role="tabpanel"
          aria-labelledby={`ov-tab-${t.id}`}
          hidden={active !== i}
          className="ov-tabpanel"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
