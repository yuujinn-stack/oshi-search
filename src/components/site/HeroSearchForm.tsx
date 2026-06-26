'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const POPULAR_KEYWORDS = [
  '乃木坂46', '櫻坂46', '日向坂46', 'オードリー', 'バナナマン', 'あの',
];

export default function HeroSearchForm() {
  const [query, setQuery] = useState('');
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  }

  function handlePopular(kw: string) {
    router.push(`/search?q=${encodeURIComponent(kw)}`);
  }

  return (
    <div>
      {/* 検索フォーム */}
      <form onSubmit={handleSubmit} className="hero-search-form">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="人物名・グループ名・作品名で検索"
          className="hero-search-input"
          style={{ fontSize: '16px' }}
          autoComplete="off"
        />
        <button type="submit" className="hero-search-btn">
          検索
        </button>
      </form>

      {/* 人気キーワード */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        justifyContent: 'center',
        marginTop: '16px',
      }}>
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '12px', alignSelf: 'center' }}>
          人気:
        </span>
        {POPULAR_KEYWORDS.map((kw) => (
          <button
            key={kw}
            type="button"
            onClick={() => handlePopular(kw)}
            className="hero-keyword-chip"
          >
            {kw}
          </button>
        ))}
      </div>
    </div>
  );
}
