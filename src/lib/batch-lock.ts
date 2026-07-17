// 一括実行ロック（lease方式 / Neon PostgreSQL）
// product-check-bulk の同時実行を1セッションに制限する
//
// 排他制御の仕組み:
//   INSERT ... ON CONFLICT DO UPDATE ... WHERE <期限切れ or 完了済み>
//   WHERE が偽（= 有効なロックが存在）のときは行が更新されず RETURNING が空になる
//   → 取得失敗として扱う（アトミック操作）

import { db, neonSql } from '@/db/client';
import { batchLock } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const BULK_LOCK_KEY = 'product-check-bulk';

// ロックの有効期間: 10分（通常の全件バッチは1〜2分で完了）
const LOCK_TTL_MS = 10 * 60 * 1000;

export interface BatchLockStatus {
  isLocked: boolean;
  ownerId: string | null;
  status: string | null;
  acquiredAt: Date | null;
  heartbeatAt: Date | null;
  expiresAt: Date | null;
}

export async function getBatchLockStatus(): Promise<BatchLockStatus> {
  const empty: BatchLockStatus = {
    isLocked: false,
    ownerId: null,
    status: null,
    acquiredAt: null,
    heartbeatAt: null,
    expiresAt: null,
  };
  try {
    const rows = await db.select().from(batchLock).where(eq(batchLock.lockKey, BULK_LOCK_KEY));
    if (!rows.length) return empty;
    const row = rows[0];
    const isLocked = row.status === 'running' && row.expiresAt > new Date();
    return {
      isLocked,
      ownerId:     row.ownerId,
      status:      row.status,
      acquiredAt:  row.acquiredAt,
      heartbeatAt: row.heartbeatAt,
      expiresAt:   row.expiresAt,
    };
  } catch (err) {
    console.error('[batch-lock] getBatchLockStatus failed:', String(err));
    return empty;
  }
}

// ロック取得（アトミック conditional upsert）
// 戻り値: true = 取得成功, false = 別の有効なロックが存在
export async function acquireBatchLock(ownerId: string): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
  try {
    const result = await neonSql`
      INSERT INTO batch_lock (lock_key, owner_id, status, acquired_at, heartbeat_at, expires_at)
      VALUES (
        ${BULK_LOCK_KEY}, ${ownerId}, 'running',
        ${now}, ${now}, ${expiresAt}
      )
      ON CONFLICT (lock_key) DO UPDATE SET
        owner_id     = EXCLUDED.owner_id,
        status       = 'running',
        acquired_at  = EXCLUDED.acquired_at,
        heartbeat_at = EXCLUDED.heartbeat_at,
        expires_at   = EXCLUDED.expires_at
      WHERE batch_lock.expires_at < NOW()
         OR batch_lock.status IN ('completed', 'failed')
      RETURNING owner_id
    `;
    return Array.isArray(result) && result.length > 0;
  } catch (err) {
    console.error('[batch-lock] acquireBatchLock failed:', String(err));
    return false;
  }
}

// ロック更新（heartbeat: expires_at を延長）
// 戻り値: true = 更新成功, false = ロックが自分のものでない / 期限切れ
export async function renewBatchLock(ownerId: string): Promise<boolean> {
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
  try {
    const result = await neonSql`
      UPDATE batch_lock
      SET heartbeat_at = NOW(), expires_at = ${expiresAt}
      WHERE lock_key = ${BULK_LOCK_KEY}
        AND owner_id  = ${ownerId}
        AND status    = 'running'
      RETURNING owner_id
    `;
    return Array.isArray(result) && result.length > 0;
  } catch {
    return false;
  }
}

// ロック解放（status を completed/failed に更新し expires_at = NOW() で即失効）
export async function releaseBatchLock(
  ownerId: string,
  status: 'completed' | 'failed',
): Promise<void> {
  try {
    await neonSql`
      UPDATE batch_lock
      SET status = ${status}, expires_at = NOW()
      WHERE lock_key = ${BULK_LOCK_KEY}
        AND owner_id  = ${ownerId}
    `;
  } catch (err) {
    console.error('[batch-lock] releaseBatchLock failed:', String(err));
  }
}
