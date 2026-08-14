// /admin/work-check のレビュー理由シグナル判定（Priority D-4）— クライアント安全な純粋関数のみ。
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
//
// 重要: このファイルは PersonWorks.tsx（'use client'）から直接importされるため、
// DBアクセスを行う関数（neonSql等）を絶対に含めないこと。DB読み取りが必要な
// シグナル（重複候補等）は src/lib/pending-dedup-store.ts（server-only）へ分離している。

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
