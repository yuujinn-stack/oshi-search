// 出演作品データの永続ストレージ（Neon DB）

import { cache } from 'react';
import { db } from '@/db/client';
import { works as worksTable, workAliases } from '@/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { upsertWork } from '@/db/write';
import { normalizeProviderName, deduplicateProviders } from '@/lib/vod-dedup';
import {
  computeChatgptFullSync, CHATGPT_SERVICE_SCOPE, isChatgptProtectionActive, stripChatgptScopeServices,
  type ChatgptSyncServiceInput, type ChatgptSyncDiff,
} from '@/lib/vod-chatgpt-sync';
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
    posterUrl:        r.posterUrl ?? undefined,
    manualImageUrl:   r.manualImageUrl ?? undefined,
    ogImageUrl:       r.ogImageUrl ?? undefined,
    ogSourceUrl:      r.ogSourceUrl ?? undefined,
    ogImageFetchedAt: r.ogImageFetchedAt ? r.ogImageFetchedAt.getTime() : undefined,
    ogImageStatus:    (r.ogImageStatus ?? undefined) as WorkRecord['ogImageStatus'],
    ogImageError:     r.ogImageError ?? undefined,
    confidenceScore:  Number(r.confidenceScore ?? 0),
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
    lastChatgptResearchAt: vod.lastChatgptResearchAt as number | undefined,
    chatgptResultCount:    vod.chatgptResultCount    as number | undefined,
    chatgptResearchMode:   vod.chatgptResearchMode    as WorkRecord['chatgptResearchMode'],
    chatgptServiceScope:   vod.chatgptServiceScope    as string | undefined,
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

// 内部リンク生成用: work_aliases の 統合元workId → 統合先(canonical)workId マップ。
// react の cache() でリクエスト内の重複DB呼び出しを防ぐ（1リクエスト内で複数の
// getPublishedWorks* 呼び出しがあっても実クエリは1回のみ。乃木坂46のような
// 大人数グループページでメンバーごとにgetPublishedWorksを並列呼び出しても、
// このマップ取得自体はcache()により1回にまとまるためN+1にはならない）。
// 409件程度の主キー列のみの読み取りで、DB書き込みは行わない。
export const getWorkAliasCanonicalMap = cache(async (): Promise<Map<string, string>> => {
  try {
    const rows = await db.select({
      aliasWorkId: workAliases.aliasWorkId,
      canonicalWorkId: workAliases.canonicalWorkId,
    }).from(workAliases);
    return new Map(rows.map((r) => [r.aliasWorkId, r.canonicalWorkId]));
  } catch (err) {
    console.error('[db] getWorkAliasCanonicalMap failed:', String(err));
    return new Map();
  }
});

// WorkRecord[] に canonicalWorkId を付与する（該当するものだけ）。idそのものは変更しない。
function withCanonicalWorkId(records: WorkRecord[], aliasMap: Map<string, string>): WorkRecord[] {
  if (aliasMap.size === 0) return records;
  return records.map((r) => {
    const canonicalWorkId = aliasMap.get(r.id);
    return canonicalWorkId ? { ...r, canonicalWorkId } : r;
  });
}

// 公開中（auto_published）の作品のみ取得（人物ページ表示用）
// status/deleted を SQL 側でフィルタし、不要な行・列の転送を避ける
export async function getPublishedWorks(personName: string): Promise<WorkRecord[]> {
  try {
    const [rows, aliasMap] = await Promise.all([
      db.select().from(worksTable).where(and(
        eq(worksTable.personName, personName),
        eq(worksTable.status, 'auto_published'),
        eq(worksTable.deleted, false),
      )),
      getWorkAliasCanonicalMap(),
    ]);
    const records = rows.map(dbRowToWorkRecord)
      .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
    return withCanonicalWorkId(records, aliasMap);
  } catch (err) {
    console.error('[db] getPublishedWorks failed:', String(err));
    return [];
  }
}

