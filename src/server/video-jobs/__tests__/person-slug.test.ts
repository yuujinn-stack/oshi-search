import { describe, expect, it } from 'vitest';
import { personVideoSlug } from '../person-slug';

// oshi-video-makerのdbPersonSlugForName（scripts/personSlugs.ts）と同じ値になること。
// Workerは人物名から計算し直して一致を確認するため、計算方法を変えるとPERSON_REGISTRY未登録人物の生成が止まる。
describe('personVideoSlug', () => {
  it('人物名から固定のslugを作る', () => {
    expect(personVideoSlug('森本慎太郎')).toBe('p-3a6837bdcc7a');
    expect(personVideoSlug('松村北斗')).toBe('p-a370aedfcd62');
  });
  it('パス・コマンドに使っても安全な文字だけになる', () => {
    for (const name of ['森本慎太郎', '../etc/passwd', 'a b;rm -rf', '']) {
      expect(personVideoSlug(name)).toMatch(/^p-[0-9a-f]{12}$/);
    }
  });
});
