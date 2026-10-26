import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const revalidateTag = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidateTag, revalidatePath, unstable_cache: (fn: unknown) => fn }));

import { PUBLIC_LISTING_CACHE_TAG, PUBLIC_LISTING_REVALIDATE_SECONDS, revalidatePublicListings } from '@/lib/public-listing-cache';

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('トップ・ジャンル一覧・写真集のキャッシュ無効化', () => {
  beforeEach(() => { revalidateTag.mockReset(); revalidatePath.mockReset(); });

  it('タグ・トップ・全ジャンルページを即時に無効化する', () => {
    revalidatePublicListings();
    expect(revalidateTag).toHaveBeenCalledWith(PUBLIC_LISTING_CACHE_TAG, { expire: 0 });
    expect(revalidatePath).toHaveBeenCalledWith('/');
    expect(revalidatePath).toHaveBeenCalledWith('/genre/[genre]', 'page');
  });

  it('Next.js のリクエスト外（スクリプト・GitHub Actions）で例外が出ても、書き込み処理を失敗させない', () => {
    revalidateTag.mockImplementation(() => { throw new Error('Invariant: static generation store missing'); });
    expect(() => revalidatePublicListings()).not.toThrow();
  });

  it('保持時間は1時間。トップ・ジャンルの revalidate も 3600', () => {
    expect(PUBLIC_LISTING_REVALIDATE_SECONDS).toBe(3600);
    expect(read('src/app/page.tsx')).toMatch(/^export const revalidate = 3600;$/m);
    expect(read('src/app/genre/[genre]/page.tsx')).toMatch(/^export const revalidate = 3600;$/m);
    // トップのデータキャッシュはすべて1時間・無効化タグ付き（60秒のまま残っていない）
    const home = read('src/app/page.tsx');
    expect(home).not.toMatch(/revalidate: 60\b/);
    expect(home.match(/tags: \[[^\]]*PUBLIC_LISTING_CACHE_TAG/g)?.length).toBe(6);
  });

  it('公開ページに出るデータの書き込み関数は、すべて書き込み後に無効化する', () => {
    const write = read('src/db/write.ts');
    const hooked = [
      'upsertProduct', 'upsertVerdict', 'upsertWork', 'upsertPersonMeta', 'upsertGroupMeta',
      'upsertPhotobookSetting', 'resetPhotobookSetting', 'upsertVodProvider', 'publishPersonInDB', 'unpublishPersonInDB',
      'deleteVerdictInDB', 'deleteGroupMetaInDB', 'deleteVodProviderInDB', 'batchUpdateVodData',
    ];
    for (const name of hooked) {
      const start = write.indexOf(`export async function ${name}(`);
      expect(start, name).toBeGreaterThanOrEqual(0);
      const body = write.slice(start, write.indexOf('\n}\n', start));
      expect(body, name).toContain('revalidatePublicListings()');
    }
    expect(read('src/lib/photobook-gender-write.ts').match(/revalidatePublicListings\(\)/g)?.length).toBe(2);
    expect(read('src/lib/work-store.ts').match(/revalidatePublicListings\(\)/g)?.length).toBe(2);
    expect(read('src/lib/work-dedup-apply.ts')).toContain('revalidatePublicListings()');
  });
});

describe('書き込み関数からの無効化（実行時）', () => {
  it('写真集設定の保存・解除で無効化される', async () => {
    vi.resetModules();
    const calls: string[] = [];
    vi.doMock('@/lib/public-listing-cache', () => ({ revalidatePublicListings: () => calls.push('revalidate') }));
    vi.doMock('@/lib/batch-lock', () => ({ getBatchLockStatus: vi.fn(), PRODUCT_ID_MIGRATION_LOCK_KEY: 'k' }));
    const chain = { values: () => chain, onConflictDoUpdate: () => Promise.resolve(), where: () => Promise.resolve() };
    vi.doMock('@/db/client', () => ({ db: { insert: () => chain, delete: () => chain }, neonSql: vi.fn() }));
    const w = await import('@/db/write');
    await w.upsertPhotobookSetting({ personName: '成田凌', productId: 'p1', published: false });
    await w.resetPhotobookSetting('成田凌', 'p1');
    expect(calls).toEqual(['revalidate', 'revalidate']);
  });

  it('DB への書き込みが失敗したときは無効化しない（例外はそのまま）', async () => {
    vi.resetModules();
    const calls: string[] = [];
    vi.doMock('@/lib/public-listing-cache', () => ({ revalidatePublicListings: () => calls.push('revalidate') }));
    vi.doMock('@/lib/batch-lock', () => ({ getBatchLockStatus: vi.fn(), PRODUCT_ID_MIGRATION_LOCK_KEY: 'k' }));
    const chain = { values: () => chain, onConflictDoUpdate: () => Promise.reject(new Error('db down')) };
    vi.doMock('@/db/client', () => ({ db: { insert: () => chain }, neonSql: vi.fn() }));
    const w = await import('@/db/write');
    await expect(w.upsertPhotobookSetting({ personName: '成田凌', productId: 'p1' })).rejects.toThrow('db down');
    expect(calls).toEqual([]);
  });
});

describe('写真集の集計結果のキャッシュ', () => {
  it('公開用の集計結果と検索候補を1時間キャッシュし、写真集・公開一覧のタグで無効化できる', async () => {
    vi.resetModules();
    const registered: { keys: string[]; opts: { revalidate: number; tags: string[] } }[] = [];
    vi.doMock('next/cache', () => ({
      unstable_cache: (fn: unknown, keys: string[], opts: { revalidate: number; tags: string[] }) => { registered.push({ keys, opts }); return fn; },
      revalidateTag: vi.fn(), revalidatePath: vi.fn(),
    }));
    vi.doMock('@/db/client', () => ({ db: {} }));
    vi.doUnmock('@/lib/public-listing-cache'); // 上のテストの差し替えを戻し、実物のタグ名を使う
    await import('@/lib/photobook-store');
    expect(registered.map((r) => r.keys[0]).sort()).toEqual(['photobook-facets', 'photobook-published-items']);
    for (const r of registered) {
      expect(r.opts.revalidate).toBe(3600);
      expect(r.opts.tags).toEqual(['photobook-home', PUBLIC_LISTING_CACHE_TAG]);
    }
  });

  it('管理画面用の取得（getAllPhotobookItems・getAdminPhotobookRows）はキャッシュしない', () => {
    const src = read('src/lib/photobook-store.ts');
    expect(src).toMatch(/export async function getAllPhotobookItems\(\)[^{]*\{\n  const \[candidates, maps\] = await Promise\.all\(\[fetchAllCandidates\(\)/);
    expect(src).toMatch(/export async function getAdminPhotobookRows\(\)[^{]*\{\n  const \[candidates, maps\] = await Promise\.all\(\[fetchAllCandidatesForAdmin\(\)/);
  });
});
