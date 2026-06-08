'use client';

import { useState } from 'react';
import type { RakutenItem } from '@/types/rakuten';
import type { JudgmentRecord, Verdict } from '@/lib/judgment-store';

interface ProductData {
  status: string;
  products: RakutenItem[];
}

interface AdminData {
  person: { name: string; group: string; config: { strictMode?: boolean } };
  categories: Record<string, ProductData>;
  verdicts: Record<string, JudgmentRecord>;
}

const VERDICT_BADGE: Record<Verdict, string> = {
  relevant: 'bg-green-100 text-green-700',
  maybe: 'bg-yellow-100 text-yellow-700',
  unrelated: 'bg-red-100 text-red-700',
};
const VERDICT_LABEL: Record<Verdict, string> = {
  relevant: '関連あり',
  maybe: '要確認',
  unrelated: '無関係',
};
const SOURCE_ICON: Record<string, string> = {
  auto: '⚙️',
  ai: '🤖',
  manual: '👤',
};

const CATEGORIES = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ'] as const;

export default function PersonProducts({ personName }: { personName: string }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'maybe' | 'all'>('maybe');
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setMessage('');
    const res = await fetch(`/api/admin/products?person=${encodeURIComponent(personName)}`);
    if (res.ok) {
      setData(await res.json());
    } else {
      setMessage('取得に失敗しました');
    }
    setLoading(false);
  }

  async function handleOpen() {
    if (!open && !data) await load();
    setOpen((v) => !v);
  }

  async function handleVerdict(productId: string, verdict: Verdict, score: number) {
    const res = await fetch('/api/admin/verdict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, productId, verdict, score }),
    });
    if (res.ok) await load();
  }

  async function handleDeleteVerdict(productId: string) {
    const res = await fetch('/api/admin/verdict', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, productId }),
    });
    if (res.ok) await load();
  }

  const strictMode = data?.person.config.strictMode ?? false;
  const threshold = strictMode ? 50 : 20;

  // フィルタ適用
  const filteredProducts = (data: AdminData) =>
    CATEGORIES.flatMap((cat) => {
      const catData = data.categories[cat];
      if (!catData || catData.status !== 'ok') return [];
      return catData.products
        .map((p) => ({ ...p, catLabel: cat, judgment: data.verdicts[p.id] }))
        .filter((p) => {
          if (filter === 'maybe') return p.judgment?.verdict === 'maybe' || !p.judgment;
          return true;
        });
    });

  const maybeCount = data
    ? Object.values(data.verdicts).filter((v) => v.verdict === 'maybe').length
    : 0;

  const unclassifiedCount = data
    ? CATEGORIES.flatMap((cat) => data.categories[cat]?.products ?? []).filter(
        (p) => !data.verdicts[p.id]
      ).length
    : 0;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* ヘッダー行 */}
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-sm font-medium text-slate-700">{personName}</span>
        <div className="flex items-center gap-2">
          {data && maybeCount > 0 && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
              要確認 {maybeCount}件
            </span>
          )}
          {data && unclassifiedCount > 0 && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              未判定 {unclassifiedCount}件
            </span>
          )}
          <span className="text-gray-400 text-xs ml-1">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* 展開パネル */}
      {open && (
        <div className="p-4 space-y-4 bg-white">
          {/* アクションバー */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={load}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-600 transition-colors disabled:opacity-50"
            >
              {loading ? '更新中...' : '再読み込み'}
            </button>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs ml-auto">
              <button
                onClick={() => setFilter('maybe')}
                className={`px-3 py-1.5 ${filter === 'maybe' ? 'bg-yellow-50 text-yellow-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                要確認のみ
              </button>
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 border-l border-gray-200 ${filter === 'all' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                全商品
              </button>
            </div>
            {message && <span className="text-xs text-red-500">{message}</span>}
          </div>

          {/* 商品リスト */}
          {data && (() => {
            const products = filteredProducts(data);
            if (products.length === 0) {
              return (
                <p className="text-sm text-gray-400 text-center py-4">
                  {filter === 'maybe' ? '要確認の商品はありません ✓' : 'バッチ処理を実行してください'}
                </p>
              );
            }
            return (
              <div className="space-y-2">
                {products.map((p) => {
                  const isShown = p.judgment?.verdict === 'relevant';
                  const isHidden = p.judgment?.verdict === 'unrelated';
                  return (
                    <div
                      key={p.id}
                      className={`flex items-start gap-3 p-2.5 rounded-lg text-xs border ${
                        isShown ? 'border-green-100 bg-green-50/50' :
                        isHidden ? 'border-red-100 bg-red-50/30 opacity-60' :
                        'border-yellow-100 bg-yellow-50/50'
                      }`}
                    >
                      {/* サムネイル */}
                      {p.imageUrl && (
                        <img src={p.imageUrl} alt="" className="w-9 h-11 object-cover rounded flex-shrink-0" />
                      )}
                      {/* 商品情報 */}
                      <div className="flex-1 min-w-0">
                        <p className="line-clamp-2 text-slate-700 font-medium leading-tight">{p.title}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <span className="text-gray-400">{p.catLabel}</span>
                          <span className={`font-mono ${p.relevanceScore >= threshold ? 'text-green-600' : p.relevanceScore < 0 ? 'text-red-500' : 'text-yellow-600'}`}>
                            {p.relevanceScore}点
                          </span>
                          {p.judgment ? (
                            <span className={`px-1.5 py-0.5 rounded ${VERDICT_BADGE[p.judgment.verdict]}`}>
                              {SOURCE_ICON[p.judgment.source]} {VERDICT_LABEL[p.judgment.verdict]}
                              {p.judgment.reason ? ` — ${p.judgment.reason}` : ''}
                            </span>
                          ) : (
                            <span className="text-gray-400 italic">未判定</span>
                          )}
                        </div>
                      </div>
                      {/* 判定ボタン */}
                      <div className="flex flex-col gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleVerdict(p.id, 'relevant', p.relevanceScore)}
                          disabled={p.judgment?.verdict === 'relevant'}
                          className="text-xs px-2 py-1 rounded bg-green-100 hover:bg-green-200 text-green-700 disabled:opacity-40"
                        >
                          表示
                        </button>
                        <button
                          onClick={() => handleVerdict(p.id, 'unrelated', p.relevanceScore)}
                          disabled={p.judgment?.verdict === 'unrelated'}
                          className="text-xs px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-40"
                        >
                          非表示
                        </button>
                        {p.judgment && (
                          <button
                            onClick={() => handleDeleteVerdict(p.id)}
                            className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-500"
                          >
                            リセット
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
