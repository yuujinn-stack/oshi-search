import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { REGISTERED_VIDEO_COLORS as C, registeredHeadingAccent } from '@/lib/registered-video-design';
import { REGISTERED_CATEGORIES, REGISTERED_CATEGORY_LABEL } from '@/lib/video-registered-groups';

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('登録グループ紹介の配色（黄色基調）', () => {
  it('背景は淡い黄色・クリーム色（黒・濃いネイビーにしない）', () => {
    for (const bg of [C.bgTop, C.bgMid, C.bgBottom, C.surface]) expect(lum(bg)).toBeGreaterThan(0.8);
  });

  it('文字はどの背景の上でも 4.5:1 以上', () => {
    for (const bg of [C.bgTop, C.bgMid, C.bgBottom, C.surface]) {
      for (const fg of [C.head, C.ink, C.muted]) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ジャンルの見出しはすべて淡いラベル色を持ち、ラベルの文字は 4.5:1 以上', () => {
    for (const c of REGISTERED_CATEGORIES) {
      const a = registeredHeadingAccent(REGISTERED_CATEGORY_LABEL[c]);
      expect(lum(a.soft)).toBeGreaterThan(0.6);
      expect(contrast(a.ink, a.soft)).toBeGreaterThanOrEqual(4.5);
    }
    expect(registeredHeadingAccent('男性アイドル')).not.toEqual(registeredHeadingAccent('女性アイドル'));
    expect(registeredHeadingAccent('登録グループの一部').main).toBe(C.yellowDeep);
    // 冒頭の件数のラベル・締めのパネル（黄色）の上の見出しの文字
    expect(contrast(C.head, C.yellow)).toBeGreaterThanOrEqual(4.5);
  });

  it('管理画面のプレビューは共通の配色を使い、濃紺の背景を直書きしない', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/app/admin/video-maker/RegisteredGroupsPicker.tsx'), 'utf-8');
    expect(src).toContain('REGISTERED_VIDEO_COLORS');
    expect(src).not.toMatch(/#0B1330|bg-slate-9|bg-gray-9|bg-black/i);
  });
});
