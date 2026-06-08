'use client';

import { useState } from 'react';
import type { RakutenItem } from '@/types/rakuten';
import type { JudgmentRecord, Verdict } from '@/lib/judgment-store';

interface ProductWithVerdict extends RakutenItem {
  judgment?: JudgmentRecord;
}

interface CategoryData {
  status: string;
  products: RakutenItem[];
}

interface PersonData {
  person: { name: string; group: string; config: { strictMode?: boolean; customKeywords?: string[] } };
  categories: Record<string, CategoryData>;
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

const CATEGORIES = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ'] as const;

export default function PersonProducts({ personName }: { personName: string }) {
  const [data, setData] = useState<PersonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [judging, setJudging] = useState(false);
  const [open, setOpen] = useState(false);
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
    if (!open) await load();
    setOpen((v) => !v);
  }

  async function handleRejudge() {
    setJudging(true);
    setMessage('');
    const res = await fetch('/api/admin/rejudge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, onlyBorderline: true }),
    });
    const result = await res.json().catch(() => ({}));
    if (res.ok) {
      setMessage(`AI判定完了: ${(result as { judged?: number }).judged ?? 0}件を判定`);
      await load(); // 最新データで再描画
    } else {
      setMessage((result as { error?: string }).error ?? 'AI判定に失敗しました');
    }
    setJudging(false);
  }

  async function handleVerdict(productId: string, verdict: Verdict, score: number) {
    const res = await fetch('/api/admin/verdict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personName, productId, verdict, score }),
    });
    if (res.ok) {
      await load();
    }
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

  function getScoreColor(score: number) {
    if (score >= threshold) return 'text-green-600';
    if (score >= 0) return 'text-yellow-600';
    return 'text-red-600';
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="font-medium text-slate-700 text-sm">{personName}</span>
        <span className="text-gray-400 text-xs">{open ? '▲ 閉じる' : '▼ 商品を確認する'}</span>
      </button>

      {open && (
        <div className="p-4 space-y-4">
          {/* アクションバー */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={load}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-slate-600 transition-colors disabled:opacity-50"
            >
              {loading ? '取得中...' : '再取得'}
            </button>
            <button
              onClick={handleRejudge}
              disabled={judging || loading}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium transition-colors disabled:opacity-50"
            >
              {judging ? 'AI判定中...' : '🤖 曖昧な商品をAI判定'}
            </button>
            {strictMode && (
              <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">
                strictMode（閾値{threshold}点）
              </span>
            )}
            {message && <span className="text-xs text-indigo-600">{message}</span>}
          </div>

          {/* カテゴリ別商品リスト */}
          {data && CATEGORIES.map((cat) => {
            const catData = data.categories[cat];
            if (!catData || catData.status !== 'ok' || catData.products.length === 0) {
              return (
                <div key={cat}>
                  <h3 className="text-xs font-bold text-gray-500 uppercase mb-1">{cat}</h3>
                  <p className="text-xs text-gray-400 pl-2">
                    {catData?.status === 'error' ? 'API エラー' : '商品なし'}
                  </p>
                </div>
              );
            }

            const products: ProductWithVerdict[] = catData.products.map((p) => ({
              ...p,
              judgment: data.verdicts[p.id],
            }));

            return (
              <div key={cat}>
                <h3 className="text-xs font-bold text-gray-500 mb-2">{cat}（{products.length}件）</h3>
                <div className="space-y-2">
                  {products.map((p) => {
                    const isDisplayed = p.judgment
                      ? p.judgment.verdict !== 'unrelated'
                      : p.relevanceScore >= threshold;
                    return (
                      <div
                        key={p.id}
                        className={`flex items-start gap-3 p-2 rounded-lg text-xs border ${isDisplayed ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-200 opacity-60'}`}
                      >
                        {/* サムネイル */}
                        {p.imageUrl && (
                          <img src={p.imageUrl} alt="" className="w-10 h-12 object-cover rounded flex-shrink-0" />
                        )}
                        {/* 商品情報 */}
                        <div className="flex-1 min-w-0">
                          <p className="line-clamp-2 text-slate-700 font-medium">{p.title}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {/* スコア */}
                            <span className={`font-mono ${getScoreColor(p.relevanceScore)}`}>
                              スコア: {p.relevanceScore}
                            </span>
                            {/* AI/手動判定バッジ */}
                            {p.judgment && (
                              <span className={`px-1.5 py-0.5 rounded text-xs ${VERDICT_BADGE[p.judgment.verdict]}`}>
                                {p.judgment.source === 'ai' ? '🤖' : '👤'} {VERDICT_LABEL[p.judgment.verdict]}
                                {p.judgment.reason ? ` (${p.judgment.reason})` : ''}
                              </span>
                            )}
                            {/* 表示状態 */}
                            <span className={`px-1.5 py-0.5 rounded ${isDisplayed ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                              {isDisplayed ? '表示中' : '非表示'}
                            </span>
                          </div>
                        </div>
                        {/* 手動判定ボタン */}
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleVerdict(p.id, 'relevant', p.relevanceScore)}
                            className="text-xs px-2 py-0.5 rounded bg-green-100 hover:bg-green-200 text-green-700"
                          >
                            関連あり
                          </button>
                          <button
                            onClick={() => handleVerdict(p.id, 'unrelated', p.relevanceScore)}
                            className="text-xs px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 text-red-700"
                          >
                            無関係
                          </button>
                          {p.judgment && (
                            <button
                              onClick={() => handleDeleteVerdict(p.id)}
                              className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-500"
                            >
                              リセット
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
