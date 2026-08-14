import { describe, it, expect } from 'vitest';
import { addSelection, removeSelection, clearSelection, MAX_BULK_SELECT } from '../vod-recheck-selection';

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
