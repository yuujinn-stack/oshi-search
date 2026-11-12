import { describe, expect, it } from 'vitest';
import { formatOshiCardServerTiming, oshiCardServerTimingEnabled } from '@/server/oshi-card/server-timing';

describe('B の計測ヘッダー（Preview だけ）', () => {
  it('Preview かつ OSHI_CARD_SERVER_TIMING=1 のときだけ有効', () => {
    expect(oshiCardServerTimingEnabled({ VERCEL_ENV: 'preview', OSHI_CARD_SERVER_TIMING: '1' })).toBe(true);
    expect(oshiCardServerTimingEnabled({ VERCEL_ENV: 'production', OSHI_CARD_SERVER_TIMING: '1' })).toBe(false);
    expect(oshiCardServerTimingEnabled({ VERCEL_ENV: 'preview' })).toBe(false);
    expect(oshiCardServerTimingEnabled({ OSHI_CARD_SERVER_TIMING: '1' })).toBe(false);
    expect(oshiCardServerTimingEnabled({ VERCEL_ENV: 'development', OSHI_CARD_SERVER_TIMING: '1' })).toBe(false);
  });

  it('値は数値だけ（接続先・パスなどの文字列を含まない）', () => {
    const h = formatOshiCardServerTiming({ renderMs: 1234.56, recompressMs: 210.04, fontMs: 34.2, cold: true, rssMb: 512.3, rawKb: 4642.4, pngKb: 2841.5 });
    expect(h).toBe('render;dur=1234.6, recompress;dur=210, font;dur=34.2, cold;dur=1, rss;dur=512.3, raw;dur=4642.4, png;dur=2841.5');
    expect(h).toMatch(/^([a-z]+;dur=[0-9.]+)(, [a-z]+;dur=[0-9.]+)*$/);
  });

  it('異常な値は 0 にする', () => {
    const h = formatOshiCardServerTiming({ renderMs: NaN, recompressMs: -5, fontMs: Infinity, cold: false, rssMb: 0, rawKb: 0, pngKb: 0 });
    expect(h).toBe('render;dur=0, recompress;dur=0, font;dur=0, cold;dur=0, rss;dur=0, raw;dur=0, png;dur=0');
  });
});
