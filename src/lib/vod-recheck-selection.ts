// /admin/vod-recheck の一括選択（+N/-N/全解除）ロジック（純粋関数・DOM/Reactに依存しない）。
// VodRecheckClient.tsx から呼ばれる。ブラウザ実地確認ができない場合でも、選択の増減という
// 最も操作ミスに直結しやすいロジックだけは確実にユニットテストできるようにするため、
// コンポーネント内クロージャではなくここへ切り出す。

export const MAX_BULK_SELECT = 40;

// 現在のフィルター＋並び順（＝items の順序）に対して、まだ選択されていない先頭からN件を追加する。
// 既に選択済みのkeyは自動的にスキップされるため、同じ操作を繰り返しても同じ対象を再選択しない
// （1回目: 1〜20件目、2回目: 21〜40件目、という挙動になる）。
// 上限(max)に達したらそれ以上は追加しない。
export function addSelection(current: ReadonlySet<string>, items: ReadonlyArray<{ key: string }>, n: number, max: number = MAX_BULK_SELECT): Set<string> {
  const next = new Set(current);
  let added = 0;
  for (const item of items) {
    if (added >= n || next.size >= max) break;
    if (!next.has(item.key)) { next.add(item.key); added++; }
  }
  return next;
}

// 現在の一覧順で後ろにある選択済み行から順にN件解除する。
// 選択件数より多い数を指定した場合は0件まで減らす。
export function removeSelection(current: ReadonlySet<string>, items: ReadonlyArray<{ key: string }>, n: number): Set<string> {
  const next = new Set(current);
  let removed = 0;
  for (let i = items.length - 1; i >= 0 && removed < n; i--) {
    const key = items[i].key;
    if (next.has(key)) { next.delete(key); removed++; }
  }
  return next;
}

export function clearSelection(): Set<string> {
  return new Set();
}
