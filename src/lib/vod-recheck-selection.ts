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

// ── 「次のN件」バッチ選択（追加ではなく置き換え） ───────────────────────────────
// 実際の運用フロー: 最初の25件を調査 → 次の25件を調査 → さらに次の25件…と、
// 現在のフィルター・並び順に対して、直前までに扱った位置（カーソル）より後ろから
// N件を選び直したい。同じ作品へ毎回戻らないよう、呼び出し側は
// 「カーソル位置からN件（余裕を持たせるならMAX_BULK_SELECT件）を取得したうえで
// この関数へ渡す」→「返ってきたbatchItemsで選択を置き換える」→
// 「advancedByの分だけカーソルを前進させる」という手順を踏む。
//
// この関数自体はfetch結果を受け取るだけの純粋関数（DBアクセス・カーソル状態は持たない）。
export interface NextBatchResult<T> {
  /** 今回のバッチとして選択すべき項目（先頭からn件、末尾に近い場合はそれ未満） */
  batchItems: T[];
  /** カーソルを前進させるべき件数（= batchItems.length） */
  advancedBy: number;
  /** fetchedItemsが0件だった場合true（一覧の末尾に到達し、これ以上進めない） */
  isEnd: boolean;
  /** batchItemsがn件に満たない場合true（このバッチで末尾に到達した） */
  isPartial: boolean;
}

export function computeNextBatch<T>(fetchedItems: readonly T[], n: number): NextBatchResult<T> {
  if (fetchedItems.length === 0) {
    return { batchItems: [], advancedBy: 0, isEnd: true, isPartial: false };
  }
  const batchItems = fetchedItems.slice(0, n);
  return {
    batchItems,
    advancedBy: batchItems.length,
    isEnd: false,
    isPartial: batchItems.length < n,
  };
}