// DBエラー時に throw する版（人物ページで error/empty を区別するために使う）
// react の cache() でリクエスト内の重複DB呼び出しを防ぐ（generateMetadata + ページ本体で
// 同じ人物のデータを取得しても実際のクエリは1回のみ。cross-request キャッシュではないため
// 更新は次のリクエストから即座に反映される）。
export const getPublishedWorksOrThrow = cache(async (personName: string): Promise<WorkRecord[]> => {
  const [rows, aliasMap] = await Promise.all([
    db.select().from(worksTable)
      .where(and(
        eq(worksTable.personName, personName),
        eq(worksTable.status, 'auto_published'),
        eq(worksTable.deleted, false),
      )),
    getWorkAliasCanonicalMap(),
  ]);
  const records = rows.map(dbRowToWorkRecord)
    .sort((a, b) => (b.releaseYear ?? 0) - (a.releaseYear ?? 0));
  return withCanonicalWorkId(records, aliasMap);
});

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

// 手動画像URLを設定/解除する（管理画面の「手動画像」機能）。
// url に null を渡すと解除（TMDb/OG自動取得画像へ戻す）。それ以外の呼び出し元フィールドは
// 一切変更しない（読み取り→対象フィールドのみ書き換え→保存、のため意図しない消失は起きない）。
export async function setManualImageUrl(
  personName: string,
  workId: string,
  url: string | null,
): Promise<boolean> {
  const rows = await db.select().from(worksTable)
    .where(and(eq(worksTable.personName, personName), eq(worksTable.id, workId)));
  if (!rows.length) return false;
  const work = dbRowToWorkRecord(rows[0]);
  work.manualImageUrl = url ?? undefined;
  work.updatedAt = Date.now();
  await upsertWork(work);
  return true;
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
    // ChatGPT完全同期の保護期間中（vod-chatgpt-sync.ts参照）は、TMDb/AI由来の新規追加・
    // 上書きが対象14サービスへ及ばないようにする。ChatGPT側のエントリはsource='manual_csv'
    // のためreplaceSourcesの対象外＝keptに残ったままなので、ここではincoming側（providers）を
    // 対象14サービスに限りフィルタするだけでよい（14サービス外は従来どおり素通しする）。
    const incoming = isChatgptProtectionActive(work) ? stripChatgptScopeServices(providers) : providers;
    work.vodProviders = [...kept, ...incoming];
    work.vodUpdatedAt = Date.now();
    if (options?.vodAiCheckedAt) work.vodAiCheckedAt = options.vodAiCheckedAt;
    if (options?.vodStatus !== undefined) work.vodStatus = options.vodStatus;
    if (options?.nextVodCheckAt !== undefined) work.nextVodCheckAt = options.nextVodCheckAt;
    work.updatedAt = Date.now();
    return true;
  });
}

// CSV調査インポートのマージロジック（純粋関数）: 同名サービス（manual_csv同士）は上書き、
// 新規は追加、TMDb/AI由来など他ソースのエントリはそのまま保持する。
// DBアクセスを伴わないため、実際に保存する upsertManualCsvVodProviders() と
// 保存前のプレビュー（/api/admin/vod-recheck/csv-import）の両方から同じロジックを使い、
// 「プレビューで見せた反映後の件数」と「実際に反映される件数」がずれないようにする。
export function mergeManualCsvVodProviders(
  existing: VodProvider[],
  providers: VodProvider[],
): { merged: VodProvider[]; added: number; updated: number } {
  const merged = [...existing];
  let added = 0;
  let updated = 0;
  for (const p of providers) {
    const idx = merged.findIndex(
      (e) => e.source === 'manual_csv' &&
             normalizeProviderName(e.providerName) === normalizeProviderName(p.providerName),
    );
    if (idx >= 0) { merged[idx] = p; updated++; }
    else { merged.push(p); added++; }
  }
  return { merged, added, updated };
}

