// 出演作品データの永続ストレージ（Neon DB）

import { db } from '@/db/client';
import { works as worksTable } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { upsertWork } from '@/db/write';
import type { WorkRecord, WorkStatus } from '@/types/work';
import type { VodProvider } from '@/types/vod';

// DB行 → WorkRecord マッピング（aiData/vodData JSONB を展開）
function dbRowToWorkRecord(r: typeof worksTable.$inferSelect): WorkRecord {
  const ai  = (r.aiData  ?? {}) as Record<string, unknown>;
  const vod = (r.vodData ?? {}) as Record<string, unknown>;
  return {
    id:              r.id,
    personName:      r.personName,
    title:           r.title,
    originalTitle:   r.originalTitle ?? undefined,
    normalizedTitle: r.normalizedTitle,
    type:            r.type as WorkRecord['type'],
    tmdbId:          r.tmdbId ?? undefined,
    source:          r.source as WorkRecord['source'],
    releaseYear:     r.releaseYear ?? undefined,
    roleName:        r.roleName ?? undefined,
    overview:        r.overview ?? undefined,
    posterUrl:       r.posterUrl ?? undefined,
    confidenceScore: Number(r.confidenceScore ?? 0),
    status:          r.status as WorkRecord['status'],
    deleted:         r.deleted,
    deletedAt:       r.deletedAt  ? r.deletedAt.getTime()  : undefined,
    deletedBy:       r.deletedBy  ?? undefined,
    checkedAt:       r.checkedAt  ? r.checkedAt.getTime()  : undefined,
    createdAt:       r.createdAt.getTime(),
    updatedAt:       r.updatedAt.getTime(),
    aiDecision:             ai.aiDecision             as WorkRecord['aiDecision'],
    aiSamePerson:           ai.aiSamePerson           as boolean | undefined,
    aiReason:               ai.aiReason               as string | undefined,
    aiRelation:             ai.aiRelation             as WorkRecord['aiRelation'],
    aiStatusRecommendation: ai.aiStatusRecommendation as WorkRecord['aiDecision'] | undefined,
    aiNeedsHumanReview:     ai.aiNeedsHumanReview     as boolean | undefined,
    usedAi:                 ai.usedAi                 as boolean | undefined,
    tmdbMatchedPersonId:    ai.tmdbMatchedPersonId    as number | undefined,
    tmdbMatchedPersonName:  ai.tmdbMatchedPersonName  as string | undefined,
    workDisplayType:        ai.workDisplayType        as WorkRecord['workDisplayType'],
    vodProviders:    vod.vodProviders    as WorkRecord['vodProviders'],
    vodUpdatedAt:    vod.vodUpdatedAt    as number | undefined,
    vodAiCheckedAt:  vod.vodAiCheckedAt  as number | undefined,
    vodStatus:       vod.vodStatus       as WorkRecord['vodStatus'],
    nextVodCheckAt:  vod.nextVodCheckAt  as number | undefined,
    lastVodCheckAt:  vod.lastVodCheckAt  as number | undefined,
    vodCheckSource:  vod.vodCheckSource  as WorkRecord['vodCheckSource'],
    vodCheckStatus:  vod.vodCheckStatus  as WorkRecord['vodCheckStatus'],
    vodCheckError:   vod.vodCheckError   as string | undefined,
    priorityRecheck: vod.priorityRecheck as boolean | undefined,
  };
}

// 人物の全作品を取得
export async function getAllWorks(personName: string): Promise<WorkRecord[]> {
  try {
    const rows = await db.select().from(worksTable).where(eq(worksTable.personName, personName));
    return rows.map(dbRowToWorkRecord);
  } catch (err) {
    console.error('[db] getAllWorks failed:', String(err));
    return [];
  }
}

// 公開中（auto_published）の作品のみ取得（人物ページ表示用）
export async function getPublishedWorks(personName: string): Promise<WorkRecord[]> {
  const all = await getAllWorks(personName);
  return all
    .filter((w) => w.status === 'auto_published' && !w.deleted)
    .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
}

// DBエラー時に throw する版（人物ページで error/empty を区別するために使う）
export async function getPublishedWorksOrThrow(personName: string): Promise<WorkRecord[]> {
  const rows = await db.select().from(worksTable)
    .where(and(
      eq(worksTable.personName, personName),
      eq(worksTable.status, 'auto_published'),
      eq(worksTable.deleted, false),
    ));
  return rows.map(dbRowToWorkRecord)
    .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
}

// 作品を保存（新規・更新どちらも）
export async function saveWork(work: WorkRecord): Promise<void> {
  await upsertWork(work);
}

