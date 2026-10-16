import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBatchLockStatus = vi.fn();
const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/batch-lock', () => ({
  PRODUCT_ID_MIGRATION_LOCK_KEY: 'product-id-migration',
  getBatchLockStatus: (...a: unknown[]) => getBatchLockStatus(...a),
}));
vi.mock('@/db/client', () => ({
  db: { insert: () => ({ values: () => ({ onConflictDoUpdate }) }) },
  neonSql: vi.fn(),
}));

import { upsertProduct } from '@/db/write';

describe('商品ID移行中は商品データの書き込みを止める（upsertProduct）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('移行ロックが有効なら書き込まずにエラー', async () => {
    getBatchLockStatus.mockResolvedValue({ isLocked: true });
    await expect(upsertProduct('p', 'グッズ', [], Date.now())).rejects.toThrow('商品ID移行中');
    expect(getBatchLockStatus).toHaveBeenCalledWith('product-id-migration');
    expect(onConflictDoUpdate).not.toHaveBeenCalled();
  });

  it('移行ロックが無ければ従来どおり書き込む', async () => {
    getBatchLockStatus.mockResolvedValue({ isLocked: false });
    await upsertProduct('p', 'グッズ', [{ id: 'x' }], Date.now());
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });
});
