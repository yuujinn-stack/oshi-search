import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({ db: {} }));

import { replaceOneAction } from '../script-prep-store';

// oshi-video-maker の parseReplaceAction（scripts/worker/first3ScriptQueue.ts）と同じ形式
const parse = (action: string) => {
  const m = /^replace_one\|([123])\|(.*)$/.exec(action);
  return m ? { slot: Number(m[1]), workId: m[2] ? decodeURIComponent(m[2]) : null } : null;
};

describe('1作品だけ変更の依頼（action の形式）', () => {
  it('枠・作品IDを Worker が読める形にする（空=おすすめに自動変更）', () => {
    expect(replaceOneAction(2, null)).toBe('replace_one|2|');
    const id = 'csv-tv-年下彼氏第11話「着せ替え彼氏」|x';
    expect(parse(replaceOneAction(3, id))).toEqual({ slot: 3, workId: id });
    expect(parse(replaceOneAction(1, 'tmdb-tv-296060'))).toEqual({ slot: 1, workId: 'tmdb-tv-296060' });
  });
  it('不正な枠・作品IDは依頼しない', () => {
    expect(() => replaceOneAction(0, null)).toThrow();
    expect(() => replaceOneAction(4, null)).toThrow();
    expect(() => replaceOneAction(1.5, null)).toThrow();
    expect(() => replaceOneAction(1, ' ')).toThrow();
    expect(() => replaceOneAction(1, 'x'.repeat(201))).toThrow();
  });
});
