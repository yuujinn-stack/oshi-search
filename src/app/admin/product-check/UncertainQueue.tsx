'use client';

import { useState } from 'react';
import type { UncertainItem } from '@/app/api/admin/uncertain/route';

export default function UncertainQueue() {
  const [items, setItems] = useState<UncertainItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setMessage('');
    const res = await fetch('/api/admin/uncertain');
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    } else {
      setMessage('取得に失敗しました');
    }
    setLoading(false);
  }

  async function handleVerdict(personName: string, productId: string, verdict: 'related' | 'unrelated', score: number) {
    const res = await fetch('/api/admin/verdict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, productId, verdict, score }),
    });
    if (res.ok) {
      setItems((prev) => prev.filter((item) => item.product.id !== productId || item.personName !== personName));
      setTotal((prev) => (prev !== null ? prev - 1 : null));
    } else {
      setMessage('保存に失敗しました');
    }
  }

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-5 mb-8">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="font-bold text-yellow-900 text-sm">
            🤖 AI判定待ち
            {total !== null && (
              <span className="ml-2 bg-yellow-200 text-yellow-800 text-xs px-2 py-0.5 rounded-full">
                {total}件
              </span>
            )}
          </h2>
          <p className="text-xs text-yellow-700 mt-0.5">
            AI が確信できなかった商品です。採用か非表示を選んでください。
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-xs px-3 py-1.5 bg-yellow-200 hover:bg-yellow-300 text-yellow-800 font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? '読み込み中...' : total === null ? '一覧を読み込む' : '再読み込み'}
        </button>
      </div>

      {message && <p className="text-xs text-red-500 mb-2">{message}</p>}

      {total === 0 && (
        <p className="text-sm text-yellow-600 text-center py-3">AI判定待ちの商品はありません ✓</p>
      )}

      {items.length > 0 && (
        <div className="space-y-2 mt-3">
          {items.map((item) => (
            <div
              key={`${item.personName}-${item.product.id}`}
              className="flex items-start gap-3 p-2.5 rounded-lg bg-white border border-yellow-200 text-xs"
            >
              {item.product.imageUrl && (
                <img src={item.product.imageUrl} alt="" className="w-9 h-11 object-cover rounded flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-700 text-xs mb-0.5">{item.personName}</p>
                <p className="line-clamp-2 text-slate-600 leading-tight">{item.product.title}</p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-gray-400">{item.product.category}</span>
                  <span className="font-mono text-yellow-600">AIスコア {item.verdict.score}</span>
                  {item.verdict.reason && (
                    <span className="text-gray-500 italic">{item.verdict.reason}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1 flex-shrink-0">
                <button
                  onClick={() => handleVerdict(item.personName, item.product.id, 'related', item.verdict.score)}
                  className="text-xs px-2 py-1 rounded bg-green-100 hover:bg-green-200 text-green-700 font-medium"
                >
                  採用
                </button>
                <button
                  onClick={() => handleVerdict(item.personName, item.product.id, 'unrelated', item.verdict.score)}
                  className="text-xs px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 font-medium"
                >
                  非表示
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
