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

interface SearchTestItem {
  title: string;
  author?: string;
  artistName?: string;
  itemUrl: string;
  price: number;
}

interface SearchTestResult {
  keyword: string;
  paramType: string;
  api: string;
  count: number;
  items: SearchTestItem[];
  error?: string;
}

interface SearchTestData {
  person: { name: string; group: string };
  searches: SearchTestResult[];
  summary: { totalSearches: number; withResults: number; apiErrors: number };
}

const VERDICT_BADGE: Record<Verdict, string> = {
  related: 'bg-green-100 text-green-700',
  uncertain: 'bg-yellow-100 text-yellow-700',
  unrelated: 'bg-red-100 text-red-700',
};
const VERDICT_LABEL: Record<Verdict, string> = {
  related: '関連あり',
  uncertain: 'AI判定待ち',
  unrelated: '非表示',
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
  const [filter, setFilter] = useState<'uncertain' | 'all'>('uncertain');
  const [message, setMessage] = useState('');
  const [searchTest, setSearchTest] = useState<SearchTestData | null>(null);
  const [searchTestLoading, setSearchTestLoading] = useState(false);

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

  async function handleSearchTest() {
    setSearchTestLoading(true);
    setSearchTest(null);
    const res = await fetch(`/api/admin/search-test?person=${encodeURIComponent(personName)}`);
    if (res.ok) {
      setSearchTest(await res.json());
    } else {
      setMessage('検索テスト失敗');
    }
    setSearchTestLoading(false);
  }

  // フィルタ適用
  const filteredProducts = (data: AdminData) =>
    CATEGORIES.flatMap((cat) => {
      const catData = data.categories[cat];
      if (!catData || catData.status !== 'ok') return [];
      return catData.products
        .map((p) => ({ ...p, catLabel: cat, judgment: data.verdicts[p.id] }))
        .filter((p) => {
          if (filter === 'uncertain') return p.judgment?.verdict === 'uncertain';
          return true;
        });
    });

  const uncertainCount = data
    ? Object.values(data.verdicts).filter((v) => v.verdict === 'uncertain').length
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
          {data && uncertainCount > 0 && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
              AI判定待ち {uncertainCount}件
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
            <button
              onClick={handleSearchTest}
              disabled={searchTestLoading}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 transition-colors disabled:opacity-50"
              title="楽天APIを複数キーワードで実行して取得漏れを診断（Redis保存なし）"
            >
              {searchTestLoading ? '検索中...' : '🔍 検索テスト'}
            </button>
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs ml-auto">
              <button
                onClick={() => setFilter('uncertain')}
                className={`px-3 py-1.5 ${filter === 'uncertain' ? 'bg-yellow-50 text-yellow-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                AI判定待ちのみ
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

          {/* 検索テスト結果 */}
          {searchTest && (
            <div className="border border-blue-100 rounded-xl bg-blue-50/40 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-blue-800">
                  🔍 検索テスト結果（楽天API実行 / Redis保存なし）
                </p>
                <div className="text-xs text-blue-600">
                  {searchTest.summary.totalSearches}種 / ヒット{searchTest.summary.withResults}種
                  {searchTest.summary.apiErrors > 0 && (
                    <span className="text-red-500 ml-2">エラー{searchTest.summary.apiErrors}件</span>
                  )}
                </div>
              </div>
              <div className="space-y-1 max-h-80 overflow-y-auto">
                {searchTest.searches.map((s, i) => (
                  <div
                    key={i}
                    className={`text-xs px-3 py-2 rounded-lg ${s.count > 0 ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-gray-600">{s.paramType}</span>
                      <span className={`font-bold ${s.count > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                        {s.error ? `エラー: ${s.error}` : `${s.count}件`}
                      </span>
                    </div>
                    {s.count > 0 && (
                      <ul className="mt-1 space-y-0.5 pl-2">
                        {s.items.slice(0, 5).map((item, j) => (
                          <li key={j} className="text-gray-700 truncate">
                            <a href={item.itemUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {item.title}
                            </a>
                            {item.author && <span className="text-gray-400 ml-1">({item.author})</span>}
                            {item.artistName && <span className="text-gray-400 ml-1">({item.artistName})</span>}
                          </li>
                        ))}
                        {s.items.length > 5 && (
                          <li className="text-gray-400">… 他 {s.items.length - 5}件</li>
                        )}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-blue-500">
                ※ここに表示されない商品は楽天API段階で取得されていません。AI判定ボタンで全件保存・判定してください。
              </p>
            </div>
          )}

          {/* 商品リスト */}
          {data && (() => {
            const products = filteredProducts(data);
            if (products.length === 0) {
              return (
                <p className="text-sm text-gray-400 text-center py-4">
                  {filter === 'uncertain' ? 'AI判定待ちの商品はありません ✓' : 'バッチ処理を実行してください'}
                </p>
              );
            }
            return (
              <div className="space-y-2">
                {products.map((p) => {
                  const isShown = p.judgment?.verdict === 'related';
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
                          <span className="font-mono text-gray-400">
                            score {p.relevanceScore}
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
                          onClick={() => handleVerdict(p.id, 'related', p.relevanceScore)}
                          disabled={p.judgment?.verdict === 'related'}
                          className="text-xs px-2 py-1 rounded bg-green-100 hover:bg-green-200 text-green-700 disabled:opacity-40"
                        >
                          採用
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
