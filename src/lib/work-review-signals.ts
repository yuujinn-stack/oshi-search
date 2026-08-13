// /admin/work-check のレビュー理由シグナル判定（Priority D-4/D-5）。
//
// 方針: ここでの判定は「管理画面での確認候補として目立たせるかどうか」にのみ使う。
// 自動でstatusを変更したり作品を削除したりすることは一切しない。
//
// 「同姓同名注意」フィルターは意図的に実装していない。既存データに同姓同名を安全に
// 検出できる情報（例: TMDb人物IDの不一致等を統一的に扱う仕組み）が無く、不確実な
// ヒューリスティックを追加することは「実際に取得できない条件は追加しない」という
// 方針に反するため見送った。「生年以前」もPersonにbirthYearフィールドが現状
// 存在しないため、下記の純粋関数自体は用意しつつ、実データでは判定対象がないことを
// 呼び出し側・報告で明示する。

import { neonSql } from '@/db/client';

// ─── 古すぎる可能性（releaseYearが現在から一定年数以上前、かつまだneeds_review） ──
export const TOO_OLD_THRESHOLD_YEARS = 20;

export function isReleaseYearTooOld(
  releaseYear: number | null | undefined,
  status: string,
  currentYear: number = new Date().getFullYear(),
): boolean {
  if (releaseYear === null || releaseYear === undefined) return false;
  if (status !== 'needs_review') return false;
  return currentYear - releaseYear >= TOO_OLD_THRESHOLD_YEARS;
}

// ─── 生年以前候補（releaseYear < personのbirthYear）────────────────────────────
// 現状 persons/person_meta のいずれにもbirthYearフィールドが存在しないため、
// この関数は将来そのデータが追加された場合に備えた純粋ロジックとしてのみ提供する。
export function isReleaseBeforeBirthYear(
  releaseYear: number | null | undefined,
  birthYear: number | null | undefined,
): boolean {
  if (releaseYear === null || releaseYear === undefined) return false;
  if (birthYear === null || birthYear === undefined) return false;
  return releaseYear < birthYear;
}

// ─── 重複候補（work_dedup_reviews に pending 状態のレビューとして含まれるworkId）──
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
