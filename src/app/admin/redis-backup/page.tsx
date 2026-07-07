export const dynamic = 'force-dynamic';

import { getRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import DownloadButton from './DownloadButton';

async function scanCount(redis: Redis, pattern: string): Promise<{ keyCount: number; fieldCount: number }> {
  const keys: string[] = [];
  let cursor = 0;
  do {
    const [cur, batch] = await redis.scan(cursor, { match: pattern, count: 100 });
    cursor = Number(cur);
    keys.push(...(batch as string[]));
  } while (cursor !== 0);

  if (keys.length === 0) return { keyCount: 0, fieldCount: 0 };

  const pipe = redis.pipeline();
  for (const k of keys) pipe.hlen(k);
  const results = (await pipe.exec()) as number[];
  const fieldCount = results.reduce((s, n) => s + (n ?? 0), 0);
  return { keyCount: keys.length, fieldCount };
}

interface KeySummary {
  key: string;
  label: string;
  count: number;
  extra?: string;
  error?: string;
}

async function getBackupSummary(): Promise<{ redis: boolean; rows: KeySummary[]; total: number }> {
  const redis = getRedis();
  if (!redis) {
    return {
      redis: false,
      rows: [],
      total: 0,
    };
  }

  const fixedKeys: { key: string; label: string }[] = [
    { key: 'imported:persons',      label: 'CSVインポート人物' },
    { key: 'persons:published',     label: '公開反映済み人物' },
    { key: 'admin:person-meta',     label: '人物メタ情報' },
    { key: 'vod:providers',         label: 'VOD配信サービス設定' },
    { key: 'vod:intensive:persons', label: 'VOD集中取得対象' },
  ];

  const patternKeys: { pattern: string; label: string }[] = [
    { pattern: 'products:*', label: '商品データ' },
    { pattern: 'works:*',    label: '出演作品データ' },
    { pattern: 'verdicts:*', label: 'AI判定データ' },
  ];

  const rows: KeySummary[] = [];

  for (const { key, label } of fixedKeys) {
    try {
      const count = await redis.hlen(key);
      rows.push({ key, label, count });
    } catch (err) {
      rows.push({ key, label, count: -1, error: String(err) });
    }
  }

  for (const { pattern, label } of patternKeys) {
    try {
      const { keyCount, fieldCount } = await scanCount(redis, pattern);
      rows.push({ key: pattern, label, count: fieldCount, extra: `${keyCount}人分` });
    } catch (err) {
      rows.push({ key: pattern, label, count: -1, error: String(err) });
    }
  }

  const total = rows.filter(r => r.count > 0).reduce((s, r) => s + r.count, 0);
  return { redis: true, rows, total };
}

export default async function RedisBackupPage() {
  const { redis, rows, total } = await getBackupSummary();

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">Redis バックアップ</h1>
        <p className="text-sm text-slate-500 mt-1">
          重要データをJSONで書き出します。読み取り専用です。データの削除・変更は行いません。
        </p>
      </div>

      {/* Redis接続状態 */}
      <div className={`flex items-center gap-2 text-sm font-medium mb-6 px-4 py-2 rounded-lg w-fit ${
        redis ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
      }`}>
        <span>{redis ? '✓ Redis接続OK' : '✗ Redis未接続'}</span>
      </div>

      {!redis && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          環境変数 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が設定されていないか、接続に失敗しました。
        </p>
      )}

      {/* キー別件数テーブル */}
      {rows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Redisキー</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">内容</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">件数</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">備考</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{row.key}</td>
                  <td className="px-4 py-2.5 text-slate-700">{row.label}</td>
                  <td className="px-4 py-2.5 text-right">
                    {row.error ? (
                      <span className="text-red-500 text-xs">エラー</span>
                    ) : (
                      <span className={`font-bold ${row.count === 0 ? 'text-slate-400' : 'text-slate-800'}`}>
                        {row.count.toLocaleString()}件
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">
                    {row.error ? (
                      <span className="text-red-400 break-all">{row.error}</span>
                    ) : (
                      row.extra ?? ''
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-gray-200">
                <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-slate-600">合計</td>
                <td className="px-4 py-2.5 text-right font-bold text-slate-800">{total.toLocaleString()}件</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ダウンロード */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-blue-800 mb-1">JSONバックアップをダウンロード</p>
        <p className="text-xs text-blue-600 mb-4">
          上記全キーのデータを1つのJSONファイルにまとめて書き出します。
          ダウンロード時にRedisへアクセスするため、制限超過中は失敗することがあります。
        </p>
        <DownloadButton />
      </div>

      <p className="mt-4 text-xs text-slate-400">
        このAPIは読み取り専用です。Redisデータの削除・変更・再構築は行いません。
      </p>
    </div>
  );
}
