'use client';

import { useState } from 'react';
import Link from 'next/link';
import PhotobookCard, { type PhotobookCardData } from './PhotobookCard';

interface Props {
  femaleItems: PhotobookCardData[];
  maleItems: PhotobookCardData[];
}

type Tab = 'female' | 'male';

// ホームの「写真集を探す」セクション。女性/男性タブの切り替えはクライアント側で行い、
// 両方のデータをサーバー側で事前取得済みの配列として受け取るため、タブ切り替え時に
// 追加のfetchは発生しない。
export default function PhotobookHomeSection({ femaleItems, maleItems }: Props) {
  // 初期表示: 件数が多い方を優先して表示する（既存UIとの相性を考慮し、空のタブを
  // 最初に見せないため）。両方0件ならこのコンポーネント自体を呼び出し側で描画しない。
  const [tab, setTab] = useState<Tab>(femaleItems.length >= maleItems.length ? 'female' : 'male');

  const items = tab === 'female' ? femaleItems : maleItems;

  return (
    <section style={{ background: 'var(--ds-bg)', borderBottom: '1px solid var(--ds-border)', paddingTop: '24px', paddingBottom: '32px' }}>
      <div style={{ maxWidth: '1152px', margin: '0 auto' }}>
        <div style={{ padding: '0 16px', marginBottom: '4px' }}>
          <h2 className="section-heading" style={{ fontSize: '16px', fontWeight: 700, marginBottom: '4px' }}>
            写真集を探す
          </h2>
          <p style={{ fontSize: '12px', color: 'var(--ds-muted)', marginBottom: '12px' }}>
            推しの写真集・フォトブックをチェック
          </p>
        </div>

        {/* 性別タブ */}
        <div style={{ display: 'flex', gap: '8px', padding: '0 16px', marginBottom: '12px' }}>
          {(['female', 'male'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="theme-card"
              style={{
                padding: '8px 18px',
                minHeight: '36px',
                borderRadius: '999px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                border: tab === t ? '1.5px solid var(--ds-primary)' : '1.5px solid var(--ds-border)',
                background: tab === t ? 'var(--ds-primary-soft)' : 'var(--ds-surface)',
                color: tab === t ? 'var(--ds-primary)' : 'var(--ds-muted)',
              }}
            >
              {t === 'female' ? '女性' : '男性'}
            </button>
          ))}
        </div>

        {items.length > 0 ? (
          <div className="persons-row">
            {items.map((item) => (
              <div key={`${item.personName}-${item.productId}`} className="photobook-row-item">
                <PhotobookCard data={item} />
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '13px', color: 'var(--ds-muted)', padding: '24px 16px', textAlign: 'center' }}>
            現在、確認できている写真集がありません。
          </p>
        )}

        <div style={{ textAlign: 'center', marginTop: '12px', padding: '0 16px' }}>
          <Link
            href={`/photobooks?gender=${tab}`}
            className="theme-text-link"
            style={{ fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}
          >
            写真集をもっと見る →
          </Link>
        </div>
      </div>
    </section>
  );
}
