'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getHomeGroupCategory, type HomeGroupCategory } from '@/lib/home-group-category';

export interface HomeGroupItem {
  name: string;
  href: string;
}

type GroupCategory = HomeGroupCategory;
type Filter = 'all' | GroupCategory;

// トップページ「グループで探す」の絞り込み専用の表示分類（明示的なマッピング。src/lib/home-group-category.ts）。
// DB・group_meta・人物データとは独立しており、一覧に無いグループ（新規追加など）は「その他」になる。
const getGroupCategory = getHomeGroupCategory;

const FILTER_LABEL: Record<Filter, string> = {
  all: 'すべて',
  femaleIdol: '女性アイドル',
  maleIdol: '男性アイドル',
  other: 'その他',
};

function matches(item: HomeGroupItem, filter: Filter): boolean {
  return filter === 'all' || getGroupCategory(item.name) === filter;
}

// ホームの「グループで探す」。初期表示は「すべて」で全グループのリンクをサーバーHTMLに含める
// （SEO・内部リンクは従来と同じ）。絞り込みはクライアント側の表示切り替えのみで、リンクのURL・
// 見た目（theme-group-chip）は変更しない。
export default function HomeGroupSection({ groups }: { groups: HomeGroupItem[] }) {
  const [filter, setFilter] = useState<Filter>('all');

  // 該当0件の絞り込みボタンは出さない。「すべて」以外が1種類しかない場合は絞り込み自体を出さない
  const filters = (['all', 'femaleIdol', 'maleIdol', 'other'] as const).filter(
    (f) => f === 'all' || groups.some((g) => matches(g, f)),
  );
  const visible = groups.filter((g) => matches(g, filter));

  return (
    <section style={{ marginBottom: '32px' }}>
      <h2 className="section-heading" style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>グループで探す</h2>
      <p style={{ fontSize: '12px', color: 'var(--ds-muted)', marginBottom: '12px' }}>
        推しのグループから、メンバーの出演作・配信先・商品をチェック
      </p>

      {filters.length > 2 && (
        <div role="group" aria-label="グループの絞り込み" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className="theme-card"
              style={{
                padding: '6px 14px',
                minHeight: '34px',
                borderRadius: '999px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                border: filter === f ? '1.5px solid var(--ds-primary)' : '1.5px solid var(--ds-border)',
                background: filter === f ? 'var(--ds-primary-soft)' : 'var(--ds-surface)',
                color: filter === f ? 'var(--ds-primary)' : 'var(--ds-muted)',
              }}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {visible.map((group) => (
          <Link
            key={group.name}
            href={group.href}
            className="theme-group-chip"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '9px 16px',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: 500,
              textDecoration: 'none',
              minHeight: '40px',
            }}
          >
            {group.name}
          </Link>
        ))}
      </div>
    </section>
  );
}
