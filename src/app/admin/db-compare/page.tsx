export const dynamic = 'force-dynamic';

import { compareRedisAndDB } from '@/lib/db-compare';
import type { EntitySummary, PersonDiscrepancy } from '@/lib/db-compare';

function MatchBadge({ match }: { match: boolean }) {
  return match ? (
    <span className="text-green-400 font-medium">✓ 一致</span>
  ) : (
    <span className="text-red-400 font-bold">✗ 不一致</span>
  );
}

function SummaryTable({ rows }: { rows: EntitySummary[] }) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-slate-700 text-slate-300">
          <th className="text-left px-3 py-2">エンティティ</th>
          <th className="text-left px-3 py-2">Redisキー</th>
          <th className="text-right px-3 py-2">Redis件数</th>
          <th className="text-right px-3 py-2">DB件数</th>
          <th className="text-right px-3 py-2">差分</th>
          <th className="text-center px-3 py-2">状態</th>
          <th className="text-left px-3 py-2">備考</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.redisKey} className="border-t border-slate-700 hover:bg-slate-700/30">
            <td className="px-3 py-2 text-slate-200">{row.label}</td>
            <td className="px-3 py-2 font-mono text-slate-400 text-xs">{row.redisKey}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.redisCount.toLocaleString()}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.dbCount.toLocaleString()}</td>
            <td className={`px-3 py-2 text-right tabular-nums font-mono ${
              row.dbCount - row.redisCount !== 0 ? 'text-red-400' : 'text-slate-500'
            }`}>
              {row.dbCount - row.redisCount > 0 ? '+' : ''}{(row.dbCount - row.redisCount).toLocaleString()}
            </td>
            <td className="px-3 py-2 text-center">
              <MatchBadge match={row.match} />
            </td>
            <td className="px-3 py-2 text-slate-500 text-xs">{row.note ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DiscrepancyTable({ rows }: { rows: PersonDiscrepancy[] }) {
  if (rows.length === 0) {
    return <p className="text-green-400 text-sm">人物別の差分なし — 全員一致</p>;
  }

  const entityLabel: Record<PersonDiscrepancy['entity'], string> = {
    works: '出演作品',
    products: '商品',
    verdicts: 'AI判定',
  };

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-slate-700 text-slate-300">
          <th className="text-left px-3 py-2">人物名</th>
          <th className="text-left px-3 py-2">エンティティ</th>
          <th className="text-right px-3 py-2">Redis件数</th>
          <th className="text-right px-3 py-2">DB件数</th>
          <th className="text-right px-3 py-2">差分(DB-Redis)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.entity}-${row.personName}`} className="border-t border-slate-700 hover:bg-slate-700/30">
            <td className="px-3 py-2 text-slate-200">{row.personName}</td>
            <td className="px-3 py-2 text-slate-400">{entityLabel[row.entity]}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.redisCount.toLocaleString()}</td>
            <td className="px-3 py-2 text-right tabular-nums">{row.dbCount.toLocaleString()}</td>
            <td className={`px-3 py-2 text-right tabular-nums font-mono font-bold ${
              row.diff > 0 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {row.diff > 0 ? '+' : ''}{row.diff.toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function DbComparePage() {
  const result = await compareRedisAndDB();

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Redis ↔ DB 整合性検証</h1>
        <div className="flex items-center gap-3">
          {result.allMatch ? (
            <span className="px-3 py-1 bg-green-700 text-green-100 rounded-full text-sm font-medium">
              ✓ 全件一致
            </span>
          ) : (
            <span className="px-3 py-1 bg-red-700 text-red-100 rounded-full text-sm font-medium">
              ✗ 差分あり
            </span>
          )}
          <span className="text-slate-400 text-xs">
            {result.durationMs}ms — {new Date(result.generatedAt).toLocaleString('ja-JP')}
          </span>
        </div>
      </div>

      {result.error && (
        <div className="mb-6 bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
          <strong>エラー:</strong> {result.error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-6 text-center text-xs">
        <div className={`rounded-lg p-3 ${result.redisOk ? 'bg-green-900/40 border border-green-700' : 'bg-red-900/40 border border-red-700'}`}>
          <div className={`font-bold text-sm ${result.redisOk ? 'text-green-400' : 'text-red-400'}`}>
            {result.redisOk ? '✓ Redis' : '✗ Redis'}
          </div>
          <div className="text-slate-400 mt-0.5">{result.redisOk ? '接続OK' : '接続エラー'}</div>
        </div>
        <div className={`rounded-lg p-3 ${result.dbOk ? 'bg-green-900/40 border border-green-700' : 'bg-red-900/40 border border-red-700'}`}>
          <div className={`font-bold text-sm ${result.dbOk ? 'text-green-400' : 'text-red-400'}`}>
            {result.dbOk ? '✓ Neon DB' : '✗ Neon DB'}
          </div>
          <div className="text-slate-400 mt-0.5">{result.dbOk ? '接続OK' : '接続エラー'}</div>
        </div>
        <div className={`rounded-lg p-3 ${result.allMatch ? 'bg-green-900/40 border border-green-700' : 'bg-yellow-900/40 border border-yellow-700'}`}>
          <div className={`font-bold text-sm ${result.allMatch ? 'text-green-400' : 'text-yellow-400'}`}>
            {result.allMatch ? '✓ 整合性' : '△ 要確認'}
          </div>
          <div className="text-slate-400 mt-0.5">
            {result.allMatch ? '全件一致' : `${result.personDiscrepancies.length}件の差分`}
          </div>
        </div>
      </div>

      {result.summary.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-slate-300 mb-2">エンティティ別サマリー</h2>
          <div className="bg-slate-800 rounded-lg overflow-hidden">
            <SummaryTable rows={result.summary} />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">
          人物別差分（works / products / verdicts）
          {result.personDiscrepancies.length > 0 && (
            <span className="ml-2 text-red-400">{result.personDiscrepancies.length}件</span>
          )}
        </h2>
        <div className="bg-slate-800 rounded-lg overflow-hidden p-4">
          <DiscrepancyTable rows={result.personDiscrepancies} />
        </div>
      </section>

      <p className="mt-6 text-slate-600 text-xs">
        ※ このページは読み取り専用です。Redis・DB のデータを変更しません。
      </p>
    </main>
  );
}
