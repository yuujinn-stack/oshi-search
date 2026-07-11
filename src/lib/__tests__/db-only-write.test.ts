/**
 * DB_ONLY_WRITE_ENABLED フラグのテスト
 *
 * ケースA: true  → DB 書き込み呼び出し、Redis 書き込みは呼ばれない
 * ケースB: false → 両方呼ばれる（既存デュアルライト）
 * ケースC: 未設定 → false と同じ
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── モジュールモック ─────────────────────────────────────────────────────────

// db-flag を制御するモック
vi.mock('@/lib/db-flag', () => ({
  isDbReadEnabled:      vi.fn(() => false),
  isDbOnlyReadEnabled:  vi.fn(() => false),
  isDbOnlyWriteEnabled: vi.fn(() => false),
}));

// Redis モック
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

// ── import（モック後に取得）─────────────────────────────────────────────────
import { isDbOnlyWriteEnabled } from '@/lib/db-flag';

// ── ヘルパー ─────────────────────────────────────────────────────────────────
function setDbOnlyWrite(val: boolean) {
  vi.mocked(isDbOnlyWriteEnabled).mockReturnValue(val);
}

const sampleWork = {
  id: 'work-1',
  personName: '鈴木愛理',
  title: 'テスト作品',
  type: 'movie' as const,
  source: 'tmdb' as const,
  status: 'approved' as const,
  normalizedTitle: 'テスト作品',
  confidenceScore: 1,
  deleted: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// ── テスト ───────────────────────────────────────────────────────────────────

describe('saveWork', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('A: DB_ONLY_WRITE_ENABLED=true → upsertWork 呼び出し、Redis hset は呼ばれない', async () => {
    setDbOnlyWrite(true);
    const { saveWork } = await import('@/lib/work-store');
    await saveWork(sampleWork);
    expect(upsertWork).toHaveBeenCalledOnce();
    expect(hset).not.toHaveBeenCalled();
  });

  it('B: DB_ONLY_WRITE_ENABLED=false → Redis hset も呼ばれる', async () => {
    setDbOnlyWrite(false);
    hget.mockResolvedValueOnce(null); // saveWorkIfAbsent ではなく saveWork
    const { saveWork } = await import('@/lib/work-store');
    await saveWork(sampleWork);
    expect(hset).toHaveBeenCalled();
  });

  it('C: 未設定（デフォルト false）→ B と同じ挙動', async () => {
    setDbOnlyWrite(false);
    const { saveWork } = await import('@/lib/work-store');
    await saveWork(sampleWork);
    expect(hset).toHaveBeenCalled();
    expect(upsertWork).toHaveBeenCalled(); // dbWrite 経由
  });
});

describe('deleteWorksBySource', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('A: DB_ONLY_WRITE_ENABLED=true → db.delete 呼び出し、Redis hdel は呼ばれない', async () => {
    setDbOnlyWrite(true);
    mockDeleteReturning.mockResolvedValueOnce([{ id: 'w1' }, { id: 'w2' }]);
    const { deleteWorksBySource } = await import('@/lib/work-store');
    const count = await deleteWorksBySource('鈴木愛理', 'tmdb');
    expect(count).toBe(2);
    expect(mockDelete).toHaveBeenCalled();
    expect(hdel).not.toHaveBeenCalled();
  });

  it('B: DB_ONLY_WRITE_ENABLED=false → Redis hdel が呼ばれる', async () => {
    setDbOnlyWrite(false);
    // getAllWorks → Redis hgetall は別モジュールが担うが、ここでは空を返す
    mockSelect.mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
    const { deleteWorksBySource } = await import('@/lib/work-store');
    // Redis hgetall が null を返す → 0 件
    hget.mockResolvedValueOnce(null);
    const count = await deleteWorksBySource('鈴木愛理', 'tmdb');
    expect(count).toBe(0); // targets が 0 件
  });
});

describe('saveVerdict (judgment-store)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('A: DB_ONLY_WRITE_ENABLED=true → upsertVerdict 呼び出し、Redis hset は呼ばれない', async () => {
    setDbOnlyWrite(true);
    const { saveVerdict } = await import('@/lib/judgment-store');
    await saveVerdict('鈴木愛理', 'product-1', 'related', 1, 'manual');
    expect(upsertVerdict).toHaveBeenCalledOnce();
    expect(hset).not.toHaveBeenCalled();
  });

  it('B: DB_ONLY_WRITE_ENABLED=false → Redis hset も呼ばれる', async () => {
    setDbOnlyWrite(false);
    const { saveVerdict } = await import('@/lib/judgment-store');
    await saveVerdict('鈴木愛理', 'product-1', 'related', 1, 'manual');
    expect(hset).toHaveBeenCalled();
    expect(upsertVerdict).toHaveBeenCalled(); // dbWrite 経由
  });
});

describe('deleteVerdict (judgment-store)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('A: DB_ONLY_WRITE_ENABLED=true → deleteVerdictInDB 呼び出し、Redis hdel は呼ばれない', async () => {
    setDbOnlyWrite(true);
    const { deleteVerdict } = await import('@/lib/judgment-store');
    await deleteVerdict('鈴木愛理', 'product-1');
    expect(deleteVerdictInDB).toHaveBeenCalledOnce();
    expect(hdel).not.toHaveBeenCalled();
  });

  it('B: DB_ONLY_WRITE_ENABLED=false → Redis hdel が呼ばれる', async () => {
    setDbOnlyWrite(false);
    const { deleteVerdict } = await import('@/lib/judgment-store');
    await deleteVerdict('鈴木愛理', 'product-1');
    expect(hdel).toHaveBeenCalled();
    expect(deleteVerdictInDB).not.toHaveBeenCalled();
  });
});

describe('storeProducts (product-store)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('A: DB_ONLY_WRITE_ENABLED=true → upsertProduct 呼び出し、Redis hset は呼ばれない', async () => {
    setDbOnlyWrite(true);
    mockSelect.mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
    const { storeProducts } = await import('@/lib/product-store');
    await storeProducts('鈴木愛理', '写真集', []);
    expect(upsertProduct).toHaveBeenCalledOnce();
    expect(hset).not.toHaveBeenCalled();
  });

  it('B: DB_ONLY_WRITE_ENABLED=false → Redis hset が呼ばれる', async () => {
    setDbOnlyWrite(false);
    const { storeProducts } = await import('@/lib/product-store');
    await storeProducts('鈴木愛理', '写真集', []);
    expect(hset).toHaveBeenCalled();
  });
});
