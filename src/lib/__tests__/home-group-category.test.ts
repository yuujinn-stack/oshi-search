import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOME_GROUP_CATEGORIES,
  buildHomeCategoryOverrides,
  findHomeGroupCategory,
  getHomeGroupCategory,
  isHomeGroupCategory,
} from '../home-group-category';
import { registeredCategoryOf } from '../video-registered-groups';

// トップページ「グループで探す」の分類: 管理画面で保存した値（group_meta.home_category）→ 初期値の一覧 → その他
describe('トップページの分類（初期値）', () => {
  it('超特急・FANTASTICS は男性アイドル（初期設定）', () => {
    expect(getHomeGroupCategory('超特急')).toBe('maleIdol');
    expect(getHomeGroupCategory('FANTASTICS')).toBe('maleIdol');
    expect(registeredCategoryOf('超特急')).toBe('male');
    expect(registeredCategoryOf('FANTASTICS')).toBe('male');
  });

  it('既存のグループの分類は変わらない', () => {
    expect(getHomeGroupCategory('乃木坂46')).toBe('femaleIdol');
    expect(getHomeGroupCategory('＝LOVE')).toBe('femaleIdol');
    expect(getHomeGroupCategory('Snow Man')).toBe('maleIdol');
    expect(getHomeGroupCategory('オードリー')).toBe('other');
    expect(getHomeGroupCategory('モナキ')).toBe('other');
    expect(getHomeGroupCategory('新しいグループ')).toBe('other');
    expect(findHomeGroupCategory('新しいグループ')).toBeNull();
  });

  it('分類は女性アイドル・男性アイドル・その他の3つだけ', () => {
    expect(HOME_GROUP_CATEGORIES).toEqual(['femaleIdol', 'maleIdol', 'other']);
    expect(isHomeGroupCategory('maleIdol')).toBe(true);
    expect(isHomeGroupCategory('band')).toBe(false);
    expect(isHomeGroupCategory(null)).toBe(false);
  });
});

describe('管理画面で保存した分類を優先する', () => {
  it('DB の値が初期値の一覧より優先され、他のグループには影響しない', () => {
    const overrides = buildHomeCategoryOverrides([
      { groupName: 'モナキ', homeCategory: 'maleIdol' },
      { groupName: 'Snow Man', homeCategory: 'other' },
      { groupName: '新しいグループ', homeCategory: 'femaleIdol' },
      { groupName: '嵐', homeCategory: null },
      { groupName: '乃木坂46' },
    ]);
    expect(getHomeGroupCategory('モナキ', overrides)).toBe('maleIdol');
    expect(getHomeGroupCategory('Snow Man', overrides)).toBe('other');
    expect(getHomeGroupCategory('新しいグループ', overrides)).toBe('femaleIdol');
    // 未設定の行は初期値の一覧のまま
    expect(getHomeGroupCategory('嵐', overrides)).toBe('maleIdol');
    expect(getHomeGroupCategory('乃木坂46', overrides)).toBe('femaleIdol');
    expect(getHomeGroupCategory('オードリー', overrides)).toBe('other');
    // 動画（登録グループ紹介）も同じ優先順位
    expect(registeredCategoryOf('モナキ', overrides)).toBe('male');
    expect(registeredCategoryOf('新しいグループ', overrides)).toBe('female');
    expect(registeredCategoryOf('別の新グループ', overrides)).toBe('unclassified');
  });

  it('不正な値は無視する（初期値の一覧で判定）', () => {
    const overrides = buildHomeCategoryOverrides([{ groupName: 'Snow Man', homeCategory: 'band' }]);
    expect(overrides.size).toBe(0);
    expect(getHomeGroupCategory('Snow Man', overrides)).toBe('maleIdol');
  });

  it('グループ名は NFKC 正規化して照合する（全角＝・前後の空白）', () => {
    const overrides = buildHomeCategoryOverrides([{ groupName: ' ＝LOVE ', homeCategory: 'other' }]);
    expect(getHomeGroupCategory('=LOVE', overrides)).toBe('other');
  });
});

