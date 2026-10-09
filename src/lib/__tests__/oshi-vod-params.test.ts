import { describe, it, expect } from 'vitest';
import {
  OSHI_VOD_MAX_PERSONS,
  buildOshiVodGroupPath,
  buildOshiVodImagePath,
  buildOshiVodResultPath,
  buildOshiVodWithPath,
  normalizeNameList,
  parseImageSize,
  parseOshiVodParams,
  resolveKnownNames,
} from '../oshi-vod/params';

describe('oshi-vod params', () => {
  it('前後空白・空・重複を除去し初出順を維持', () => {
    expect(normalizeNameList([' 目黒蓮 ', '', '目黒蓮', 'ラウール'])).toEqual(['目黒蓮', 'ラウール']);
    expect(normalizeNameList('単独')).toEqual(['単独']);
    expect(normalizeNameList(undefined)).toEqual([]);
    expect(normalizeNameList(['x'.repeat(61)])).toEqual([]);
  });

  it('最大12人に切り詰め、超過を通知', () => {
    const many = Array.from({ length: 15 }, (_, i) => `人物${i}`);
    const r = parseOshiVodParams({ p: many });
    expect(r.names).toHaveLength(OSHI_VOD_MAX_PERSONS);
    expect(r.overflow).toBe(true);
    expect(parseOshiVodParams({ p: many.slice(0, 12) }).overflow).toBe(false);
  });

  it('with / group を解析', () => {
    const r = parseOshiVodParams({ with: ['A', 'B'], group: ' 乃木坂46 ' });
    expect(r.withNames).toEqual(['A', 'B']);
    expect(r.group).toBe('乃木坂46');
    expect(parseOshiVodParams({}).group).toBeNull();
  });

  it('公開人物に存在しない名前は unknown に分ける', () => {
    expect(resolveKnownNames(['A', 'X', 'B'], new Set(['A', 'B']))).toEqual({ valid: ['A', 'B'], unknown: ['X'] });
  });

  it('URL組み立て（エンコード・往復）', () => {
    const path = buildOshiVodResultPath(['目黒蓮', 'A&B']);
    expect(path).toBe(`/oshi-vod?p=${encodeURIComponent('目黒蓮')}&p=${encodeURIComponent('A&B')}`);
    const sp = new URL(`https://x${path}`).searchParams;
    expect(sp.getAll('p')).toEqual(['目黒蓮', 'A&B']);
    expect(buildOshiVodResultPath([])).toBe('/oshi-vod');
    expect(buildOshiVodWithPath(['A'])).toBe('/oshi-vod?with=A#oshi-vod-picker');
    expect(buildOshiVodGroupPath('＝LOVE')).toBe(`/oshi-vod?group=${encodeURIComponent('＝LOVE')}#oshi-vod-picker`);
    expect(buildOshiVodImagePath(['A'])).toBe('/api/oshi-vod/image?p=A');
    expect(buildOshiVodImagePath(['A'], 'story')).toBe('/api/oshi-vod/image?p=A&size=story');
  });

  it('画像サイズの解析（既定は feed）', () => {
    expect(parseImageSize('story')).toBe('story');
    expect(parseImageSize('feed')).toBe('feed');
    expect(parseImageSize(null)).toBe('feed');
    expect(parseImageSize('xxx')).toBe('feed');
  });
});
