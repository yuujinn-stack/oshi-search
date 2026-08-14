import { describe, it, expect } from 'vitest';
import { addSelection, removeSelection, clearSelection, computeNextBatch, MAX_BULK_SELECT } from '../vod-recheck-selection';

function items(n: number) {
  return Array.from({ length: n }, (_, i) => ({ key: `w-${i + 1}` }));
}

describe('addSelection（+5〜+40ボタン）', () => {
  it('空の選択から+5すると先頭5件が追加される', () => {
    const result = addSelection(new Set(), items(20), 5);
    expect([...result]).toEqual(['w-1', 'w-2', 'w-3', 'w-4', 'w-5']);
  });

  it('+20を2回押すと、1回目は1〜20件目、2回目は21〜40件目が追加される（重複選択しない）', () => {
    const list = items(40);
    const first = addSelection(new Set(), list, 20);
    expect(first.size).toBe(20);
    expect([...first]).toEqual(list.slice(0, 20).map((i) => i.key));

    const second = addSelection(first, list, 20);
    expect(second.size).toBe(40);
    expect([...second].slice(20)).toEqual(list.slice(20, 40).map((i) => i.key));
  });

  it('40件上限を超えて追加しようとしても40件で止まる', () => {
    const list = items(50);
    const result = addSelection(new Set(), list, 40);
    expect(result.size).toBe(40);
    const overflow = addSelection(result, list, 10);
    expect(overflow.size).toBe(40); // 追加されない
  });

  it('既に一部選択済みの状態でも、未選択分から順に追加する', () => {
    const list = items(10);
    const current = new Set(['w-1', 'w-3']);
    const result = addSelection(current, list, 3);
    // w-1,w-3は既選択なのでスキップし、w-2,w-4,w-5が追加される
    expect([...result].sort()).toEqual(['w-1', 'w-2', 'w-3', 'w-4', 'w-5'].sort());
  });

  it('MAX_BULK_SELECTのデフォルトは40', () => {
    expect(MAX_BULK_SELECT).toBe(40);
  });

  it('itemsがN件未満でも安全に動作する（ある分だけ追加）', () => {
    const result = addSelection(new Set(), items(3), 10);
    expect(result.size).toBe(3);
  });
});

describe('removeSelection（-5〜-40ボタン）', () => {
  it('一覧順で後ろにある選択済みから解除する', () => {
    const list = items(10);
    const current = new Set(list.map((i) => i.key)); // 全10件選択済み
    const result = removeSelection(current, list, 3);
    // 後ろ3件（w-8,w-9,w-10）が解除される
    expect(result.has('w-10')).toBe(false);
    expect(result.has('w-9')).toBe(false);
    expect(result.has('w-8')).toBe(false);
    expect(result.has('w-7')).toBe(true);
    expect(result.size).toBe(7);
  });

  it('選択件数より多い数を指定した場合は0件まで減らす', () => {
    const list = items(5);
    const current = new Set(['w-1', 'w-2']);
    const result = removeSelection(current, list, 10);
    expect(result.size).toBe(0);
  });

  it('選択されていないitemsはスキップされる', () => {
    const list = items(5);
    const current = new Set(['w-1', 'w-5']); // 飛び飛びの選択
    const result = removeSelection(current, list, 1);
    // 一覧順で後ろから見て最初に選択済みなのはw-5
    expect(result.has('w-5')).toBe(false);
    expect(result.has('w-1')).toBe(true);
  });
});

describe('clearSelection（全解除）', () => {
  it('常に空のSetを返す', () => {
    expect(clearSelection().size).toBe(0);
  });
});

describe('addSelection → removeSelection の往復動作', () => {
  it('+20してから-20すると空になる', () => {
    const list = items(40);
    const added = addSelection(new Set(), list, 20);
    const removed = removeSelection(added, list, 20);
    expect(removed.size).toBe(0);
  });
});

describe('computeNextBatch（「次のN件」バッチ入れ替え）', () => {
  // 呼び出し側（VodRecheckClient）は「カーソル位置からoffsetでAPI取得した結果」を
  // fetchedItemsとして渡す想定。この関数自体はoffset計算やAPI呼び出しを行わない。

  it('ケース1相当: 通常のバッチ取得（25件要求・25件取得）は全件が対象になる', () => {
    const fetched = Array.from({ length: 40 }, (_, i) => `w-${i + 1}`); // 40件先読み
    const result = computeNextBatch(fetched, 25);
    expect(result.batchItems).toEqual(fetched.slice(0, 25));
    expect(result.advancedBy).toBe(25);
    expect(result.isEnd).toBe(false);
    expect(result.isPartial).toBe(false);
  });

  it('ケース2〜4相当: カーソルを進めながら3回連続で呼んでも重複しない（A〜E → F〜J → K〜O）', () => {
    const all = Array.from({ length: 100 }, (_, i) => String.fromCharCode(65 + (i % 26)) + i); // 一意な100件
    let cursor = 0;
    const batches: string[][] = [];
    for (let i = 0; i < 3; i++) {
      const fetched = all.slice(cursor, cursor + 40); // 呼び出し側が40件先読みで取得した想定
      const result = computeNextBatch(fetched, 25);
      batches.push(result.batchItems);
      cursor += result.advancedBy;
    }
    expect(batches[0]).toEqual(all.slice(0, 25));
    expect(batches[1]).toEqual(all.slice(25, 50));
    expect(batches[2]).toEqual(all.slice(50, 75));
    // 重複がないことも確認
    const flat = batches.flat();
    expect(new Set(flat).size).toBe(flat.length);
  });

  it('ケース5相当: 残り10件しかない状態で「次の25件」→10件だけ選択される', () => {
    const remaining = Array.from({ length: 10 }, (_, i) => `w-${i + 1}`);
    const result = computeNextBatch(remaining, 25);
    expect(result.batchItems.length).toBe(10);
    expect(result.advancedBy).toBe(10);
    expect(result.isPartial).toBe(true);
    expect(result.isEnd).toBe(false);
  });

  it('ケース6相当: 一覧末尾（fetchedItemsが0件）では isEnd=true になり、先頭へ戻らない', () => {
    const result = computeNextBatch([], 25);
    expect(result.isEnd).toBe(true);
    expect(result.batchItems).toEqual([]);
    expect(result.advancedBy).toBe(0);
  });

  it('ケース9相当: nが40以下である限りbatchItemsは常に40件以下（上限を超えない）', () => {
    const fetched = Array.from({ length: 40 }, (_, i) => `w-${i + 1}`);
    for (const n of [5, 10, 15, 20, 25, 30, 35, 40] as const) {
      const result = computeNextBatch(fetched, n);
      expect(result.batchItems.length).toBeLessThanOrEqual(40);
      expect(result.batchItems.length).toBeLessThanOrEqual(n);
    }
  });

  it('ちょうどn件しか取得できなかった場合はisPartial=falseになる（末尾ぴったり）', () => {
    const result = computeNextBatch(Array.from({ length: 25 }, (_, i) => i), 25);
    expect(result.isPartial).toBe(false);
    expect(result.advancedBy).toBe(25);
  });
});
