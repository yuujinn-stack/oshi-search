// work_dedup_reviews（重複候補レビュー）の pending 状態workId取得（Priority D-5）。
// server-only: DB(neonSql)へアクセスするため、Client Componentから絶対にimportしないこと。
// 元は src/lib/work-review-signals.ts に同居していたが、そちらは PersonWorks.tsx
// （'use client'）から直接importされるファイルのため、DBアクセスを含む関数は
// このファイルへ分離した（同居させるとファイル全体がクライアントバンドルへ
// 巻き込まれ、ブラウザ側でneon()がDATABASE_URLなしに実行されてしまう）。
import 'server-only';
import { neonSql } from '@/db/client';

// work-dedup機能（重複作品の統合候補）と同じテーブルを読み取り専用で参照するのみ。
// レビュー・統合の実行は既存の /admin/work-dedup 側でのみ行われ、ここでは変更しない。
export async function getPendingDedupWorkIds(): Promise<Set<string>> {
  try {
    const rows = await neonSql`
      SELECT candidate_work_ids FROM work_dedup_reviews WHERE review_status = 'pending'
    `;
    const ids = new Set<string>();
    for (const row of rows as Array<{ candidate_work_ids: string[] }>) {
      for (const id of row.candidate_work_ids ?? []) ids.add(id);
    }
    return ids;
  } catch (err) {
    console.error('[db] getPendingDedupWorkIds failed:', String(err));
    return new Set();
  }
}
