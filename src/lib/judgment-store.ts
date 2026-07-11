// AI判定結果・手動判定結果の永続ストレージ（Neon DB）
// 同じ人物×商品の組み合わせではAIを再実行しない

import { db } from '@/db/client';
import { verdicts as verdictsTable } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { upsertVerdict, deleteVerdictInDB } from '@/db/write';

export type Verdict = 'related' | 'uncertain' | 'unrelated' | 'deleted';

export interface JudgmentRecord {
  verdict: Verdict;
  score: number;
  source: 'auto' | 'ai' | 'manual'; // auto=ルール自動判定、ai=OpenAI判定、manual=管理者判定
  reason?: string;
  timestamp: number;
  promptVersion?: string; // AI判定時のプロンプトバージョン（変更時に再判定するため）
}

// 人物の全判定結果を取得（ページレンダリング時に1回呼ぶ）
export async function getAllVerdicts(personName: string): Promise<Record<string, JudgmentRecord>> {
  try {
    const rows = await db.select().from(verdictsTable).where(eq(verdictsTable.personName, personName));
    const result: Record<string, JudgmentRecord> = {};
    for (const r of rows) {
      result[r.productId] = {
        verdict:       r.verdict as Verdict,
        score:         Number(r.score ?? 0),
        source:        r.source as JudgmentRecord['source'],
        reason:        r.reason ?? undefined,
        timestamp:     r.judgedAt.getTime(),
        promptVersion: r.promptVersion ?? undefined,
      };
    }
    return result;
  } catch (err) {
    console.error('[db] getAllVerdicts failed:', String(err));
    return {};
  }
}

// DBエラー時に throw する版（公開人物ページの商品フィルタで error/empty を区別するために使う）
// getAllVerdicts が {} を返すと承認済み商品が全件非表示になるため、OrThrow で区別する
export async function getAllVerdictsOrThrow(personName: string): Promise<Record<string, JudgmentRecord>> {
  const rows = await db.select().from(verdictsTable).where(eq(verdictsTable.personName, personName));
  const result: Record<string, JudgmentRecord> = {};
  for (const r of rows) {
    result[r.productId] = {
      verdict:       r.verdict as Verdict,
      score:         Number(r.score ?? 0),
      source:        r.source as JudgmentRecord['source'],
      reason:        r.reason ?? undefined,
      timestamp:     r.judgedAt.getTime(),
      promptVersion: r.promptVersion ?? undefined,
    };
  }
  return result;
}

// 単一商品の判定結果を保存
export async function saveVerdict(
  personName: string,
  productId: string,
  verdict: Verdict,
  score: number,
  source: 'auto' | 'ai' | 'manual',
  reason?: string,
  promptVersion?: string,
): Promise<void> {
  const now = Date.now();
  await upsertVerdict(personName, productId, verdict, score, source, reason, promptVersion, now);
}

// 判定結果を削除（リセット）
export async function deleteVerdict(personName: string, productId: string): Promise<void> {
  await deleteVerdictInDB(personName, productId);
}

// 複数商品を一括でverdictを設定（削除用途）
export async function bulkSaveVerdict(
  personName: string,
  productIds: string[],
  verdict: Verdict,
): Promise<void> {
  if (productIds.length === 0) return;
  const now = Date.now();
  for (const id of productIds) {
    await upsertVerdict(personName, id, verdict, 0, 'manual', undefined, undefined, now);
  }
}

// 判定結果を適用して商品を表示/非表示にフィルタリング（ユーザーページ用）
// - verdict='related'   → 表示
// - verdict='uncertain' → 非表示（管理者確認待ち）
// - verdict='unrelated' → 非表示
// - 判定なし           → 非表示（バッチ未実行）
export function applyVerdicts<T extends { id: string }>(
  products: T[],
  verdicts: Record<string, JudgmentRecord>,
): T[] {
  return products.filter((p) => verdicts[p.id]?.verdict === 'related');
}
