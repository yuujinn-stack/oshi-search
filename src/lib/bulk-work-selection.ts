// /admin/work-check「② 配信再調査」の作品一括選択（先頭からN件）。純粋関数。
// 対象は現在の表示一覧（検索・年・種別・調査状況のフィルター後、表示順のまま）。スクロールしないと
// 見えない作品も含む。選択は「先頭N件」に置き換える（押すたびに追加はしない）。

export const BULK_SELECT_SIZES = [5, 10, 15, 20, 25, 30, 35, 40] as const;

/** 表示一覧の先頭 n 件（足りなければ全件）の ID */
export function firstNIds(displayIds: readonly string[], n: number): Set<string> {
  return new Set(displayIds.slice(0, Math.max(0, n)));
}

/** 現在の表示一覧に出ていない選択済み作品の数（一括選択で解除されてしまう件数） */
export function countHiddenSelected(selected: ReadonlySet<string>, displayIds: readonly string[]): number {
  const visible = new Set(displayIds);
  let n = 0;
  for (const id of selected) if (!visible.has(id)) n++;
  return n;
}

/** 選択がちょうど「表示一覧の先頭 n 件」になっているか（ボタンの強調表示用） */
export function isFirstNSelection(selected: ReadonlySet<string>, displayIds: readonly string[], n: number): boolean {
  const expected = displayIds.slice(0, Math.max(0, n));
  if (expected.length === 0 || selected.size !== expected.length) return false;
  return expected.every((id) => selected.has(id));
}
