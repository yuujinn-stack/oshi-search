/**
 * Redis 削除後の DB 単独書き込みテスト
 *
 * Redis フォールバックを削除し、全ての書き込みは常に Neon DB のみへ行く。
 * DB_ONLY_WRITE_ENABLED フラグに関係なく DB 関数が呼ばれ、Redis は呼ばれない。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── モジュールモック ─────────────────────────────────────────────────────────

// db-flag を制御するモック（フラグ値に関わらず常に DB のみ使うことを確認）
vi.mock('@/lib/db-flag', () => ({
  isDbReadEnabled:      vi.fn(() => false),
  isDbOnlyReadEnabled:  vi.fn(() => false),
  isDbOnlyWriteEnabled: vi.fn(() => false),
}));

// Redis モック（呼ばれないことを確認するために残す）
const hset = vi.fn().mockResolvedValue(1);
const hdel = vi.fn().mockResolvedValue(1);
const hget = vi.fn();
vi.mock('@/lib/redis', () => ({
  getRedis: () => ({ hset, hdel, hget }),
}));

// DB write 関数モック
const upsertWork = vi.fn().mockResolvedValue(undefined);
const upsertVerdict = vi.fn().mockResolvedValue(undefined);
const upsertProduct = vi.fn().mockResolvedValue(undefined);
const deleteVerdictInDB = vi.fn().mockResolvedValue(undefined);
vi.mock('@/db/write', () => ({
  dbWrite:            (_label: string, fn: () => Promise<void>) => fn().catch(() => {}),
  upsertWork:         (...args: unknown[]) => upsertWork(...args),
  upsertVerdict:      (...args: unknown[]) => upsertVerdict(...args),
  upsertProduct:      (...args: unknown[]) => upsertProduct(...args),
  deleteVerdictInDB:  (...args: unknown[]) => deleteVerdictInDB(...args),
  upsertPersonMeta:   vi.fn().mockResolvedValue(undefined),
  upsertPersonFromImport: vi.fn().mockResolvedValue(undefined),
  updatePersonFetchStatusInDB: vi.fn().mockResolvedValue(undefined),
  deleteImportedPersonInDB: vi.fn().mockResolvedValue(undefined),
  upsertGroupMeta:    vi.fn().mockResolvedValue(undefined),
  deleteGroupMetaInDB: vi.fn().mockResolvedValue(undefined),
  upsertVodProvider:  vi.fn().mockResolvedValue(undefined),
  deleteVodProviderInDB: vi.fn().mockResolvedValue(undefined),
  publishPersonInDB:  vi.fn().mockResolvedValue(undefined),
  unpublishPersonInDB: vi.fn().mockResolvedValue(undefined),
}));

// db.select/delete チェーンモック
const mockDeleteReturning = vi.fn().mockResolvedValue([]);
const mockDeleteWhere     = vi.fn().mockReturnValue({ returning: mockDeleteReturning });
const mockDelete          = vi.fn().mockReturnValue({ where: mockDeleteWhere });
const mockSelectFrom      = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
const mockSelect          = vi.fn().mockReturnValue({ from: mockSelectFrom });
vi.mock('@/db/client', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

// schema モック（テーブルオブジェクトが eq/and などの引数として使われるだけ）
vi.mock('@/db/schema', () => ({
  works:        { personName: 'personName', id: 'id', source: 'source' },
  products:     { personName: 'personName', category: 'category' },
  verdicts:     { personName: 'personName', productId: 'productId' },
  personMeta:   { personName: 'personName' },
  groupMeta:    { groupName: 'groupName' },
  vodProviders: { slug: 'slug' },
  persons:      { name: 'name', source: 'source' },
}));

// drizzle-orm モック
vi.mock('drizzle-orm', () => ({
  eq:  (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...args: unknown[])     => ({ and: args }),
  isNotNull: (a: unknown)       => ({ isNotNull: a }),
}));

const sampleWork = {
  id: 'work-1',
  personName: '鈴木愛理',
  title: 'テスト作品',
  type: 'movie' as const,
  source: 'tmdb' as const,
  status: 'auto_published' as const,
  normalizedTitle: 'テスト作品',
  confidenceScore: 1,
  deleted: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// ── テスト ───────────────────────────────────────────────────────────────────

describe('saveWork', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('常に upsertWork が呼ばれ、Redis hset は呼ばれない', async () => {
    const { saveWork } = await import('@/lib/work-store');
    await saveWork(sampleWork);
    expect(upsertWork).toHaveBeenCalledOnce();
    expect(hset).not.toHaveBeenCalled();
  });

  it('DB_ONLY_WRITE_ENABLED=false でも upsertWork が呼ばれ、Redis は呼ばれない', async () => {
    // フラグ値に関係なく常に DB のみ
    const { saveWork } = await import('@/lib/work-store');
    await saveWork(sampleWork);
    expect(upsertWork).toHaveBeenCalledOnce();
    expect(hset).not.toHaveBeenCalled();
  });
});

describe('deleteWorksBySource', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('db.delete が呼ばれ、Redis hdel は呼ばれない', async () => {
    mockDeleteReturning.mockResolvedValueOnce([{ id: 'w1' }, { id: 'w2' }]);
    const { deleteWorksBySource } = await import('@/lib/work-store');
    const count = await deleteWorksBySource('鈴木愛理', 'tmdb');
    expect(count).toBe(2);
    expect(mockDelete).toHaveBeenCalled();
    expect(hdel).not.toHaveBeenCalled();
  });

  it('対象なし → 0 件', async () => {
    mockDeleteReturning.mockResolvedValueOnce([]);
    const { deleteWorksBySource } = await import('@/lib/work-store');
    const count = await deleteWorksBySource('鈴木愛理', 'tmdb');
    expect(count).toBe(0);
  });
});

describe('saveVerdict (judgment-store)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('常に upsertVerdict が呼ばれ、Redis hset は呼ばれない', async () => {
    const { saveVerdict } = await import('@/lib/judgment-store');
    await saveVerdict('鈴木愛理', 'product-1', 'related', 1, 'manual');
    expect(upsertVerdict).toHaveBeenCalledOnce();
    expect(hset).not.toHaveBeenCalled();
  });
});

describe('deleteVerdict (judgment-store)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('常に deleteVerdictInDB が呼ばれ、Redis hdel は呼ばれない', async () => {
    const { deleteVerdict } = await import('@/lib/judgment-store');
    await deleteVerdict('鈴木愛理', 'product-1');
    expect(deleteVerdictInDB).toHaveBeenCalledOnce();
    expect(hdel).not.toHaveBeenCalled();
  });
});

describe('storeProducts (product-store)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('常に upsertProduct が呼ばれ、Redis hset は呼ばれない', async () => {
    mockSelect.mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
    const { storeProducts } = await import('@/lib/product-store');
    await storeProducts('鈴木愛理', '写真集', []);
    expect(upsertProduct).toHaveBeenCalledOnce();
    expect(hset).not.toHaveBeenCalled();
  });
});
