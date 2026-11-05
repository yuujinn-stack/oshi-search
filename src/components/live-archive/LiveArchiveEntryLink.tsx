// 人物ページから所属グループの「過去のライブ映像」一覧（/groups/<slug>/live）への導線カード。
// 人物の出演作品として見えないよう、グループのライブ映像であることと、公演ごとの出演メンバーは公式情報で確認する旨を書く。
// 人物ページのセクション番号CSS（person-graphic.css の `> section` のカウンタ）に影響しないよう <aside> で描画する
// （OshiShoppingEntryCta と同じ考え方・同じ C案の見た目）。
import Link from 'next/link';

export default function LiveArchiveEntryLink({ groupName, href }: { groupName: string; href: string }) {
  return (
    <aside aria-label={`${groupName}の過去のライブ映像`}>
      <Link
        href={href}
        className="live-archive-entry"
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
            LIVE ARCHIVE
          </span>
          <span style={{ display: 'block', fontSize: '15px', fontWeight: 900, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
            {groupName}の過去のライブ映像を探す
          </span>
          <span style={{ display: 'block', fontSize: '12px', lineHeight: 1.6, color: '#62625C', marginTop: '2px' }}>
            グループのライブDVD・Blu-rayを発売日順に紹介。公演ごとの出演メンバーは公式情報でご確認ください。
          </span>
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
          一覧 →
        </span>
      </Link>
    </aside>
  );
}
