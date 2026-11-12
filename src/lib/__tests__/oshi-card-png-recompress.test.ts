import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('server-only', () => ({}));

import { recompressPngLossless } from '@/server/oshi-card/png-recompress';

/** ホログラム・ラメのような細かな模様＋グラデーション＋透明な角を持つ RGBA 画像（決まった擬似乱数） */
async function sampleCardPng(w = 320, h = 448): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const glitter = rnd() < 0.08 ? 255 : 0;
      px[i] = Math.min(255, Math.round(140 + 80 * Math.sin((x + y) / 23)) + glitter);
      px[i + 1] = Math.min(255, Math.round(120 + 60 * Math.sin(y / 31)) + glitter);
      px[i + 2] = Math.min(255, 200 + Math.round(40 * rnd()));
      const corner = (x < 24 && y < 24 && (24 - x) ** 2 + (24 - y) ** 2 > 24 ** 2);
      px[i + 3] = corner ? 0 : x < 2 ? 128 : 255;
    }
  }
  // next/og と同じく圧縮の弱い PNG を入力にする
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 1, adaptiveFiltering: false }).toBuffer();
}

describe('recompressPngLossless（B の PNG の可逆再圧縮）', () => {
  it('画素（RGB・アルファ）が1つも変わらず、大きさは元以下', async () => {
    const src = await sampleCardPng();
    const out = await recompressPngLossless(src);
    expect(out.length).toBeLessThanOrEqual(src.length);
    const a = await sharp(src).raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(b.info.channels).toBe(4); // アルファチャンネルを保つ
    expect(b.info.width).toBe(a.info.width);
    expect(b.info.height).toBe(a.info.height);
    expect(b.data.equals(a.data)).toBe(true);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('png');
    expect(meta.isPalette ?? false).toBe(false); // パレット化しない
  });

  it('PNG でない入力は元のまま返す', async () => {
    const junk = Buffer.from('not a png');
    expect((await recompressPngLossless(junk)).equals(junk)).toBe(true);
  });
});
