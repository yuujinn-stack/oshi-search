'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

// グループ名 → /group/ へ、個人名 → /search?q= へ（URL一貫性のため）
const POPULAR_ITEMS: Array<{ label: string; href: string }> = [
  { label: '乃木坂46',   href: '/group/%E4%B9%83%E6%9C%A8%E5%9D%8246' },
  { label: '櫻坂46',     href: '/group/%E6%AB%BB%E5%9D%8246' },
  { label: '日向坂46',   href: '/group/%E6%97%A5%E5%90%91%E5%9D%8246' },
  { label: 'オードリー', href: '/group/%E3%82%AA%E3%83%BC%E3%83%89%E3%83%AA%E3%83%BC' },
  { label: 'バナナマン', href: '/group/%E3%83%90%E3%83%8A%E3%83%8A%E3%83%9E%E3%83%B3' },
  { label: 'あの',       href: '/search?q=%E3%81%82%E3%81%AE' },
];

export default function HeroSearchForm() {
  const [query, setQuery] = useState('');
  const router = useRouter();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
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
          検索する
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
        {POPULAR_ITEMS.map(({ label, href }) => (
          <a
            key={label}
            href={href}
            className="hero-keyword-chip"
            style={{ textDecoration: 'none' }}
          >
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}
