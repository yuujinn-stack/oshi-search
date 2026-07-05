import Link from 'next/link';
import { getAllPersonsEnrichedWithGenres } from '@/lib/persons';
import { getRankingData } from '@/lib/ranking';
import HeroSearchForm from '@/components/site/HeroSearchForm';
import HomePersonCard from '@/components/site/HomePersonCard';
import RankingPersonCard from '@/components/site/RankingPersonCard';
import type { SuggestionItem } from '@/types/search';

export const revalidate = 60;

const GENRE_EMOJI: Record<string, string> = {
  '坂道': '🌸',
  'アイドル': '⭐',
  '元アイドル': '🌟',
  '女優': '🎭',
  '俳優': '🎬',
  'タレント': '✨',
  'モデル': '👗',
  '歌手': '🎤',
  'アーティスト': '🎵',
  '声優': '🎙️',
  '芸人': '😄',
  'テレビ': '📺',
  'バラエティ': '🎪',
  'アナウンサー': '📢',
  '作家': '📝',
  '小説家': '📚',
  '漫画家': '✏️',
  '脚本家': '📄',
  '映画監督': '🎥',
  '監督': '🎥',
  'プロデューサー': '🎬',
  'クリエイター': '💡',
  'YouTuber': '▶️',
  'インフルエンサー': '📱',
  'ダンサー': '💃',
  'スポーツ選手': '🏃',
  'アスリート': '🏆',
};

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