// CSV調査インポート: manual_csv 配信サービスをアップサート（同名サービスは上書き、新規は追加、TMDb/AI は保持）
export async function upsertManualCsvVodProviders(
  personName: string,
  workId: string,
  providers: VodProvider[],
): Promise<{ added: number; updated: number }> {
  let result = { added: 0, updated: 0 };
  await withWorkFromDB(personName, workId, (work) => {
    const { merged, added, updated } = mergeManualCsvVodProviders(work.vodProviders ?? [], providers);
    work.vodProviders = merged;
    result = { added, updated };
    work.vodUpdatedAt = Date.now();
    work.updatedAt = Date.now();
    return true;
  });
  return result;
}

// CSV同期インポートの完全置換ロジック（純粋関数）: 既存のmanual_csvエントリを全て
// 除去し、新しいproviders配列で置き換える。TMDb/AI等の他ソースのエントリは保持する。
// 自動調査（VOD自動調査ジョブ）は「今回の調査結果が当該作品の配信状況を包括的に代表する」
// という前提のため、追加のみ（upsert）ではなく完全置換（sync）を使う。これにより、
// 終了済みサービスの古いmanual_csv情報が残り続けたり、同じサービスの新旧情報が
// 二重に残ったりすることを防ぐ。
export function syncManualCsvVodProvidersPure(
  existing: VodProvider[],
  providers: VodProvider[],
): { merged: VodProvider[]; removed: number; added: number } {
  const removed = existing.filter((p) => p.source === 'manual_csv').length;
  const nonCsv = existing.filter((p) => p.source !== 'manual_csv');
  return { merged: [...nonCsv, ...providers], removed, added: providers.length };
}

// CSV同期インポート: manual_csv 配信サービスを完全置換（CSVにないものは削除、TMDb/AI/manual は保持）
export async function syncManualCsvVodProviders(
  personName: string,
  workId: string,
  providers: VodProvider[],
): Promise<{ removed: number; added: number }> {
  let result = { removed: 0, added: 0 };
  await withWorkFromDB(personName, workId, (work) => {
    const { merged, removed, added } = syncManualCsvVodProvidersPure(work.vodProviders ?? [], providers);
    work.vodProviders = merged;
    result = { removed, added };
    work.vodUpdatedAt = Date.now();
    work.updatedAt = Date.now();
    return true;
  });
  return result;
}

