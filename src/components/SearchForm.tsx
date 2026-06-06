'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  defaultValue?: string;
  compact?: boolean;
}

export default function SearchForm({ defaultValue = '', compact = false }: Props) {
  const [query, setQuery] = useState(defaultValue);
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 w-full">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="人物名・グループ名・ジャンルで検索"
        className={`flex-1 border border-gray-300 rounded-full px-5 text-slate-800 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent ${
          compact ? 'py-2 text-sm' : 'py-4'
        }`}
        style={{ fontSize: '16px' }}
      />
      <button
        type="submit"
        className={`bg-primary text-white rounded-full font-bold whitespace-nowrap hover:bg-indigo-700 active:bg-indigo-800 transition-colors flex items-center justify-center ${
          compact ? 'px-4 py-2 text-sm' : 'px-7 py-4'
        }`}
        style={{ minHeight: '44px', minWidth: '44px' }}
      >
        検索
      </button>
    </form>
  );
}
