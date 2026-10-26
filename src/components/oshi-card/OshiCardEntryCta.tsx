// 推し布教カード（/oshi-card）への導線カード（人物ページ・トップ）。サブスク診断・お買い物診断の導線カード
// （OshiVodEntryCta・OshiShoppingEntryCta）と同じ C案（Graphic Pop）の見た目にそろえる。
// 既存ページのセクション番号CSS（section:nth-of-type 等）に影響しないよう <aside> で描画する。
import type { CSSProperties } from 'react';
import Link from 'next/link';

interface Props {
  href: string;
  title: string;
  description: string;
  buttonLabel?: string;
  className?: string;
  style?: CSSProperties;
  note?: string;
}

export default function OshiCardEntryCta({ href, title, description, buttonLabel = '作る', className, style, note }: Props) {
  return (
    <aside aria-label="推し布教カード" className={className} style={style}>
      <Link
        href={href}
        className="oshi-card-entry"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '14px 16px',
          background: '#FFFFFF',
          border: '2px solid #0A0A0A',
          boxShadow: '4px 4px 0 #FEE34F',
          color: '#0A0A0A',
          textDecoration: 'none',
        }}
      >
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.14em', color: '#8A6A00' }}>OSHI CARD</span>
          <span style={{ display: 'block', fontSize: '15px', fontWeight: 900, lineHeight: 1.4 }}>{title}</span>
          <span style={{ display: 'block', fontSize: '12px', lineHeight: 1.6, color: '#62625C', marginTop: '2px' }}>{description}</span>
          {note && (
            <span style={{ display: 'inline-block', marginTop: '6px', padding: '1px 6px', fontSize: '11px', fontWeight: 700, lineHeight: 1.6, color: '#146C3A', background: '#EAF7EF', border: '1px solid #BFE3CC' }}>
              {note}
            </span>
          )}
        </span>
        <span
          aria-hidden="true"
          style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '64px', minHeight: '44px', padding: '0 10px', fontSize: '14px', fontWeight: 900, background: '#0A0A0A', color: '#FFFFFF' }}
        >
          {buttonLabel} →
        </span>
      </Link>
    </aside>
  );
}
