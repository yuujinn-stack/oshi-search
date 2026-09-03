// GroupMeta.note の公開表示フィルタ。
// db等サーバー専用依存を一切持たないため、Client Component からも安全にimportできる。

// ensureGroupMeta() が自動作成時に入れる内部向けプレースホルダー文字列。
// 管理画面での確認用メモであり、公開ページに表示する内容ではないため、
// DBの値自体は変更せず、公開表示側でのみ除外する。
const INTERNAL_ONLY_NOTES = new Set(['人物登録時に自動作成']);

// 公開ページで安全に表示できるnoteだけを返す（内部プレースホルダーはundefinedにする）。
export function getPublicGroupNote(note?: string): string | undefined {
  if (!note) return undefined;
  return INTERNAL_ONLY_NOTES.has(note.trim()) ? undefined : note;
}