// ChatGPT完全調査 → 14サービス完全同期を1作品分反映する。
// 対象14サービス（vod-chatgpt-sync.ts の CHATGPT_SCOPE_SLUGS）に該当するエントリのみを
// 完全置換し、それ以外（手動登録の特殊provider等）は一切変更しない。
// 呼び出し成功時のみ ChatGPT調査履歴（lastChatgptResearchAt等）を更新し、
// 管理者が設定していた優先再確認フラグ（priorityRecheck）を解除する。
export async function chatgptFullSyncVodProviders(
  personName: string,
  workId: string,
  newServices: ChatgptSyncServiceInput[],
): Promise<{ diff: ChatgptSyncDiff; resultCount: number } | null> {
  let output: { diff: ChatgptSyncDiff; resultCount: number } | null = null;
  const now = Date.now();
  const ok = await withWorkFromDB(personName, workId, (work) => {
    const { merged, diff, resultCount } = computeChatgptFullSync(work.vodProviders ?? [], newServices, now);
    work.vodProviders = merged;
    work.vodUpdatedAt = now;
    work.lastChatgptResearchAt = now;
    work.chatgptResultCount = resultCount;
    work.chatgptResearchMode = 'full_sync';
    work.chatgptServiceScope = CHATGPT_SERVICE_SCOPE;
    work.priorityRecheck = false;
    // 既存のlastVodCheckAt（/admin/vod-recheckの180日ルール・cron/vod-recheckの対象判定が
    // 参照する「最終確認日時」）も更新する。ChatGPT完全調査は14サービスを網羅的に確認した
    // 再確認そのものであるため、これを反映しないと同期直後でも「180日以上未確認」等の理由で
    // 既存のAI再確認Cron・管理画面が即座に再対象化し、ChatGPT調査結果と異なる判定を
    // 上書き・追加してしまう可能性がある（詳細は実装報告の「自動処理との競合」参照）。
    work.lastVodCheckAt = now;
    work.updatedAt = now;
    output = { diff, resultCount };
    return true;
  });
  return ok ? output : null;
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

// CSVインポート用: 指定された (personName, workId) ペアのみ vodData 含む最小列で取得
export async function getWorksForImport(
  pairs: Array<{ personName: string; workId: string }>,
): Promise<Map<string, { id: string; personName: string; title: string; vodData: Record<string, unknown> }>> {
  if (pairs.length === 0) return new Map();
  const personNames = [...new Set(pairs.map((p) => p.personName))];
  const workIds = [...new Set(pairs.map((p) => p.workId))];
  const pairSet = new Set(pairs.map((p) => `${p.personName}:${p.workId}`));
  const rows = await db.select({
    id: worksTable.id,
    personName: worksTable.personName,
    title: worksTable.title,
    vodData: worksTable.vodData,
  }).from(worksTable)
    .where(and(inArray(worksTable.personName, personNames), inArray(worksTable.id, workIds)));
  const map = new Map<string, { id: string; personName: string; title: string; vodData: Record<string, unknown> }>();
  for (const r of rows) {
    const key = `${r.personName}:${r.id}`;
    if (pairSet.has(key)) {
      map.set(key, {
        id: r.id,
        personName: r.personName,
        title: r.title ?? '',
        vodData: (r.vodData ?? {}) as Record<string, unknown>,
      });
    }
  }
  return map;
}

// ─── 代表行選択（作品metadata品質基準） ──────────────────────────────────────
// 同一workIdに複数人物（複数行）が紐づく場合、title/overview/tmdbId/posterUrl/
// releaseYear等の「作品そのものの情報」は本来共通のはずだが、行ごとに独立して
// 保存されているため、CSVインポート由来の行（overview/tmdbIdなし）とTMDb由来の
// 行（overview/tmdbIdあり）が混在することがある。以前は「VOD最終確認日時が
// 新しい順」で代表行を選んでいたが、VOD確認頻度と作品metadataの充実度は無関係な
// ため、TMDb由来の充実した行より情報の薄いCSV由来の行がたまたま代表に選ばれて
// しまうケースが確認された（公開済み複数行作品3,113件中147件で実際に発生）。
// ここでは人物固有情報（personName/roleName等）・VOD情報（vodUpdatedAt/
// vodProviders等）を一切含めない「作品metadataの充実度」のみのスコアで代表行を
// 選ぶ。VOD provider自体は下記の通り全行から別途合算するため、この選択が
// VOD情報に影響することはない。
export function computeWorkMetadataQualityScore(record: WorkRecord): number {
  let score = 0;
  if (record.tmdbId != null) score += 2;
  if (record.overview && record.overview.trim().length > 0) score += 2;
  if (record.posterUrl || record.ogImageUrl || record.manualImageUrl) score += 1;
  if (record.releaseYear != null) score += 1;
  return score;
}

// 同一workIdの複数行（WorkRecord化済み）から代表行を1件選ぶ。
// 品質スコア降順 → 同点の場合のみvodUpdatedAt降順（品質判定の主基準にはしない、
// 既存動作をできるだけ変えないための最終手段） → それでも同点ならpersonName昇順、
// という完全に決定的な順序で常に同じ行を返す。
export function selectRepresentativeWorkRecord(records: WorkRecord[]): WorkRecord {
  return [...records].sort((a, b) => {
    const scoreDiff = computeWorkMetadataQualityScore(b) - computeWorkMetadataQualityScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    const vodDiff = (b.vodUpdatedAt ?? -1) - (a.vodUpdatedAt ?? -1);
    if (vodDiff !== 0) return vodDiff;
    return a.personName.localeCompare(b.personName);
  })[0];
}

// workIdのみで公開作品を1件取得（新正規作品ページ用。personNameなし）
// 同一workIdに複数人物がある場合は selectRepresentativeWorkRecord() で代表行を選ぶ。
export async function getPublicWorkById(workId: string): Promise<WorkRecord | null> {
  try {
    const rows = await db.select().from(worksTable)
      .where(and(
        eq(worksTable.id, workId),
        eq(worksTable.status, 'auto_published'),
        eq(worksTable.deleted, false),
      ));
    if (rows.length === 0) return null;

    const records = rows.map(dbRowToWorkRecord);
    const base = selectRepresentativeWorkRecord(records);
    if (records.length === 1) return base;

    // VOD providerは代表行選択とは独立に、全行から合算する（人物ごとに個別に
    // 確認・更新されるため、選ばれなかった行にしかない確認済みproviderが
    // 作品詳細から消えないようにする。tmdb-tv-228620「アクトレス」で確認済みの挙動）。
    const mergedProviders = deduplicateProviders(
      records.flatMap((r) => r.vodProviders ?? []),
    );
    return { ...base, vodProviders: mergedProviders };
  } catch (err) {
    console.error('[db] getPublicWorkById failed:', String(err));
    return null;
  }
}

// 同一workIdに紐づく全公開人物を取得（N+1なし・単一クエリ）
export async function getAllPersonsForWork(
  workId: string,
): Promise<Array<{ personName: string; roleName: string | null }>> {
  try {
    const rows = await db.select({
      personName: worksTable.personName,
      roleName: worksTable.roleName,
    }).from(worksTable)
      .where(and(
        eq(worksTable.id, workId),
        eq(worksTable.status, 'auto_published'),
        eq(worksTable.deleted, false),
      ));
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (seen.has(r.personName)) return false;
      seen.add(r.personName);
      return true;
    }).map((r) => ({ personName: r.personName, roleName: r.roleName ?? null }));
  } catch (err) {
    console.error('[db] getAllPersonsForWork failed:', String(err));
    return [];
  }
}

