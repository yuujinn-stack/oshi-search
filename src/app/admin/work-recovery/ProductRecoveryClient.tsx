'use client';

import { useState } from 'react';
import type { OrphanStat, OrphanVerdict } from '@/app/api/admin/product-recovery/route';

interface Props {
  initialStats:  OrphanStat[];
  initialTotal:  number;
}

export default function ProductRecoveryClient({ initialStats, initialTotal }: Props) {
  const [stats]             = useState<OrphanStat[]>(initialStats);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrphanVerdict[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [redisResult, setRedisResult] = useState<{
    verdicts: OrphanVerdict[];
    summary: {
      total: number; classA: number; classE: number;
      redisKeyExists: boolean; redisCategories: string[];
    };
  } | null>(null);
  const [redisLoading, setRedisLoading] = useState(false);
  const [redisError, setRedisError] = useState('');

  async function loadDetail(personName: string) {
    setSelectedPerson(personName);
    setDetail(null);
    setRedisResult(null);
    setRedisError('');
    setDetailLoading(true);
    const res = await fetch(
      `/api/admin/product-recovery?type=orphan-detail&personName=${encodeURIComponent(personName)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { verdicts: OrphanVerdict[] };
      setDetail(data.verdicts);
    }
    setDetailLoading(false);
  }

  async function checkRedis() {
    if (!selectedPerson) return;
    setRedisLoading(true);
    setRedisError('');
    const res = await fetch(
      `/api/admin/product-recovery?type=redis-check&personName=${encodeURIComponent(selectedPerson)}`,
    );
    const data = (await res.json()) as {
      verdicts?: OrphanVerdict[];
      summary?:  { total: number; classA: number; classE: number; redisKeyExists: boolean; redisCategories: string[] };
      error?:    string;
    };
    if (res.ok && data.verdicts) {
      setRedisResult({ verdicts: data.verdicts, summary: data.summary! });
    } else {
      setRedisError(data.error ?? 'Redis 確認に失敗しました');
    }
    setRedisLoading(false);
  }

  return (
    <div className="space-y-6">
      {/* ── サマリー ── */}
      <div className="flex items-center gap-4 px-4 py-3 bg-orange-50 border border-orange-200 rounded-xl text-sm">
        <span className="text-orange-700 font-semibold">孤立 verdict 合計:</span>
        <span className="text-2xl font-bold text-orange-600">{initialTotal.toLocaleString()} 件</span>
        <span className="text-xs text-orange-500">
          （商品データが DB に存在しない verdict — 孤立状態）
        </span>
      </div>

      <p className="text-xs text-gray-500">
        ※ この画面は読み取り専用です。実際の復旧には楽天API再取得バッチの実行が必要です。
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── 人物一覧 ── */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            孤立 verdict がある人物 ({stats.length}人)
          </h3>
          <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[480px] overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-500">人物名</th>
                  <th className="px-3 py-2 text-right text-gray-500">孤立件数</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {stats.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-gray-400">
                      孤立 verdict がありません
                    </td>
                  </tr>
                ) : (
                  stats.map((s) => (
                    <tr
                      key={s.personName}
                      className={`border-t border-gray-100 ${
                        selectedPerson === s.personName ? 'bg-indigo-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-3 py-2 font-medium">{s.personName}</td>
                      <td className="px-3 py-2 text-right font-mono text-orange-600 font-semibold">
                        {s.orphanCount}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => void loadDetail(s.personName)}
                          disabled={detailLoading}
                          className="px-2 py-1 text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded transition-colors disabled:opacity-50"
                        >
                          詳細
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── 人物の詳細 ── */}
        <div>
          {selectedPerson ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">
                  {selectedPerson} の孤立 verdict
                </h3>
                <button
                  onClick={() => void checkRedis()}
                  disabled={redisLoading}
                  className="px-3 py-1.5 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {redisLoading ? 'Redis 確認中...' : 'Redis をスキャン'}
                </button>
              </div>

              {redisError && (
                <div className="text-xs text-red-600 px-3 py-2 bg-red-50 rounded-lg">
                  {redisError}
                </div>
              )}

              {/* Redis スキャン結果サマリー */}
              {redisResult && (
                <div className="px-3 py-2 bg-purple-50 border border-purple-200 rounded-xl text-xs space-y-1">
                  <p className="font-semibold text-purple-700">Redis スキャン結果</p>
                  <div className="flex gap-4 flex-wrap">
                    <span>合計: <strong>{redisResult.summary.total}</strong></span>
                    <span className="text-green-700">
                      A (Redis完全): <strong>{redisResult.summary.classA}</strong>
                    </span>
                    <span className="text-gray-600">
                      E (データなし): <strong>{redisResult.summary.classE}</strong>
                    </span>
                  </div>
                  <p className="text-purple-500">
                    Redis キー存在: {redisResult.summary.redisKeyExists ? '✓' : '✗'}
                    {redisResult.summary.redisCategories.length > 0 && (
                      <> / カテゴリ: {redisResult.summary.redisCategories.join(', ')}</>
                    )}
                  </p>
                </div>
              )}

              {/* 詳細リスト */}
              {detailLoading ? (
                <p className="text-sm text-gray-400">読み込み中...</p>
              ) : detail !== null ? (
                <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[380px] overflow-y-auto">
                  <table className="min-w-full text-xs">
                    <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-500">productId</th>
                        <th className="px-3 py-2 text-left text-gray-500">verdict</th>
                        <th className="px-3 py-2 text-left text-gray-500">分類</th>
                        <th className="px-3 py-2 text-left text-gray-500">Redis 情報</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.map((v) => {
                        const redis = redisResult?.verdicts.find((r) => r.productId === v.productId);
                        const cls   = redis?.classification ?? v.classification;
                        return (
                          <tr key={v.productId} className="border-t border-gray-100">
                            <td className="px-3 py-1.5 font-mono text-gray-500 max-w-[160px] truncate" title={v.productId}>
                              {v.productId}
                            </td>
                            <td className={`px-3 py-1.5 font-mono whitespace-nowrap ${
                              v.verdict === 'related' ? 'text-green-700' : 'text-gray-500'
                            }`}>
                              {v.verdict}
                            </td>
                            <td className="px-3 py-1.5">
                              <ClassBadge cls={cls} />
                            </td>
                            <td className="px-3 py-1.5 text-gray-500 max-w-[160px] truncate" title={redis?.redisTitle ?? ''}>
                              {redis?.redisTitle
                                ? <span className="text-green-700">{redis.redisTitle.slice(0, 30)}</span>
                                : cls === 'pending' ? '—' : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl">
              左から人物を選択してください
            </div>
          )}
        </div>
      </div>

      {/* ── 分類凡例 ── */}
      <div className="px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs">
        <p className="font-semibold text-gray-600 mb-2">分類凡例</p>
        <div className="flex flex-wrap gap-4">
          <span><ClassBadge cls="A" /> Redis に完全な商品情報あり → 楽天バッチ再取得で復旧可能</span>
          <span><ClassBadge cls="E" /> データなし → 完全消失（再取得のみ）</span>
          <span><ClassBadge cls="pending" /> 未確認（「Redis をスキャン」で分類）</span>
        </div>
      </div>
    </div>
  );
}

function ClassBadge({ cls }: { cls: OrphanVerdict['classification'] }) {
  const map: Record<string, string> = {
    A:       'bg-green-100 text-green-700',
    B:       'bg-blue-100 text-blue-700',
    C:       'bg-yellow-100 text-yellow-700',
    D:       'bg-orange-100 text-orange-700',
    E:       'bg-red-100 text-red-600',
    pending: 'bg-gray-100 text-gray-500',
  };
  const labels: Record<string, string> = {
    A: 'A: Redis完全',
    B: 'B: バックアップ',
    C: 'C: 別カテゴリ',
    D: 'D: 別ID',
    E: 'E: なし',
    pending: '未確認',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${map[cls] ?? 'bg-gray-100 text-gray-500'}`}>
      {labels[cls] ?? cls}
    </span>
  );
}
