import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({ db: {} }));

import { excludeOneAction, replaceOneAction, unexcludeAction, videoTitleAction } from '../script-prep-store';

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

describe('除外の依頼（action の形式。oshi-video-maker の parseExclusionAction と同じ）', () => {
  it('その枠の除外・作品IDの除外解除', () => {
    expect(excludeOneAction(2)).toBe('exclude_one|2');
    expect(excludeOneAction(3, 'vod_check')).toBe('vodcheck_one|3');
    const id = 'csv-tv-年下彼氏|x';
    const m = /^unexclude\|(.+)$/.exec(unexcludeAction(id));
    expect(m && decodeURIComponent(m[1])).toBe(id);
    expect(() => excludeOneAction(4)).toThrow();
    expect(() => unexcludeAction(' ')).toThrow();
  });
});

describe('動画用の表示名の依頼（oshi-video-maker の parseVideoTitleAction と同じ形式）', () => {
  it('作品IDと表示名を Worker が読める形にする。空は解除、長すぎる名前は依頼しない', () => {
    const m = /^video_title\|([^|]+)\|(.*)$/.exec(videoTitleAction('tmdb-tv-1|x', '  IKE   トーク '));
    expect(m && [decodeURIComponent(m[1]), decodeURIComponent(m[2])]).toEqual(['tmdb-tv-1|x', 'IKE トーク']);
    expect(videoTitleAction('w1', null)).toBe('video_title|w1|');
    expect(() => videoTitleAction('w1', 'あ'.repeat(41))).toThrow();
    expect(() => videoTitleAction(' ', 'x')).toThrow();
  });
});
