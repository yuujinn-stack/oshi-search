import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted() で vi.mock ファクトリより先にモックを確保する
const { mockNeonSql, mockWhere, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockWhere = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockNeonSql = vi.fn();
  return { mockNeonSql, mockWhere, mockFrom, mockSelect };
});

vi.mock('@/db/client', () => ({
  neonSql: mockNeonSql,
  db: { select: mockSelect },
}));

vi.mock('@/db/schema', () => ({
  batchLock: { lockKey: 'lock_key', $inferSelect: {} },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

import {
  getBatchLockStatus,
  acquireBatchLock,
  renewBatchLock,
  releaseBatchLock,
  BULK_LOCK_KEY,
} from '../batch-lock';

describe('batch-lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
  });

  // ─── BULK_LOCK_KEY ───────────────────────────────────────────────────────────

  it('[L1] BULK_LOCK_KEY は "product-check-bulk"', () => {
    expect(BULK_LOCK_KEY).toBe('product-check-bulk');
  });

  // ─── getBatchLockStatus ──────────────────────────────────────────────────────

  it('[L2] ロック行なし → isLocked=false', async () => {
    mockWhere.mockResolvedValue([]);
    const result = await getBatchLockStatus();
    expect(result.isLocked).toBe(false);
    expect(result.ownerId).toBeNull();
  });

  it('[L3] status=running かつ expiresAt が未来 → isLocked=true', async () => {
    mockWhere.mockResolvedValue([{
      lockKey: BULK_LOCK_KEY,
      ownerId: 'owner-abc',
      status: 'running',
      acquiredAt: new Date(),
      heartbeatAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    }]);
    const result = await getBatchLockStatus();
    expect(result.isLocked).toBe(true);
    expect(result.ownerId).toBe('owner-abc');
  });

  it('[L4] status=running だが expiresAt が過去 → isLocked=false（期限切れ）', async () => {
    mockWhere.mockResolvedValue([{
      lockKey: BULK_LOCK_KEY,
      ownerId: 'owner-old',
      status: 'running',
      acquiredAt: new Date(Date.now() - 20 * 60 * 1000),
      heartbeatAt: new Date(Date.now() - 20 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1000),
    }]);
    const result = await getBatchLockStatus();
    expect(result.isLocked).toBe(false);
    expect(result.status).toBe('running');
  });

  it('[L5] status=completed → isLocked=false', async () => {
    mockWhere.mockResolvedValue([{
      lockKey: BULK_LOCK_KEY,
      ownerId: 'owner-done',
      status: 'completed',
      acquiredAt: new Date(),
      heartbeatAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    }]);
    const result = await getBatchLockStatus();
    expect(result.isLocked).toBe(false);
  });

  it('[L6] status=failed → isLocked=false', async () => {
    mockWhere.mockResolvedValue([{
      lockKey: BULK_LOCK_KEY,
      ownerId: 'owner-err',
      status: 'failed',
      acquiredAt: new Date(),
      heartbeatAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    }]);
    const result = await getBatchLockStatus();
    expect(result.isLocked).toBe(false);
  });

  it('[L7] DB エラー → isLocked=false（fail-open）', async () => {
    mockWhere.mockRejectedValue(new Error('DB connection lost'));
    const result = await getBatchLockStatus();
    expect(result.isLocked).toBe(false);
  });

  // ─── acquireBatchLock ────────────────────────────────────────────────────────

  it('[L8] neonSql が行を返す → 取得成功 true', async () => {
    mockNeonSql.mockResolvedValue([{ owner_id: 'owner-new' }]);
    const result = await acquireBatchLock('owner-new');
    expect(result).toBe(true);
    expect(mockNeonSql).toHaveBeenCalledTimes(1);
  });

  it('[L9] neonSql が空配列 → 取得失敗 false（別の有効なロックが存在）', async () => {
    mockNeonSql.mockResolvedValue([]);
    const result = await acquireBatchLock('owner-new');
    expect(result).toBe(false);
  });

  it('[L10] neonSql が例外 → 取得失敗 false（fail-open）', async () => {
    mockNeonSql.mockRejectedValue(new Error('SQL error'));
    const result = await acquireBatchLock('owner-crash');
    expect(result).toBe(false);
  });

  // ─── renewBatchLock ──────────────────────────────────────────────────────────

  it('[L11] 自分の ownerId で更新成功 → true', async () => {
    mockNeonSql.mockResolvedValue([{ owner_id: 'owner-abc' }]);
    const result = await renewBatchLock('owner-abc');
    expect(result).toBe(true);
  });

  it('[L12] ownerId 不一致（WHERE にマッチしない） → false', async () => {
    mockNeonSql.mockResolvedValue([]);
    const result = await renewBatchLock('wrong-owner');
    expect(result).toBe(false);
  });

  it('[L13] renewBatchLock: DB エラー → false（fail-open）', async () => {
    mockNeonSql.mockRejectedValue(new Error('DB error'));
    const result = await renewBatchLock('owner-abc');
    expect(result).toBe(false);
  });

  // ─── releaseBatchLock ────────────────────────────────────────────────────────

  it('[L14] releaseBatchLock completed: neonSql を1回呼ぶ', async () => {
    mockNeonSql.mockResolvedValue([]);
    await releaseBatchLock('owner-abc', 'completed');
    expect(mockNeonSql).toHaveBeenCalledTimes(1);
  });

  it('[L15] releaseBatchLock failed: neonSql を1回呼ぶ', async () => {
    mockNeonSql.mockResolvedValue([]);
    await releaseBatchLock('owner-abc', 'failed');
    expect(mockNeonSql).toHaveBeenCalledTimes(1);
  });

  it('[L16] releaseBatchLock: DB エラーでも例外を投げない（fail-safe）', async () => {
    mockNeonSql.mockRejectedValue(new Error('release error'));
    await expect(releaseBatchLock('owner-abc', 'completed')).resolves.toBeUndefined();
  });
});
