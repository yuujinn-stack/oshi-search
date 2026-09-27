import Link from 'next/link';
import HomePersonCard from '@/components/site/HomePersonCard';
import RankingPersonCard from '@/components/site/RankingPersonCard';
import type { RankedPerson, RankedWork } from '@/lib/ranking';
import type { PersonCardData } from '@/lib/persons';

// ─────────────────────────────────────────────────────────────────────────────
// トップページから外した「推し発見型」セクション群（2026-09 トップページ再設計）。
// トップページは「すでに推しがいるユーザーが自分の推しをすぐ探せる」構成に変更したため、
// 以下4セクションは現在どこからもレンダリングしていない。今後復活させる可能性があるため、
// 旧 src/app/page.tsx の実装をそのまま移設して保持している。
//
// 復活させる場合:
//   - PopularPersonsSection / RisingPersonsSection / PopularWorksSection には
//     getRankingData()（src/lib/ranking.ts）の popularPersons / risingPersons / popularWorks を渡す。
//     トップページは現在 getHomeRankingData()（軽量版）を使っているため、取得関数も戻すこと。
//   - FeaturedPersonsSection には getAllPersonsEnrichedWithGenres() の persons.slice(0, 12) を渡す。
// ─────────────────────────────────────────────────────────────────────────────

const WORK_TYPE_LABEL: Record<string, string> = {
  movie: '映画', tv: 'ドラマ', variety: 'バラエティ', anime: 'アニメ',
};

// ─── 共通セクションヘッダー ──────────────────────────────────────────────────────
function SectionHeader({ title, href, linkText }: { title: string; href?: string; linkText?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 16px', marginBottom: '16px',
    }}>
      <h2 className="section-heading" style={{ marginBottom: 0, fontSize: '16px', fontWeight: 700 }}>{title}</h2>
      {href && linkText && (
        <Link href={href} className="theme-text-link" style={{ fontSize: '13px', fontWeight: 500, textDecoration: 'none' }}>
          {linkText}
        </Link>
      )}
    </div>
  );
}

// ─── 🔥 今人気の人物 ─────────────────────────────────────────────────────────────
export function PopularPersonsSection({ popularPersons }: { popularPersons: RankedPerson[] }) {
  return (
    <section style={{ background: 'var(--ds-surface)', borderBottom: '1px solid var(--ds-border)', paddingTop: '24px', paddingBottom: '32px' }}>
      <div style={{ maxWidth: '1152px', margin: '0 auto' }}>
        <SectionHeader title="🔥 今人気の人物" href="/search" linkText="全員を見る →" />
        <div className="persons-row">
          {popularPersons.map((person, i) => (
            <div key={person.name} className="persons-row-item">
              <RankingPersonCard person={person} rank={i + 1} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 📈 急上昇 ───────────────────────────────────────────────────────────────────
export function RisingPersonsSection({ risingPersons }: { risingPersons: RankedPerson[] }) {
  return (
    <section style={{ background: 'var(--ds-bg)', borderBottom: '1px solid var(--ds-border)', paddingTop: '24px', paddingBottom: '32px' }}>
      <div style={{ maxWidth: '1152px', margin: '0 auto' }}>
        <SectionHeader title="📈 急上昇" href="/search" linkText="もっと見る →" />
        <div className="persons-row">
          {risingPersons.map((person, i) => (
            <div key={person.name} className="persons-row-item">
              <RankingPersonCard person={person} rank={i + 1} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 🎬 人気作品 ─────────────────────────────────────────────────────────────────
export function PopularWorksSection({ popularWorks }: { popularWorks: RankedWork[] }) {
  if (popularWorks.length === 0) return null;
  return (
    <section style={{ background: 'var(--ds-bg)', borderBottom: '1px solid var(--ds-border)', paddingTop: '24px', paddingBottom: '32px' }}>
      <div style={{ maxWidth: '1152px', margin: '0 auto', padding: '0 16px' }}>
        <h2 className="section-heading" style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🎬 人気作品</h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: '12px',
        }}>
          {popularWorks.map((work) => (
            <Link
              key={work.workId}
              href={work.detailUrl}
              className="theme-card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                textDecoration: 'none',
                overflow: 'hidden',
                borderRadius: 'var(--ds-radius)',
              }}
            >
              {/* ポスター */}
              {work.posterUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={work.posterUrl}
                  alt={work.title}
                  loading="lazy"
                  style={{
                    width: '100%',
                    aspectRatio: work.posterUrl.includes('image.tmdb.org') ? '2/3' : '16/9',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <div style={{
                  width: '100%',
                  aspectRatio: '2/3',
                  background: 'linear-gradient(135deg, var(--ds-primary-soft), var(--ds-border))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '32px',
                }}>
                  🎬
                </div>
              )}
              {/* テキスト */}
              <div style={{ padding: '10px', flex: 1 }}>
                <p style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: 'var(--ds-text)',
                  lineHeight: 1.4,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical' as const,
                  overflow: 'hidden',
                  marginBottom: '4px',
                }}>
                  {work.title}
                </p>
                <p style={{ fontSize: '10px', color: 'var(--ds-muted)' }}>
                  {work.personName}
                  {work.workType && (
                    <span style={{
                      marginLeft: '6px',
                      background: 'var(--ds-primary-soft)',
                      color: 'var(--ds-primary)',
                      borderRadius: '4px',
                      padding: '1px 5px',
                      fontSize: '9px',
                      fontWeight: 600,
                    }}>
                      {WORK_TYPE_LABEL[work.workType] ?? work.workType}
                    </span>
                  )}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 注目の人物 ─────────────────────────────────────────────────────────────────
export function FeaturedPersonsSection({ featured }: { featured: PersonCardData[] }) {
  return (
    <section style={{ marginBottom: '48px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 className="section-heading" style={{ marginBottom: 0, fontSize: '16px', fontWeight: 700 }}>注目の人物</h2>
        <Link href="/search" className="theme-text-link" style={{ fontSize: '14px', fontWeight: 500, textDecoration: 'none' }}>
          全員を見る →
        </Link>
      </div>
      <div className="persons-grid">
        {featured.map((person) => (
          <HomePersonCard key={person.name} person={person} />
        ))}
      </div>
    </section>
  );
}
