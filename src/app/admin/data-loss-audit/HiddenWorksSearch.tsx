'use client';
import { useState, useMemo } from 'react';

export interface HiddenWorkRecord {
  person_name: string;
  id: string;
  title: string;
  type: string;
  source: string;
  status: string;
  checked_at: string | null;
  created_at: string;
  updated_at: string;
  ai_reason: string | null;
  ai_decision: string | null;
  vod_providers_count: number;
  exclude_reason: string;
}

function fmt(ts: unknown): string {
  if (!ts) return '—';
  if (typeof ts === 'string') return ts.slice(0, 19).replace('T', ' ');
  return String(ts);
}

export default function HiddenWorksSearch({ works }: { works: HiddenWorkRecord[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return works;
    return works.filter(
      (w) =>
        w.person_name.toLowerCase().includes(q) ||
        w.title.toLowerCase().includes(q) ||
        w.id.toLowerCase().includes(q),
    );
  }, [works, query]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="人物名・作品名・workId で検索…"
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <span className="text-xs text-gray-500 flex-shrink-0">
          {filtered.length} / {works.length} 件
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-gray-400 py-4 text-center">
          {query ? '条件に一致する作品が見つかりません' : 'hidden 作品はありません'}
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto border border-orange-100 rounded-lg">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-orange-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 font-semibold">人物名</th>
                <th className="px-3 py-2 font-semibold">ID</th>
                <th className="px-3 py-2 font-semibold">タイトル</th>
                <th className="px-3 py-2 font-semibold">source</th>
                <th className="px-3 py-2 font-semibold">type</th>
                <th className="px-3 py-2 font-semibold">checked_at</th>
                <th className="px-3 py-2 font-semibold">作成日</th>
                <th className="px-3 py-2 font-semibold">更新日</th>
                <th className="px-3 py-2 font-semibold">AI判定理由</th>
                <th className="px-3 py-2 font-semibold">公開除外理由</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => (
                <tr
                  key={`${w.person_name}:${w.id}`}
                  className="border-t border-orange-50 hover:bg-orange-50/40"
                >
                  <td className="px-3 py-2 whitespace-nowrap">{w.person_name}</td>
                  <td className="px-3 py-2 font-mono text-gray-500 whitespace-nowrap max-w-[180px] truncate">
                    {w.id}
                  </td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={w.title}>
                    {w.title}
                  </td>
                  <td className={`px-3 py-2 font-mono whitespace-nowrap ${w.source === 'manual_csv' ? 'text-orange-700 font-semibold' : 'text-gray-500'}`}>
                    {w.source}
                  </td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap">{w.type}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{fmt(w.checked_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{fmt(w.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{fmt(w.updated_at)}</td>
                  <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate" title={w.ai_reason ?? ''}>
                    {w.ai_reason ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-orange-700 max-w-[220px] truncate" title={w.exclude_reason}>
                    {w.exclude_reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