describe('DB 書き込み: CSVインポート・編集フォームの保存で分類が戻らない', () => {
  beforeEach(() => vi.resetModules());

  function mockDb() {
    const captured: { insertValues?: Record<string, unknown>; conflictSet?: Record<string, unknown>; updateSet?: Record<string, unknown> } = {};
    const calls: string[] = [];
    vi.doMock('@/lib/public-listing-cache', () => ({ revalidatePublicListings: () => calls.push('revalidate') }));
    vi.doMock('@/lib/batch-lock', () => ({ getBatchLockStatus: vi.fn(), PRODUCT_ID_MIGRATION_LOCK_KEY: 'k' }));
    const insertChain = {
      values: (v: Record<string, unknown>) => { captured.insertValues = v; return insertChain; },
      onConflictDoUpdate: (o: { set: Record<string, unknown> }) => { captured.conflictSet = o.set; return Promise.resolve(); },
    };
    let returningRows: unknown[] = [{ groupName: '超特急' }];
    const updateChain = {
      set: (v: Record<string, unknown>) => { captured.updateSet = v; return updateChain; },
      where: () => updateChain,
      returning: async () => returningRows,
    };
    vi.doMock('@/db/client', () => ({ db: { insert: () => insertChain, update: () => updateChain }, neonSql: vi.fn() }));
    return { captured, calls, setReturning: (rows: unknown[]) => { returningRows = rows; } };
  }

  it('upsertGroupMeta（編集フォーム・ensureGroupMeta）は home_category を書き込まない', async () => {
    const { captured } = mockDb();
    const w = await import('@/db/write');
    await w.upsertGroupMeta({ groupName: '超特急', slug: 'x', activityStatus: 'active', homeCategory: 'other' } as Parameters<typeof w.upsertGroupMeta>[0]);
    expect(captured.insertValues).not.toHaveProperty('homeCategory');
    expect(captured.conflictSet).not.toHaveProperty('homeCategory');
    expect(captured.conflictSet).toHaveProperty('slug', 'x');
  });

  it('updateGroupHomeCategoryInDB は home_category（と更新日時）だけを更新し、公開キャッシュを無効化する', async () => {
    const { captured, calls, setReturning } = mockDb();
    const w = await import('@/db/write');
    expect(await w.updateGroupHomeCategoryInDB('超特急', 'maleIdol')).toBe(true);
    expect(Object.keys(captured.updateSet ?? {}).sort()).toEqual(['homeCategory', 'updatedAt']);
    expect(captured.updateSet?.homeCategory).toBe('maleIdol');
    expect(calls).toEqual(['revalidate']);
    // 行が無ければ false（新規作成しない・無効化しない）
    setReturning([]);
    expect(await w.updateGroupHomeCategoryInDB('存在しない', 'other')).toBe(false);
    expect(calls).toEqual(['revalidate']);
  });
});

describe('home_category 列が未作成（db-init 前にデプロイ）でもグループ一覧を読める', () => {
  beforeEach(() => vi.resetModules());

  it('列が無いエラー（drizzle の cause に 42703）のときは列を除いて読み直し、分類は初期値の一覧で判定', async () => {
    const selects: unknown[] = [];
    const missing = Object.assign(new Error('Failed query: select "group_name", "home_category" from "group_meta"'), {
      cause: Object.assign(new Error('column "home_category" does not exist'), { code: '42703' }),
    });
    vi.doMock('@/db/write', () => ({ upsertGroupMeta: vi.fn(), deleteGroupMetaInDB: vi.fn(), updateGroupHomeCategoryInDB: vi.fn() }));
    vi.doMock('@/db/client', () => ({
      db: {
        select: (cols?: Record<string, unknown>) => {
          selects.push(cols);
          return { from: () => (cols ? Promise.resolve([{ groupName: '超特急', slug: 's', activityStatus: 'active', formerNames: [], createdAt: new Date(0), updatedAt: new Date(0) }]) : Promise.reject(missing)) };
        },
      },
    }));
    const gm = await import('@/lib/group-meta');
    const metas = await gm.getAllGroupMetasOrThrow();
    expect(selects).toHaveLength(2);
    expect(Object.keys(selects[1] as object)).not.toContain('homeCategory');
    expect(metas.map((m) => [m.groupName, m.homeCategory])).toEqual([['超特急', undefined]]);
    expect(getHomeGroupCategory('超特急', buildHomeCategoryOverrides(metas))).toBe('maleIdol');
  });

  it('それ以外の DB エラーはそのまま投げる', async () => {
    vi.doMock('@/db/write', () => ({ upsertGroupMeta: vi.fn(), deleteGroupMetaInDB: vi.fn(), updateGroupHomeCategoryInDB: vi.fn() }));
    vi.doMock('@/db/client', () => ({ db: { select: () => ({ from: () => Promise.reject(new Error('db down')) }) } }));
    const gm = await import('@/lib/group-meta');
    await expect(gm.getAllGroupMetasOrThrow()).rejects.toThrow('db down');
    expect(gm.isMissingHomeCategoryColumn(new Error('column "gender" does not exist'))).toBe(false);
  });
});
