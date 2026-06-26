import Link from 'next/link';
import { getAllPersonsMerged, ALL_GENRES } from '@/lib/persons';
import HeroSearchForm from '@/components/site/HeroSearchForm';
import HomePersonCard from '@/components/site/HomePersonCard';

// 公開反映時に revalidateTag('persons') でキャッシュバスト、最大 60s ISR
export const revalidate = 60;

const GENRE_EMOJI: Record<string, string> = {
  '坂道': '🌸',
  '芸人': '🎭',
  'テレビ': '📺',
  'アーティスト': '🎵',
  '俳優': '🎬',
};

export default async function HomePage() {
  const persons = await getAllPersonsMerged();
  const groups = [...new Set(persons.map((p) => p.group).filter(Boolean))];
  const featured = persons.slice(0, 12);

  return (
    <div>
      {/* ━━━ Hero ━━━ */}
      <section
        style={{
          background: 'linear-gradient(135deg, var(--ds-hero-from) 0%, var(--ds-hero-to) 100%)',
          padding: 'clamp(48px, 8vw, 96px) 16px',
        }}
      >
        <div style={{ maxWidth: '640px', margin: '0 auto', textAlign: 'center' }}>
          <h1
            style={{
              fontSize: 'clamp(22px, 5vw, 38px)',
              fontWeight: 900,
              color: '#fff',
              marginBottom: '10px',
              letterSpacing: '-0.02em',
              lineHeight: 1.25,
            }}
          >
            推しの出演作品・関連商品・
            <wbr />
            配信情報をまとめて探せる
          </h1>
          <p
            style={{
              color: 'rgba(255,255,255,0.78)',
              marginBottom: '32px',
              fontSize: '15px',
              lineHeight: 1.65,
            }}
          >
            アイドル・俳優・芸人など、気になる人の作品やグッズをかんたん検索
          </p>

          <HeroSearchForm />

          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '12px', marginTop: '20px' }}>
            現在 {persons.length} 人のデータを収録中
          </p>
        </div>
      </section>

      {/* ━━━ メインコンテンツ ━━━ */}
      <div
        style={{
          maxWidth: '1152px',
          margin: '0 auto',
          padding: 'clamp(32px, 5vw, 56px) 16px',
        }}
      >
        {/* ジャンルで探す */}
        <section style={{ marginBottom: '48px' }}>
          <h2 className="section-heading">ジャンルで探す</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {ALL_GENRES.map((genre) => (
              <Link
                key={genre}
                href={`/genre/${encodeURIComponent(genre)}`}
                className="theme-link-pill"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 22px',
                  borderRadius: '999px',
                  fontWeight: 700,
                  fontSize: '14px',
                  textDecoration: 'none',
                  minHeight: '44px',
                }}
              >
                <span aria-hidden="true">{GENRE_EMOJI[genre]}</span>
                <span>{genre}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* 人気の人物 */}
        <section style={{ marginBottom: '48px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
            }}
          >
            <h2 className="section-heading" style={{ marginBottom: 0 }}>
              人気の人物
            </h2>
            <Link
              href="/search"
              className="theme-text-link"
              style={{ fontSize: '14px', fontWeight: 500, textDecoration: 'none' }}
            >
              全員を見る →
            </Link>
          </div>

          <div className="persons-grid">
            {featured.map((person) => (
              <HomePersonCard key={person.name} person={person} />
            ))}
          </div>
        </section>

        {/* グループで探す */}
        <section>
          <h2 className="section-heading">グループで探す</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {groups.map((group) => (
              <Link
                key={group}
                href={`/group/${encodeURIComponent(group)}`}
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
                {group}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
