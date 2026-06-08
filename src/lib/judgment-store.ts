// AI判定結果・手動判定結果の永続ストレージ（Upstash Redis）
// 同じ人物×商品の組み合わせではAIを再実行しない

import { getRedis } from './redis';

export type Verdict = 'relevant' | 'maybe' | 'unrelated';

export interface JudgmentRecord {
  verdict: Verdict;
  score: number;
  source: 'ai' | 'manual';
  reason?: string;
  timestamp: number;
}

// Redis hash key: "verdicts:{personName}" → field: productId → value: JudgmentRecord JSON
function hashKey(personName: string): string {
  return `verdicts:${personName}`;
}

// 人物の全判定結果を取得（ページレンダリング時に1回呼ぶ）
export async function getAllVerdicts(personName: string): Promise<Record<string, JudgmentRecord>> {
  const redis = getRedis();
  if (!redis) return {};
  try {
    const raw = await redis.hgetall(hashKey(personName));
    if (!raw) return {};
    const result: Record<string, JudgmentRecord> = {};
    for (const [k, v] of Object.entries(raw)) {
      try {
        result[k] = (typeof v === 'string' ? JSON.parse(v) : v) as JudgmentRecord;
      } catch { /* 壊れたデータはスキップ */ }
    }
    return result;
  } catch {
    return {};
  }
}

// 単一商品の判定結果を保存
export async function saveVerdict(
  personName: string,
  productId: string,
  verdict: Verdict,
  score: number,
  source: 'ai' | 'manual',
  reason?: string,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const record: JudgmentRecord = { verdict, score, source, reason, timestamp: Date.now() };
  await redis.hset(hashKey(personName), { [productId]: JSON.stringify(record) });
}

// 判定結果を削除（リセット）
export async function deleteVerdict(personName: string, productId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hdel(hashKey(personName), productId);
}

// 判定結果を適用して商品を表示/非表示にフィルタリング
// - verdict='relevant' → 表示
// - verdict='maybe' → 表示（管理者確認推奨）
// - verdict='unrelated' → 非表示
// - 判定なし → score で判定
export function applyVerdicts<T extends { id: string; relevanceScore: number }>(
  products: T[],
  verdicts: Record<string, JudgmentRecord>,
  strictMode: boolean,
): T[] {
  const threshold = strictMode ? 50 : 20;
  return products.filter((p) => {
    const judgment = verdicts[p.id];
    if (judgment) {
      return judgment.verdict !== 'unrelated';
    }
    return p.relevanceScore >= threshold;
  });
}