// 作品が存在しない場合のみ保存（統合CSVインポートでの重複防止）
export async function saveWorkIfAbsent(work: WorkRecord): Promise<'created' | 'skipped'> {
  const rows = await db.select({ id: worksTable.id }).from(worksTable)
    .where(and(eq(worksTable.personName, work.personName), eq(worksTable.id, work.id)));
  if (rows.length > 0) return 'skipped';
  await upsertWork(work);
  return 'created';
}

// ステータスのみ更新（管理画面からの手動判定）
export async function updateWorkStatus(
  personName: string,
  workId: string,
  status: WorkStatus,
): Promise<void> {
  const rows = await db.select().from(worksTable)
    .where(and(eq(worksTable.personName, personName), eq(worksTable.id, workId)));
  if (!rows.length) return;
  const work = dbRowToWorkRecord(rows[0]);
  work.status = status;
  work.checkedAt = Date.now();
  work.updatedAt = Date.now();
  await upsertWork(work);
}

// 作品を削除（物理削除）
export async function deleteWork(personName: string, workId: string): Promise<void> {
  await db.delete(worksTable)
    .where(and(eq(worksTable.personName, personName), eq(worksTable.id, workId)));
}

// 作品を論理削除（deleted フラグをセット）
export async function softDeleteWork(personName: string, workId: string): Promise<boolean> {
  const rows = await db.select().from(worksTable)
    .where(and(eq(worksTable.personName, personName), eq(worksTable.id, workId)));
  if (!rows.length) return false;
  const work = dbRowToWorkRecord(rows[0]);
  work.deleted = true;
  work.deletedAt = Date.now();
  work.deletedBy = 'manual';
  work.updatedAt = Date.now();
  await upsertWork(work);
  return true;
}

// 複数作品を論理削除
export async function softDeleteWorks(personName: string, workIds: string[]): Promise<number> {
  let count = 0;
  for (const workId of workIds) {
    const ok = await softDeleteWork(personName, workId);
    if (ok) count++;
  }
  return count;
}

// 特定の作品を1件取得
export async function getWork(personName: string, workId: string): Promise<WorkRecord | null> {
  try {
    const rows = await db.select().from(worksTable)
      .where(and(eq(worksTable.personName, personName), eq(worksTable.id, workId)));
    return rows.length > 0 ? dbRowToWorkRecord(rows[0]) : null;
  } catch (err) {
    console.error('[db] getWork failed:', String(err));
    return null;
  }
}

// DBから1件取得してミューテーション→保存
async function withWorkFromDB(
  personName: string,
  workId: string,
  mutate: (w: WorkRecord) => boolean,
): Promise<boolean> {
  const rows = await db.select().from(worksTable)
    .where(and(eq(worksTable.personName, personName), eq(worksTable.id, workId)));
  if (!rows.length) return false;
  const work = dbRowToWorkRecord(rows[0]);
  if (!mutate(work)) return false;
  await upsertWork(work);
  return true;
}

// 配信サービス情報を更新（手動プロバイダーは保持し、指定ソースのみ置換）
// replaceSources で指定したソースのプロバイダーを新しいリストで置き換える
// 指定外のソース（manualなど）はそのまま残す
export async function updateWorkVod(
  personName: string,
  workId: string,
  providers: VodProvider[],
  options?: {
    replaceSources?: Array<'tmdb_watch_provider' | 'openai_supplement' | 'openai_web_search' | 'manual_csv' | 'ai_recheck'>;
    vodAiCheckedAt?: number;
    vodStatus?: 'found' | 'not_found';
    nextVodCheckAt?: number;
  },
): Promise<void> {
  await withWorkFromDB(personName, workId, (work) => {
    const replaceSources = options?.replaceSources ?? ['tmdb_watch_provider', 'openai_supplement', 'openai_web_search'];
    const kept = (work.vodProviders ?? []).filter((p) => !replaceSources.includes(p.source as never));
    work.vodProviders = [...kept, ...providers];
    work.vodUpdatedAt = Date.now();
    if (options?.vodAiCheckedAt) work.vodAiCheckedAt = options.vodAiCheckedAt;
    if (options?.vodStatus !== undefined) work.vodStatus = options.vodStatus;
    if (options?.nextVodCheckAt !== undefined) work.nextVodCheckAt = options.nextVodCheckAt;
    work.updatedAt = Date.now();
    return true;
  });
}

// CSV調査インポート: manual_csv 配信サービスをアップサート（同名サービスは上書き、新規は追加、TMDb/AI は保持）
export async function upsertManualCsvVodProviders(
  personName: string,
  workId: string,
  providers: VodProvider[],
): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;
  await withWorkFromDB(personName, workId, (work) => {
    const existing = work.vodProviders ?? [];
    for (const p of providers) {
      const idx = existing.findIndex(
        (e) => e.source === 'manual_csv' &&
               e.providerName.toLowerCase() === p.providerName.toLowerCase(),
      );
      if (idx >= 0) { existing[idx] = p; updated++; }
      else { existing.push(p); added++; }
    }
    work.vodProviders = existing;
    work.vodUpdatedAt = Date.now();
    work.updatedAt = Date.now();
    return true;
  });
  return { added, updated };
}

