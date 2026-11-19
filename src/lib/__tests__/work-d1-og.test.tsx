import { beforeEach, describe, expect, it, vi } from 'vitest';

// 作品ページの OGP／SNS 共有画像・JSON-LD の image（D-1 のときは D-1 の OG 画像、従来のときは従来の作品画像）と、
// D-1 の OG 画像ルート（/work/[workId]/og）。DB は使わない（作品の読み込みは偽物）。
const mocks = vi.hoisted(() => ({ getPublicWorkById: vi.fn() }));
vi.mock('@/lib/work-store', () => mocks);
vi.mock('server-only', () => ({}));

import { buildWorkD1OgImagePath, resolveWorkShareImage, toAbsoluteUrl, WORK_D1_OG_IMAGE_SIZE } from '@/lib/work-image-display';
import { getWorkD1OgTitleFontSize, WorkD1OgImage } from '@/server/work-d1/og-image';
import { GET } from '@/app/work/[workId]/og/route';

const TMDB = 'https://image.tmdb.org/t/p/w500/abc.jpg';
const OG = 'https://example.com/og.jpg';
const MANUAL = 'https://example.com/manual.jpg';

describe('resolveWorkShareImage（og:image・twitter:image・JSON-LD の image）', () => {
  it('D-1 は D-1 の OG 画像だけ（従来の作品画像URLは返さない）', () => {
    const r = resolveWorkShareImage({ manualImageUrl: MANUAL, posterUrl: TMDB, ogImageUrl: OG }, 'd1', 'w 1/あ');
    expect(r).toEqual({ url: '/work/w%201%2F%E3%81%82/og', kind: 'd1' });
    expect(JSON.stringify(r)).not.toMatch(/tmdb|example\.com/);
    // 画像の無い作品も D-1 の OG 画像を持つ
    expect(resolveWorkShareImage({}, 'd1', 'w1')).toEqual({ url: '/work/w1/og', kind: 'd1' });
  });
  it('従来画像表示は従来どおり（手動 > TMDb > OG、無ければ画像なし）', () => {
    expect(resolveWorkShareImage({ manualImageUrl: MANUAL, posterUrl: TMDB }, 'legacy', 'w1')).toEqual({ url: MANUAL, kind: 'image' });
    expect(resolveWorkShareImage({ posterUrl: TMDB, ogImageUrl: OG }, 'legacy', 'w1')).toEqual({ url: TMDB, kind: 'image' });
    expect(resolveWorkShareImage({}, 'legacy', 'w1')).toBeNull();
  });
  it('将来用：許諾済みの公式画像は D-1 でもそれを使う', () => {
    expect(resolveWorkShareImage({ posterUrl: TMDB, licensedImageUrl: 'https://official.example.jp/k.jpg' }, 'd1', 'w1'))
      .toEqual({ url: 'https://official.example.jp/k.jpg', kind: 'image' });
  });
  it('JSON-LD 用の絶対URL', () => {
    expect(toAbsoluteUrl(buildWorkD1OgImagePath('w1'), 'https://oshi-search.jp')).toBe('https://oshi-search.jp/work/w1/og');
    expect(toAbsoluteUrl(buildWorkD1OgImagePath('w1'), 'https://oshi-search.jp/')).toBe('https://oshi-search.jp/work/w1/og');
    expect(toAbsoluteUrl(TMDB, 'https://oshi-search.jp')).toBe(TMDB);
  });
});

describe('D-1 の OG 画像', () => {
  it('作品名が長いほど文字を小さくする', () => {
    const sizes = ['海', '君の名前で僕を呼んで', 'The Extraordinarily Long Adventures of Somebody Unforgettable', 'あ'.repeat(100)].map(getWorkD1OgTitleFontSize);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(sizes[0]).toBeGreaterThan(sizes[3]);
  });
  it('作品名・種類・公開年を描き、画像（img）は使わない', () => {
    const out = JSON.stringify(WorkD1OgImage({ title: '作品A', typeLabel: '映画', releaseYear: 2020 }));
    expect(out).toContain('作品A');
    expect(out).toContain('映画 · 2020');
    expect(out).toContain('OSHI SEARCH');
    expect(out).not.toMatch(/"img"|src/);
    // 公開年不明
    expect(JSON.stringify(WorkD1OgImage({ title: 'X', typeLabel: 'ドラマ' }))).toContain('"ドラマ"');
  });
});

describe('GET /work/[workId]/og', () => {
  beforeEach(() => {
    mocks.getPublicWorkById.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  const call = (id: string) => GET(new Request(`http://localhost/work/${id}/og`), { params: Promise.resolve({ workId: id }) });

  it('1200×630 の PNG を返す（検索結果には出さない・CDN キャッシュ）', async () => {
    mocks.getPublicWorkById.mockResolvedValue({
      id: 'w1', personName: 'A', title: '【推し活】Re:スタート!! ～第2章～ #A&B', normalizedTitle: '', type: 'variety', source: 'manual',
      releaseYear: 2023, posterUrl: TMDB, confidenceScore: 0, status: 'auto_published', createdAt: 0, updatedAt: 0,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await call('w1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('cache-control')).toContain('s-maxage=86400');
    const buf = new Uint8Array(await res.arrayBuffer());
    // PNG の IHDR から幅・高さ
    const view = new DataView(buf.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([WORK_D1_OG_IMAGE_SIZE.width, WORK_D1_OG_IMAGE_SIZE.height]);
    // 外部の作品画像を取りに行かない
    expect(fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('tmdb') || u.includes('example.com'))).toEqual([]);
    fetchSpy.mockRestore();
  }, 30000);
  it('作品が無ければ 404、読み込み失敗は 500（どちらもキャッシュしない）', async () => {
    mocks.getPublicWorkById.mockResolvedValue(null);
    const nf = await call('none');
    expect(nf.status).toBe(404);
    expect(nf.headers.get('cache-control')).toBe('no-store');
    mocks.getPublicWorkById.mockRejectedValue(new Error('db down'));
    expect((await call('w1')).status).toBe(500);
  });
});
