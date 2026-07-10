import Link from 'next/link';
import { getPersonCardBadges } from '@/lib/genre-utils';
import type { PersonCardMeta } from '@/lib/genre-utils';

// ジャンル別アバターCSSクラス（globals.cssで定義）
const AVATAR_CLASS: Record<string, string> = {
  '坂道': 'avatar-sakamichi',
  '芸人': 'avatar-geinin',
  'テレビ': 'avatar-tv',
  'アーティスト': 'avatar-artist',
  '俳優': 'avatar-actor',
};

// ジャンル別バッジラベル
const GENRE_EMOJI: Record<string, string> = {
  '坂道': '🌸',
  '芸人': '🎭',
  'テレビ': '📺',
  'アーティスト': '🎵',
  '俳優': '🎬',
  '女優': '🎭',
  'アイドル': '⭐',
  '元アイドル': '🌟',
  'タレント': '✨',
  'モデル': '👗',
  '歌手': '🎤',
  '声優': '🎙️',
  'バラエティ': '🎪',
  'アナウンサー': '📢',
};

interface PersonCardData {
  name: string;
  group: string;
  genre: string;
}

export default function HomePersonCard({ person }: { person: PersonCardData & PersonCardMeta }) {
  const avatarClass = AVATAR_CLASS[person.genre] ?? 'avatar-default';
  const badges = getPersonCardBadges(person.genre, person, 3);
  const subtitle = person.primaryGenre || person.group;

  return (
    <Link
      href={`/person/${encodeURIComponent(person.name)}`}
      className="theme-card home-person-card"
      style={{ display: 'block', textDecoration: 'none', padding: '16px 12px' }}
    >
      {/* アバター: CLS防止のため明示的サイズ固定 */}
      <div
        className={`person-avatar ${avatarClass}`}
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 12px',
          fontSize: '22px',
          fontWeight: 900,
          color: '#fff',
          flexShrink: 0,
          userSelect: 'none',
        }}
        aria-hidden="true"
      >
        {person.name[0]}
      </div>

      {/* 名前 */}
      <p style={{
        textAlign: 'center',
        fontWeight: 700,
        color: 'var(--ds-text)',
        fontSize: '13px',
        lineHeight: 1.4,
        marginBottom: '4px',
        wordBreak: 'break-all',
      }}>
        {person.name}
      </p>

      {/* サブタイトル: primaryGenre 優先、なければ group */}
      {subtitle && (
        <p style={{
          textAlign: 'center',
          color: 'var(--ds-muted)',
          fontSize: '11px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: '6px',
        }}>
          {subtitle}
        </p>
      )}

      {/* ジャンルバッジ（複数） */}
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '4px' }}>
        {badges.map((badge) => (
          <span
            key={badge}
            className={`genre-badge genre-badge-${badge}`}
            style={{ fontSize: '11px' }}
          >
            {GENRE_EMOJI[badge] ?? ''} {badge}
          </span>
        ))}
      </div>
    </Link>
  );
}
