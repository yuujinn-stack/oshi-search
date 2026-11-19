import { beforeEach, describe, expect, it, vi } from 'vitest';

// site_settings の読み書き（作品画像の表示方式）と、PUT/GET /api/admin/work-image-display。
// DB は呼び出しだけを記録する偽物に置き換える（本物の DB には接続しない）。
const state = vi.hoisted(() => ({
  rows: [] as Array<{ key: string; value: string; updatedBy: string | null; updatedAt: Date }>,
  selectError: null as unknown,
  insertError: null as unknown,
  inserted: [] as unknown[],
  conflictSet: [] as unknown[],
  revalidatedTags: [] as string[],
  revalidatedPaths: [] as string[],
  publicListings: 0,
}));

vi.mock('@/db/client', () => {
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          if (state.selectError) throw state.selectError;
          return state.rows;
        },
      }),
    }),
  });
  const insert = () => ({
    values: (v: unknown) => {
      state.inserted.push(v);
      return {
        onConflictDoUpdate: async ({ set }: { set: unknown }) => {
          if (state.insertError) throw state.insertError;
          state.conflictSet.push(set);
        },
      };
    },
  });
  return { db: { select, insert } };
});
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: (t: string) => { state.revalidatedTags.push(t); },
  revalidatePath: (p: string) => { state.revalidatedPaths.push(p); },
}));
vi.mock('@/lib/public-listing-cache', () => ({ revalidatePublicListings: () => { state.publicListings++; } }));

import {
  getWorkImageDisplayMode,
  getWorkImageDisplaySetting,
  isMissingSiteSettingsTable,
  saveWorkImageDisplayMode,
  SITE_SETTINGS_CACHE_TAG,
} from '@/lib/site-settings';
import { GET, PUT } from '@/app/api/admin/work-image-display/route';

beforeEach(() => {
  state.rows = [];
  state.selectError = null;
  state.insertError = null;
  state.inserted = [];
  state.conflictSet = [];
  state.revalidatedTags = [];
  state.revalidatedPaths = [];
  state.publicListings = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const missingTable = Object.assign(new Error('relation "site_settings" does not exist'), { code: '42P01' });

describe('読み込み', () => {
  it('行が無ければ従来画像表示（未保存）', async () => {
    expect(await getWorkImageDisplaySetting()).toMatchObject({ mode: 'legacy', saved: false, loadError: null });
    expect(await getWorkImageDisplayMode()).toBe('legacy');
  });
  it('保存済みの d1 を読む', async () => {
    state.rows = [{ key: 'work_image_display', value: 'd1', updatedBy: 'admin', updatedAt: new Date('2026-11-19T00:00:00Z') }];
    expect(await getWorkImageDisplaySetting()).toMatchObject({ mode: 'd1', saved: true, updatedAt: '2026-11-19T00:00:00.000Z', updatedBy: 'admin' });
    expect(await getWorkImageDisplayMode()).toBe('d1');
  });
  it('想定外の値は従来画像表示として扱う', async () => {
    state.rows = [{ key: 'work_image_display', value: 'broken', updatedBy: null, updatedAt: new Date() }];
    expect(await getWorkImageDisplayMode()).toBe('legacy');
  });
  it('テーブル未作成（db-init 前）・DB エラーでも公開ページは従来画像表示で動く（例外を投げない）', async () => {
    state.selectError = new Error('wrapped', { cause: missingTable });
    expect(isMissingSiteSettingsTable(state.selectError)).toBe(true);
    const s = await getWorkImageDisplaySetting();
    expect(s.mode).toBe('legacy');
    expect(s.loadError).toContain('db-init');
    expect(await getWorkImageDisplayMode()).toBe('legacy');

    state.selectError = new Error('fetch failed');
    expect(isMissingSiteSettingsTable(state.selectError)).toBe(false);
    expect((await getWorkImageDisplaySetting()).loadError).toContain('読み込みに失敗');
    expect(await getWorkImageDisplayMode()).toBe('legacy');
  });
});

describe('保存', () => {
  it('upsert して公開ページのキャッシュを無効化する', async () => {
    const s = await saveWorkImageDisplayMode('d1');
    expect(s).toMatchObject({ mode: 'd1', saved: true, updatedBy: 'admin' });
    expect(state.inserted[0]).toMatchObject({ key: 'work_image_display', value: 'd1' });
    expect(state.conflictSet[0]).toMatchObject({ value: 'd1' });
    expect(state.revalidatedTags).toContain(SITE_SETTINGS_CACHE_TAG);
    expect(state.revalidatedPaths).toContain('/vod/[provider]');
    expect(state.publicListings).toBe(1);
  });
  it('不正な値は保存しない', async () => {
    await expect(saveWorkImageDisplayMode('x' as never)).rejects.toThrow();
    expect(state.inserted).toHaveLength(0);
  });
  it('DB エラーは例外にし、キャッシュは無効化しない', async () => {
    state.insertError = missingTable;
    await expect(saveWorkImageDisplayMode('legacy')).rejects.toThrow();
    expect(state.revalidatedTags).toHaveLength(0);
  });
});

const req = (body: unknown) =>
  new Request('http://localhost/api/admin/work-image-display', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('PUT/GET /api/admin/work-image-display', () => {
  it('d1 / legacy を保存できる（切り戻し）', async () => {
    for (const mode of ['d1', 'legacy']) {
      const res = await PUT(req({ mode }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, setting: { mode, saved: true } });
    }
  });
  it('不正な値・不正な JSON は 400（保存しない）', async () => {
    for (const body of [{ mode: 'D1' }, {}, { mode: null }, '{']) {
      const res = await PUT(req(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
    expect(state.inserted).toHaveLength(0);
  });
  it('保存失敗は 500 と error（画面に失敗を表示する）', async () => {
    state.insertError = missingTable;
    const res = await PUT(req({ mode: 'd1' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('保存に失敗しました');
  });
  it('GET は現在の設定を返す', async () => {
    state.rows = [{ key: 'work_image_display', value: 'd1', updatedBy: 'admin', updatedAt: new Date() }];
    expect(await (await GET()).json()).toMatchObject({ mode: 'd1', saved: true });
  });
});