// CSV同期インポート: manual_csv 配信サービスを完全置換（CSVにないものは削除、TMDb/AI/manual は保持）
export async function syncManualCsvVodProviders(
  personName: string,
  workId: string,
  providers: VodProvider[],
): Promise<{ removed: number; added: number }> {
  let removedCount = 0;
  await withWorkFromDB(personName, workId, (work) => {
    const existing = work.vodProviders ?? [];
    removedCount = existing.filter((p) => p.source === 'manual_csv').length;
    const nonCsv = existing.filter((p) => p.source !== 'manual_csv');
    work.vodProviders = [...nonCsv, ...providers];
    work.vodUpdatedAt = Date.now();
    work.updatedAt = Date.now();
    return true;
  });
  return { removed: removedCount, added: providers.length };
}

// VOD配信情報を1件だけ論理削除（hidden: true をセット）
// 同じ providerName+source+type の最初の1件のみ対象
export async function hideVodProvider(
  personName: string,
  workId: string,
  identifier: { providerName: string; source: string; type: string },
): Promise<boolean> {
  let found = false;
  await withWorkFromDB(personName, workId, (work) => {
    const providers = work.vodProviders ?? [];
    const idx = providers.findIndex(
      (p) =>
        !p.hidden &&
        p.providerName === identifier.providerName &&
        p.source === identifier.source &&
        p.type === identifier.type,
    );
    if (idx < 0) return false;
    providers[idx] = { ...providers[idx], hidden: true, updatedAt: Date.now() };
    work.vodProviders = providers;
    work.vodUpdatedAt = Date.now();
    work.updatedAt = Date.now();
    found = true;
    return true;
  });
  return found;
}

// 手動で配信サービスを1件追加（既存の tmdb_watch_provider は保持）
export async function addManualVodProvider(
  personName: string,
  workId: string,
  provider: VodProvider,
): Promise<void> {
  await withWorkFromDB(personName, workId, (work) => {
    const existing = work.vodProviders ?? [];
    // 同じ providerId かつ source:manual は上書き
    const filtered = existing.filter(
      (p) => !(p.providerId === provider.providerId && p.source === 'manual'),
    );
    work.vodProviders = [...filtered, { ...provider, source: 'manual' }];
    work.vodUpdatedAt = Date.now();
    work.updatedAt = Date.now();
    return true;
  });
}

// 手動配信サービスを1件削除
export async function removeManualVodProvider(
  personName: string,
  workId: string,
  providerId: number,
): Promise<void> {
  await withWorkFromDB(personName, workId, (work) => {
    work.vodProviders = (work.vodProviders ?? []).filter(
      (p) => !(p.providerId === providerId && p.source === 'manual'),
    );
    work.vodUpdatedAt = Date.now();
    work.updatedAt = Date.now();
    return true;
  });
}

// 配信情報再確認ステータスを更新（vod-recheck Cron 用）
export async function updateWorkVodCheckStatus(
  personName: string,
  workId: string,
  status: WorkRecord['vodCheckStatus'],
  opts?: {
    source?: WorkRecord['vodCheckSource'];
    error?: string;
    lastVodCheckAt?: number;
  },
): Promise<void> {
  await withWorkFromDB(personName, workId, (work) => {
    work.vodCheckStatus = status;
    if (opts?.source !== undefined) work.vodCheckSource = opts.source;
    if (opts?.error !== undefined) work.vodCheckError = opts.error;
    if (opts?.lastVodCheckAt !== undefined) work.lastVodCheckAt = opts.lastVodCheckAt;
    work.updatedAt = Date.now();
    return true;
  });
}

// 優先再確認フラグを設定（管理画面から）
export async function setPriorityRecheck(
  personName: string,
  workId: string,
  priority: boolean,
): Promise<void> {
  await withWorkFromDB(personName, workId, (work) => {
    work.priorityRecheck = priority;
    if (priority && work.vodCheckStatus !== 'checking') {
      work.vodCheckStatus = 'needs_recheck';
    }
    work.updatedAt = Date.now();
    return true;
  });
}

// source別に一括削除（AI補完作品を再実行する際に使用）
export async function deleteWorksBySource(
  personName: string,
  source: string,
): Promise<number> {
  const deleted = await db.delete(worksTable)
    .where(and(eq(worksTable.personName, personName), eq(worksTable.source, source)))
    .returning({ id: worksTable.id });
  return deleted.length;
}