// ─── ページ ──────────────────────────────────────────────────────────────────────
export default async function HomePage() {
  const [{ persons, genres: allGenres }, ranking] = await Promise.all([
    getAllPersonsEnrichedWithGenres(),
    getRankingData(),
  ]);

  const groups = [...new Set(persons.map((p) => p.group).filter(Boolean))];

  const heroSuggestions: SuggestionItem[] = [
    ...groups.map((g) => ({ label: g, href: `/group/${encodeURIComponent(g)}`, type: 'group' as const })),
    ...persons.flatMap((p) => [
      { label: p.name, sublabel: p.group || undefined, href: `/person/${encodeURIComponent(p.name)}`, type: 'person' as const },
      ...(p.config.aliases ?? []).map((a) => ({
        label: a, sublabel: p.name, href: `/search?q=${encodeURIComponent(a)}`, type: 'alias' as const,
      })),
    ]),
  ];

  const { popularPersons, risingPersons, popularSearches, popularWorks, popularProducts } = ranking;

  // フォールバック（データなし時に使う人物）
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
          <h1 style={{
            fontSize: 'clamp(22px, 5vw, 38px)',
            fontWeight: 900,
            color: '#fff',
            marginBottom: '10px',
            letterSpacing: '-0.02em',
            lineHeight: 1.25,
          }}>
            推しの出演作品・写真集・CD・<wbr />配信情報をまとめて検索
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.78)', marginBottom: '32px', fontSize: '15px', lineHeight: 1.65 }}>
            楽天の商品も、出演作品も、配信サービスも一度に探せます。
          </p>
          <HeroSearchForm suggestions={heroSuggestions} />
        </div>
      </section>

      {/* ━━━ スタッツバー ━━━ */}
      <div className="hero-stats-bar">
        <div className="hero-stat">
          <span className="hero-stat-num">{persons.length}</span>
          <span className="hero-stat-label">登録タレント</span>
        </div>
        <div className="hero-stat-divider" aria-hidden="true" />
        <div className="hero-stat">
          <span className="hero-stat-num">{groups.length}</span>
          <span className="hero-stat-label">グループ対応</span>
        </div>
        <div className="hero-stat-divider" aria-hidden="true" />
        <div className="hero-stat">
          <span className="hero-stat-num">楽天</span>
          <span className="hero-stat-label">商品情報を網羅</span>
        </div>
        <div className="hero-stat-divider" aria-hidden="true" />
        <div className="hero-stat">
          <span className="hero-stat-num">VOD</span>
          <span className="hero-stat-label">配信先をまとめて確認</span>
        </div>
      </div>

      {/* ━━━ 🔥 今人気の人物 ━━━ */}
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

      {/* ━━━ 📈 急上昇 ━━━ */}
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

      {/* ━━━ 🔍 人気検索 ━━━ */}
      {popularSearches.length > 0 && (
        <section style={{ background: 'var(--ds-surface)', borderBottom: '1px solid var(--ds-border)', paddingTop: '24px', paddingBottom: '32px' }}>
          <div style={{ maxWidth: '1152px', margin: '0 auto', padding: '0 16px' }}>
            <h2 className="section-heading" style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🔍 人気検索</h2>
            <div
              className="scrollbar-none"
              style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}
            >
              {popularSearches.map(({ keyword }, i) => (
                <Link
                  key={keyword}
                  href={`/search?q=${encodeURIComponent(keyword)}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '7px 14px',
                    borderRadius: '999px',
                    fontSize: '13px',
                    fontWeight: 600,
                    textDecoration: 'none',
                    border: '1.5px solid var(--ds-border)',
                    background: 'var(--ds-bg)',
                    color: 'var(--ds-text)',
                    transition: 'border-color 0.15s, color 0.15s',
                    minHeight: '36px',
                  }}
                  className="theme-search-chip"
                >
                  <span style={{ fontSize: '10px', color: 'var(--ds-muted)', fontWeight: 500, minWidth: '14px' }}>{i + 1}</span>
                  {keyword}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ━━━ 🎬 人気作品 ━━━ */}
      {popularWorks.length > 0 && (
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
      )}

      {/* ━━━ 🛍 人気商品 ━━━ */}
      {popularProducts.length > 0 && (
        <section style={{ background: 'var(--ds-surface)', borderBottom: '1px solid var(--ds-border)', paddingTop: '24px', paddingBottom: '32px' }}>
          <div style={{ maxWidth: '1152px', margin: '0 auto', padding: '0 16px' }}>
            <h2 className="section-heading" style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>🛍 人気商品</h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '10px',
            }}
              className="popular-products-grid"
            >
              {popularProducts.map((product) => {
                const href = product.affiliateUrl || (product.personSlug ? `/person/${encodeURIComponent(product.personSlug)}` : '/search');
                const isExternal = !!product.affiliateUrl;
                return (
                  <a
                    key={product.productId}
                    href={href}
                    target={isExternal ? '_blank' : undefined}
                    rel={isExternal ? 'noopener noreferrer sponsored' : undefined}
                    className="theme-card"
                    style={{
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'center',
                      padding: '10px',
                      textDecoration: 'none',
                      borderRadius: 'var(--ds-radius)',
                    }}
                  >
                    {/* 画像 */}
                    <div style={{
                      width: '52px',
                      height: '52px',
                      flexShrink: 0,
                      borderRadius: '8px',
                      overflow: 'hidden',
                      background: 'var(--ds-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      {product.imageUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={product.imageUrl}
                          alt={product.title}
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '2px' }}
                        />
                      ) : (
                        <span style={{ fontSize: '20px' }}>🛒</span>
                      )}
                    </div>
                    {/* テキスト */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--ds-text)',
                        lineHeight: 1.4,
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical' as const,
                        marginBottom: '3px',
                      }}>
                        {product.title}
                      </p>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {product.personSlug && (
                          <span style={{ fontSize: '10px', color: 'var(--ds-muted)' }}>{product.personSlug}</span>
                        )}
                        {product.category && (
                          <span style={{
                            fontSize: '9px',
                            fontWeight: 600,
                            background: 'var(--ds-primary-soft)',
                            color: 'var(--ds-primary)',
                            borderRadius: '4px',
                            padding: '1px 5px',
                          }}>
                            {product.category}
                          </span>
                        )}
                      </div>
                      {isExternal && (
                        <span style={{ fontSize: '9px', color: 'var(--ds-cta)', fontWeight: 600, marginTop: '2px', display: 'block' }}>
                          楽天で見る →
                        </span>
                      )}
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ━━━ メインコンテンツ ━━━ */}
      <div style={{ maxWidth: '1152px', margin: '0 auto', padding: 'clamp(32px, 5vw, 56px) 16px' }}>

        {/* ジャンルで探す */}
        <section style={{ marginBottom: '48px' }}>
          <h2 className="section-heading" style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>ジャンルで探す</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {allGenres.map((genre) => (
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

        {/* 注目の人物 */}
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

        {/* グループで探す */}
        <section>
          <h2 className="section-heading" style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>グループで探す</h2>
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
