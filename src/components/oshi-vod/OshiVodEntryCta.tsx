// 推しに合うサブスク診断（/oshi-vod）への導線カード（トップ・人物ページ・グループページ共通）。
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
  /** 説明文の下に小さく添える補足（例: 「無料・登録不要」） */
  note?: string;
}

export default function OshiVodEntryCta({ href, title, description, buttonLabel = '診断', className, style, note }: Props) {
  return (
    <aside aria-label="推しに合うサブスク診断" className={className} style={style}>
      <Link
        href={href}
        className="oshi-vod-entry"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '14px 16px',
          background: '#FFFFFF',
          border: '2px solid #0A0A0A',
          boxShadow: '4px 4px 0 #FF5A00',
          color: '#0A0A0A',
          textDecoration: 'none',
        }}
      >
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.14em', color: '#C84A00' }}>
            SUBSCRIPTION DIAGNOSIS
          </span>
          <span style={{ display: 'block', fontSize: '15px', fontWeight: 900, lineHeight: 1.4 }}>{title}</span>
          <span style={{ display: 'block', fontSize: '12px', lineHeight: 1.6, color: '#62625C', marginTop: '2px' }}>{description}</span>
          {note && (
            <span
              style={{
                display: 'inline-block',
                marginTop: '6px',
                padding: '1px 6px',
                fontSize: '11px',
                fontWeight: 700,
                lineHeight: 1.6,
                color: '#146C3A',
                background: '#EAF7EF',
                border: '1px solid #BFE3CC',
              }}
            >
              {note}
            </span>
          )}
        </span>
        <span
          style={{
            flexShrink: 0,
            padding: '8px 10px',
            background: '#0A0A0A',
            color: '#FFFFFF',
            fontSize: '13px',
            fontWeight: 800,
            whiteSpace: 'nowrap',
          }}
        >
          {buttonLabel} →
        </span>
      </Link>
    </aside>
  );
}
