// 出演作品データの永続ストレージ（Upstash Redis）
// バッチ・管理画面からのみ書き込み、人物ページから読み取る

import { getRedis } from './redis';
import type { WorkRecord, WorkStatus } from '@/types/work';
import type { VodProvider } from '@/types/vod';

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

// 特定の作品を1件取得
export async function getWork(personName: string, workId: string): Promise<WorkRecord | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.hget(hashKey(personName), workId);
    if (!raw) return null;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) as WorkRecord;
  } catch {
    return null;
  }
}

// 配信サービス情報を更新（手動プロバイダーは保持し、指定ソースのみ置換）
// replaceSources で指定したソースのプロバイダーを新しいリストで置き換える
// 指定外のソース（manualなど）はそのまま残す
export async function updateWorkVod(
  personName: string,
  workId: string,
  providers: VodProvider[],
  options?: {
    replaceSources?: Array<'tmdb_watch_provider' | 'openai_supplement' | 'openai_web_search' | 'manual_import'>;
    vodAiCheckedAt?: number;
  },
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const raw = await redis.hget(hashKey(personName), workId);
  if (!raw) return;
  try {
    const work = (typeof raw === 'string' ? JSON.parse(raw) : raw) as WorkRecord;
    const replaceSources = options?.replaceSources ?? ['tmdb_watch_provider', 'openai_supplement', 'openai_web_search'];
    // 手動プロバイダーなど、置換対象外のものを保持
    const kept = (work.vodProviders ?? []).filter((p) => !replaceSources.includes(p.source as never));
    work.vodProviders = [...kept, ...providers];
    work.vodUpdatedAt = Date.now();
    if (options?.vodAiCheckedAt) work.vodAiCheckedAt = options.vodAiCheckedAt;
    work.updatedAt = Date.now();
    await redis.hset(hashKey(personName), { [workId]: JSON.stringify(work) });
  } catch { /* skip */ }
}

// 手動で配信サービスを1件追加（既存の tmdb_watch_provider は保持）
export async function addManualVodProvider(
  personName: string,
  workId: string,
  provider: VodProvider,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const raw = await redis.hget(hashKey(personName), workId);
  if (!raw) return;
  try {
    const work = (typeof raw === 'string' ? JSON.parse(raw) : raw) as WorkRecord;
    const existing = work.vodProviders ?? [];
    // 同じ providerId かつ source:manual は上書き
    const filtered = existing.filter(
      (p) => !(p.providerId === provider.providerId && p.source === 'manual'),
    );
    work.vodProviders = [...filtered, { ...provider, source: 'manual' }];
    work.vodUpdatedAt = Date.now();
    work.updatedAt = Date.now();
    await redis.hset(hashKey(personName), { [workId]: JSON.stringify(work) });
  } catch { /* skip */ }
}

// 手動配信サービスを1件削除
export async function removeManualVodProvider(
  personName: string,
  workId: string,
  providerId: number,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const raw = await redis.hget(hashKey(personName), workId);
  if (!raw) return;
  try {
    const work = (typeof raw === 'string' ? JSON.parse(raw) : raw) as WorkRecord;
    work.vodProviders = (work.vodProviders ?? []).filter(
      (p) => !(p.providerId === providerId && p.source === 'manual'),
    );
    work.vodUpdatedAt = Date.now();
    work.updatedAt = Date.now();
    await redis.hset(hashKey(personName), { [workId]: JSON.stringify(work) });
  } catch { /* skip */ }
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