// 全公開作品の workId → personName マップを一括取得（N+1防止・ランキング検証用）
// auto_published かつ deleted=false の作品のみ返す。
export async function getAllPublishedWorkPersonMap(): Promise<Map<string, string>> {
  try {
    const rows = await db.select({
      id: worksTable.id,
      personName: worksTable.personName,
    }).from(worksTable).where(and(
      eq(worksTable.status, 'auto_published'),
      eq(worksTable.deleted, false),
    ));
    const map = new Map<string, string>();
    for (const r of rows) {
      if (!map.has(r.id)) map.set(r.id, r.personName);
    }
    return map;
  } catch (err) {
    console.error('[db] getAllPublishedWorkPersonMap failed:', String(err));
    return new Map();
  }
}

// sitemap.ts 専用: work_aliases に統合元として登録済みのworkId一覧（Set）。
// 統合元workIdの行がstatus変更・削除される前でも、sitemapには統合先（canonical）の
// URLだけを載せるためのフィルタ用。DBの書き込みは行わず、既存のstatus/redirect
// ロジックにも一切影響しない（読み取り専用・sitemap生成時のみ使用）。
export async function getAllWorkAliasSourceIds(): Promise<Set<string>> {
  try {
    const rows = await db.select({ aliasWorkId: workAliases.aliasWorkId }).from(workAliases);
    return new Set(rows.map((r) => r.aliasWorkId));
  } catch (err) {
    console.error('[db] getAllWorkAliasSourceIds failed:', String(err));
    return new Set();
  }
}

// sitemap.ts の lastModified 用: 全公開作品の workId → 最終更新日時（ms）マップ。
// 同一idが複数人物行を持つ場合は最も新しいupdatedAtを採用する。
export async function getAllPublishedWorkLastModified(): Promise<Map<string, number>> {
  try {
    const rows = await db.select({
      id: worksTable.id,
      updatedAt: worksTable.updatedAt,
    }).from(worksTable).where(and(
      eq(worksTable.status, 'auto_published'),
      eq(worksTable.deleted, false),
    ));
    const map = new Map<string, number>();
    for (const r of rows) {
      const ts = r.updatedAt.getTime();
      const existing = map.get(r.id);
      if (existing === undefined || ts > existing) map.set(r.id, ts);
    }
    return map;
  } catch (err) {
    console.error('[db] getAllPublishedWorkLastModified failed:', String(err));
    return new Map();
  }
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
