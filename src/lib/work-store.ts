// 出演作品データの永続ストレージ（Upstash Redis）
// バッチ・管理画面からのみ書き込み、人物ページから読み取る

import { getRedis } from './redis';
import type { WorkRecord, WorkStatus } from '@/types/work';

// Redis hash key: "works:{personName}" → field: workId → value: WorkRecord JSON
function hashKey(personName: string): string {
  return `works:${personName}`;
}

// 人物の全作品を取得
export async function getAllWorks(personName: string): Promise<WorkRecord[]> {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const raw = await redis.hgetall(hashKey(personName));
    if (!raw) return [];
    return Object.values(raw)
      .map((v) => {
        try {
          return (typeof v === 'string' ? JSON.parse(v) : v) as WorkRecord;
        } catch {
          return null;
        }
      })
      .filter((w): w is WorkRecord => w !== null);
  } catch {
    return [];
  }
}

// 公開中（auto_published）の作品のみ取得（人物ページ表示用）
export async function getPublishedWorks(personName: string): Promise<WorkRecord[]> {
  const all = await getAllWorks(personName);
  return all
    .filter((w) => w.status === 'auto_published')
    .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
}

// 作品を保存（新規・更新どちらも）
export async function saveWork(work: WorkRecord): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hset(hashKey(work.personName), { [work.id]: JSON.stringify(work) });
}

// ステータスのみ更新（管理画面からの手動判定）
export async function updateWorkStatus(
  personName: string,
  workId: string,
  status: WorkStatus,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const raw = await redis.hget(hashKey(personName), workId);
  if (!raw) return;
  try {
    const work = (typeof raw === 'string' ? JSON.parse(raw) : raw) as WorkRecord;
    work.status = status;
    work.checkedAt = Date.now();
    work.updatedAt = Date.now();
    await redis.hset(hashKey(personName), { [workId]: JSON.stringify(work) });
  } catch { /* skip */ }
}

// 作品を削除
export async function deleteWork(personName: string, workId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.hdel(hashKey(personName), workId);
}

// source別に一括削除（AI補完作品を再実行する際に使用）
export async function deleteWorksBySource(
  personName: string,
  source: string,
): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  const all = await getAllWorks(personName);
  const targets = all.filter((w) => w.source === source);
  if (!targets.length) return 0;
  await redis.hdel(hashKey(personName), ...targets.map((w) => w.id));
  return targets.length;
}
