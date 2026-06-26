import Link from 'next/link';
import type { RankedPerson } from '@/lib/ranking';

const AVATAR_CLASS: Record<string, string> = {
  '坂道': 'avatar-sakamichi',
  '芸人': 'avatar-geinin',
  'テレビ': 'avatar-tv',
  'アーティスト': 'avatar-artist',
  '俳優': 'avatar-actor',
};

const GENRE_EMOJI: Record<string, string> = {
  '坂道': '🌸',
  '芸人': '🎭',
  'テレビ': '📺',
  'アーティスト': '🎵',
  '俳優': '🎬',
};

export default function RankingPersonCard({ person, rank }: { person: RankedPerson; rank: number }) {
  const avatarClass = AVATAR_CLASS[person.genre] ?? 'avatar-default';
  const emoji = GENRE_EMOJI[person.genre] ?? '';

  return (
    <Link
      href={`/person/${encodeURIComponent(person.name)}`}
      className="theme-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 10px 12px',
        textDecoration: 'none',
        position: 'relative',
        minWidth: 0,
      }}
    >
      {/* 順位バッジ */}
      <span
        style={{
          position: 'absolute',
          top: '6px',
          left: '6px',
          fontSize: '10px',
          fontWeight: 700,
          color: rank <= 3 ? '#fff' : 'var(--ds-muted)',
          background: rank === 1 ? '#f59e0b' : rank === 2 ? '#94a3b8' : rank === 3 ? '#c97d4e' : 'var(--ds-primary-soft)',
          borderRadius: '4px',
          padding: '1px 5px',
          lineHeight: 1.6,
        }}
      >
        {rank}
      </span>

      {/* アバター */}
      <div
        className={`person-avatar ${avatarClass}`}
        style={{
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '20px',
          fontWeight: 900,
          color: '#fff',
          flexShrink: 0,
          userSelect: 'none',
          marginBottom: '10px',
        }}
        aria-hidden="true"
      >
        {person.name[0]}
      </div>

      {/* 名前 */}
      <p style={{
        fontWeight: 700,
        color: 'var(--ds-text)',
        fontSize: '12px',
        lineHeight: 1.4,
        marginBottom: '2px',
        textAlign: 'center',
        wordBreak: 'break-all',
      }}>
        {person.name}
      </p>

      {/* グループ */}
      {person.group && (
        <p style={{
          color: 'var(--ds-muted)',
          fontSize: '10px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
          textAlign: 'center',
          marginBottom: '6px',
        }}>
          {person.group}
        </p>
      )}

      {/* スタッツ */}
      <div style={{
        display: 'flex',
        gap: '6px',
        marginTop: 'auto',
        justifyContent: 'center',
        flexWrap: 'wrap',
      }}>
        {person.productCount > 0 && (
          <span style={{ fontSize: '10px', color: 'var(--ds-muted)', display: 'flex', alignItems: 'center', gap: '2px' }}>
            🛍 {person.productCount}
          </span>
        )}
        {person.workCount > 0 && (
          <span style={{ fontSize: '10px', color: 'var(--ds-muted)', display: 'flex', alignItems: 'center', gap: '2px' }}>
            🎬 {person.workCount}
          </span>
        )}
        {person.streamingCount > 0 && (
          <span style={{ fontSize: '10px', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '2px' }}>
            ▶ {person.streamingCount}
          </span>
        )}
      </div>

      {/* ジャンルバッジ */}
      <div style={{ marginTop: '6px' }}>
        <span className={`genre-badge genre-badge-${person.genre}`} style={{ fontSize: '10px' }}>
          {emoji} {person.genre}
        </span>
      </div>
    </Link>
  );
}
