// デュアルライト用 DB 書き込み関数
// Redis が正本。DB 書き込みは Redis 成功後に fire-and-forget で実行する。
// 失敗時は console.warn('[dual-write] DB_ERR ...') のみ出力し、本番処理を失敗扱いにしない。

import { db, neonSql } from './client';
import { products, verdicts, works, personMeta, groupMeta, vodProviders, persons, workStatusHistory, vodRecheckLogs, photobookSettings } from './schema';
import { eq, and } from 'drizzle-orm';
import type { WorkRecord } from '@/types/work';

// ── Fire-and-forget ラッパー ──────────────────────────────────────────────────
// void で起動 → エラーは warn のみ。本番処理の遅延なし。
export function dbWrite(label: string, fn: () => Promise<void>): void {
  fn().catch((err: unknown) =>
    console.warn(`[dual-write] DB_ERR ${label}: ${String(err)}`),
  );
}

// ── 商品（products） ──────────────────────────────────────────────────────────

export async function upsertProduct(
  personName: string,
  category: string,
  items: unknown[],
  fetchedAt: number,
): Promise<void> {
  const fetchedAtDate = new Date(fetchedAt);
  await db
    .insert(products)
    .values({ personName, category, fetchedAt: fetchedAtDate, items })
    .onConflictDoUpdate({
      target: [products.personName, products.category],
      set: { fetchedAt: fetchedAtDate, items },
    });
}

// ── AI/手動判定（verdicts）────────────────────────────────────────────────────

export async function upsertVerdict(
  personName: string,
  productId: string,
  verdict: string,
  score: number,
  source: string,
  reason?: string,
  promptVersion?: string,
  timestamp?: number,
): Promise<void> {
  const now = new Date();
  const judgedAt = timestamp ? new Date(timestamp) : now;
  const row = {
    personName,
    productId,
    verdict,
    score:         String(score ?? 0),
    source,
    reason:        reason ?? null,
    promptVersion: promptVersion ?? null,
    judgedAt,
    updatedAt:     now,
  };
  await db
    .insert(verdicts)
    .values(row)
    .onConflictDoUpdate({
      target: [verdicts.personName, verdicts.productId],
      set: {
        verdict:       row.verdict,
        score:         row.score,
        source:        row.source,
        reason:        row.reason,
        promptVersion: row.promptVersion,
        judgedAt:      row.judgedAt,
        updatedAt:     row.updatedAt,
      },
    });
}

// ── 出演作品（works）──────────────────────────────────────────────────────────

function buildWorkRow(work: WorkRecord): typeof works.$inferInsert {
  const aiData: Record<string, unknown> = {};
  if (work.aiDecision !== undefined)             aiData.aiDecision = work.aiDecision;
  if (work.aiSamePerson !== undefined)           aiData.aiSamePerson = work.aiSamePerson;
  if (work.aiReason !== undefined)               aiData.aiReason = work.aiReason;
  if (work.aiRelation !== undefined)             aiData.aiRelation = work.aiRelation;
  if (work.aiStatusRecommendation !== undefined) aiData.aiStatusRecommendation = work.aiStatusRecommendation;
  if (work.aiNeedsHumanReview !== undefined)     aiData.aiNeedsHumanReview = work.aiNeedsHumanReview;
  if (work.usedAi !== undefined)                 aiData.usedAi = work.usedAi;
  if (work.tmdbMatchedPersonId !== undefined)    aiData.tmdbMatchedPersonId = work.tmdbMatchedPersonId;
  if (work.tmdbMatchedPersonName !== undefined)  aiData.tmdbMatchedPersonName = work.tmdbMatchedPersonName;
  if (work.workDisplayType !== undefined)        aiData.workDisplayType = work.workDisplayType;

  const vodData: Record<string, unknown> = {};
  if (work.vodProviders !== undefined)    vodData.vodProviders = work.vodProviders;
  if (work.vodUpdatedAt !== undefined)    vodData.vodUpdatedAt = work.vodUpdatedAt;
  if (work.vodAiCheckedAt !== undefined)  vodData.vodAiCheckedAt = work.vodAiCheckedAt;
  if (work.vodStatus !== undefined)       vodData.vodStatus = work.vodStatus;
  if (work.nextVodCheckAt !== undefined)  vodData.nextVodCheckAt = work.nextVodCheckAt;
  if (work.lastVodCheckAt !== undefined)  vodData.lastVodCheckAt = work.lastVodCheckAt;
  if (work.vodCheckSource !== undefined)  vodData.vodCheckSource = work.vodCheckSource;
  if (work.vodCheckStatus !== undefined)  vodData.vodCheckStatus = work.vodCheckStatus;
  if (work.vodCheckError !== undefined)   vodData.vodCheckError = work.vodCheckError;
  if (work.priorityRecheck !== undefined) vodData.priorityRecheck = work.priorityRecheck;
  if (work.lastChatgptResearchAt !== undefined) vodData.lastChatgptResearchAt = work.lastChatgptResearchAt;
  if (work.chatgptResultCount !== undefined)    vodData.chatgptResultCount = work.chatgptResultCount;
  if (work.chatgptResearchMode !== undefined)   vodData.chatgptResearchMode = work.chatgptResearchMode;
  if (work.chatgptServiceScope !== undefined)   vodData.chatgptServiceScope = work.chatgptServiceScope;

  return {
    id:              work.id,
    personName:      work.personName,
    title:           work.title,
    originalTitle:   work.originalTitle ?? null,
    normalizedTitle: work.normalizedTitle ?? '',
    type:            work.type,
    tmdbId:          work.tmdbId ?? null,
    source:          work.source,
    releaseYear:     work.releaseYear ?? null,
    roleName:        work.roleName ?? null,
    overview:        work.overview ?? null,
    posterUrl:        work.posterUrl ?? null,
    manualImageUrl:   work.manualImageUrl ?? null,
    ogImageUrl:       work.ogImageUrl ?? null,
    ogSourceUrl:      work.ogSourceUrl ?? null,
    ogImageFetchedAt: work.ogImageFetchedAt ? new Date(work.ogImageFetchedAt) : null,
    ogImageStatus:    work.ogImageStatus ?? null,
    ogImageError:     work.ogImageError ?? null,
    confidenceScore:  String(work.confidenceScore ?? 0),
    status:          work.status ?? 'needs_review',
    deleted:         work.deleted ?? false,
    deletedAt:       work.deletedAt  ? new Date(work.deletedAt)  : null,
    deletedBy:       work.deletedBy  ?? null,
    checkedAt:       work.checkedAt  ? new Date(work.checkedAt)  : null,
    aiData,
    vodData,
    createdAt:       work.createdAt  ? new Date(work.createdAt)  : new Date(),
    updatedAt:       work.updatedAt  ? new Date(work.updatedAt)  : new Date(),
  };
}

export async function upsertWork(work: WorkRecord): Promise<void> {
  const row = buildWorkRow(work);
  await db
    .insert(works)
    .values(row)
    .onConflictDoUpdate({
      target: [works.personName, works.id],
      set: {
        title:           row.title,
        originalTitle:   row.originalTitle,
        normalizedTitle: row.normalizedTitle,
        type:            row.type,
        tmdbId:          row.tmdbId,
        source:          row.source,
        releaseYear:     row.releaseYear,
        roleName:        row.roleName,
        overview:        row.overview,
        posterUrl:        row.posterUrl,
        manualImageUrl:   row.manualImageUrl,
        ogImageUrl:       row.ogImageUrl,
        ogSourceUrl:      row.ogSourceUrl,
        ogImageFetchedAt: row.ogImageFetchedAt,
        ogImageStatus:    row.ogImageStatus,
        ogImageError:     row.ogImageError,
        confidenceScore:  row.confidenceScore,
        status:          row.status,
        deleted:         row.deleted,
        deletedAt:       row.deletedAt,
        deletedBy:       row.deletedBy,
        checkedAt:       row.checkedAt,
        aiData:          row.aiData,
        vodData:         row.vodData,
        updatedAt:       row.updatedAt,
      },
    });
}

// ── ステータス変更履歴（work_status_history）──────────────────────────────────

export interface WorkStatusHistoryEntry {
  personName: string;
  workId: string;
  title: string;
  workSource: string;
  previousStatus: string;
  newStatus: string;
  changedBy: string;
  reason?: string;
  idempotencyKey?: string;
}

export async function insertWorkStatusHistory(entry: WorkStatusHistoryEntry): Promise<void> {
  await db.insert(workStatusHistory).values({
    personName:     entry.personName,
    workId:         entry.workId,
    title:          entry.title,
    workSource:     entry.workSource,
    previousStatus: entry.previousStatus,
    newStatus:      entry.newStatus,
    changedBy:      entry.changedBy,
    reason:         entry.reason ?? null,
    idempotencyKey: entry.idempotencyKey ?? null,
  });
}

export async function hasIdempotencyKey(key: string): Promise<boolean> {
  const rows = await db
    .select({ id: workStatusHistory.id })
    .from(workStatusHistory)
    .where(eq(workStatusHistory.idempotencyKey, key))
    .limit(1);
  return rows.length > 0;
}

// ── VOD再確認 監査ログ（vod_recheck_logs）────────────────────────────────────

export interface VodRecheckLogEntry {
  personName: string;
  workId: string;
  action: 'start' | 'complete' | 'needs_review' | 'skip' | 'note';
  performedBy: string;
  note?: string;
  updatedProviderCount?: number;
  activeCountBefore?: number;
  activeCountAfter?: number;
  unknownCountBefore?: number;
  unknownCountAfter?: number;
  vodCheckStatusAfter?: string;
}

export async function insertVodRecheckLog(entry: VodRecheckLogEntry): Promise<void> {
  await db.insert(vodRecheckLogs).values({
    personName:           entry.personName,
    workId:               entry.workId,
    action:               entry.action,
    performedBy:          entry.performedBy,
    note:                 entry.note ?? null,
    updatedProviderCount: entry.updatedProviderCount ?? null,
    activeCountBefore:    entry.activeCountBefore ?? null,
    activeCountAfter:     entry.activeCountAfter ?? null,
    unknownCountBefore:   entry.unknownCountBefore ?? null,
    unknownCountAfter:    entry.unknownCountAfter ?? null,
    vodCheckStatusAfter:  entry.vodCheckStatusAfter ?? null,
  });
}

// ── 人物メタ（person_meta）────────────────────────────────────────────────────

export interface PersonMetaInput {
  memo?: string;
  priority?: string;
  updatedAt?: number;
  activityStatus?: string;
  generation?: string;
  joinedAt?: string;
  leftAt?: string;
  currentGroupName?: string;
  formerGroupNames?: string[];
  membershipNote?: string;
  primaryGenre?: string;
  genres?: string[];
  titles?: string[];
  publicRoles?: string[];
  awards?: string[];
  careerStatus?: string;
  roleNote?: string;
  /** 'female' | 'male' | undefined(未設定)。写真集機能用。管理画面からの手動設定のみ。 */
  gender?: string;
}

export async function upsertPersonMeta(name: string, meta: PersonMetaInput): Promise<void> {
  const now = new Date(meta.updatedAt ?? Date.now());
  const row = {
    personName:       name,
    activityStatus:   meta.activityStatus ?? null,
    generation:       meta.generation ?? null,
    titles:           meta.titles ?? null,
    currentGroupName: meta.currentGroupName ?? null,
    joinedAt:         meta.joinedAt ?? null,
    leftAt:           meta.leftAt ?? null,
    formerGroupNames: meta.formerGroupNames ?? null,
    membershipNote:   meta.membershipNote ?? null,
    primaryGenre:     meta.primaryGenre ?? null,
    genres:           meta.genres ?? null,
    publicRoles:      meta.publicRoles ?? null,
    awards:           meta.awards ?? null,
    careerStatus:     meta.careerStatus ?? null,
    roleNote:         meta.roleNote ?? null,
    memo:             meta.memo ?? null,
    priority:         meta.priority ?? null,
    gender:           meta.gender ?? null,
    updatedAt:        now,
  };
  await db
    .insert(personMeta)
    .values(row)
    .onConflictDoUpdate({
      target: personMeta.personName,
      set: {
        activityStatus:   row.activityStatus,
        generation:       row.generation,
        titles:           row.titles,
        currentGroupName: row.currentGroupName,
        joinedAt:         row.joinedAt,
        leftAt:           row.leftAt,
        formerGroupNames: row.formerGroupNames,
        membershipNote:   row.membershipNote,
        primaryGenre:     row.primaryGenre,
        genres:           row.genres,
        publicRoles:      row.publicRoles,
        awards:           row.awards,
        careerStatus:     row.careerStatus,
        roleNote:         row.roleNote,
        memo:             row.memo,
        priority:         row.priority,
        gender:           row.gender,
        updatedAt:        now,
      },
    });
}

// ── グループメタ（group_meta）─────────────────────────────────────────────────

export interface GroupMetaInput {
  groupName: string;
  slug?: string;
  activityStatus?: string;
  formedAt?: string;
  endedAt?: string;
  renamedFrom?: string;
  renamedTo?: string;
  formerNames?: string[];
  officialSite?: string;
  note?: string;
  updatedAt?: number;
  /** 'female' | 'male' | undefined(未設定)。写真集機能用。管理画面からの手動設定のみ。 */
  gender?: string;
}

export async function upsertGroupMeta(meta: GroupMetaInput): Promise<void> {
  const now = new Date(meta.updatedAt ?? Date.now());
  const slug = meta.slug ?? encodeURIComponent(meta.groupName);
  const row = {
    groupName:      meta.groupName,
    slug,
    activityStatus: meta.activityStatus ?? 'unknown',
    formedAt:       meta.formedAt ?? null,
    endedAt:        meta.endedAt ?? null,
    renamedFrom:    meta.renamedFrom ?? null,
    renamedTo:      meta.renamedTo ?? null,
    formerNames:    meta.formerNames ?? [],
    officialSite:   meta.officialSite ?? null,
    note:           meta.note ?? null,
    gender:         meta.gender ?? null,
    updatedAt:      now,
  };
  await db
    .insert(groupMeta)
    .values(row)
    .onConflictDoUpdate({
      target: groupMeta.groupName,
      set: {
        slug:           row.slug,
        activityStatus: row.activityStatus,
        formedAt:       row.formedAt,
        endedAt:        row.endedAt,
        renamedFrom:    row.renamedFrom,
        renamedTo:      row.renamedTo,
        formerNames:    row.formerNames,
        officialSite:   row.officialSite,
        note:           row.note,
        gender:         row.gender,
        updatedAt:      row.updatedAt,
      },
    });
}

// ── 写真集 表示設定・例外設定（photobook_settings）──────────────────────────

export interface PhotobookSettingInput {
  personName:          string;
  productId:           string;
  sourceCategory?:     string | null;
  status?:             string;  // 'auto' | 'manual_include' | 'manual_exclude'
  published?:          boolean;
  homeState?:          string;  // 'auto' | 'pinned' | 'hidden'
  homePinnedPosition?: number | null;
  sortOrder?:          number | null;
  dedupGroupOverride?: string | null;
  forceRepresentative?: boolean;
  note?:               string | null;
  updatedBy?:          string;
}

// 部分更新: 指定したフィールドのみ変更し、それ以外は既存値を保持する
// （PersonMeta/GroupMetaと異なり、こちらは呼び出し側が必ず現在値を取得済みの前提を置かず、
//   SQL側でCOALESCEして未指定フィールドを保護する）。
export async function upsertPhotobookSetting(input: PhotobookSettingInput): Promise<void> {
  const now = new Date();
  const defaults = {
    personName:          input.personName,
    productId:           input.productId,
    sourceCategory:      input.sourceCategory ?? null,
    status:              input.status ?? 'auto',
    published:           input.published ?? true,
    homeState:           input.homeState ?? 'auto',
    homePinnedPosition:  input.homePinnedPosition ?? null,
    sortOrder:           input.sortOrder ?? null,
    dedupGroupOverride:  input.dedupGroupOverride ?? null,
    forceRepresentative: input.forceRepresentative ?? false,
    note:                input.note ?? null,
    updatedBy:           input.updatedBy ?? null,
    updatedAt:           now,
  };
  const setClause: Record<string, unknown> = { updatedAt: now };
  if (input.sourceCategory !== undefined) setClause.sourceCategory = input.sourceCategory;
  if (input.status !== undefined) setClause.status = input.status;
  if (input.published !== undefined) setClause.published = input.published;
  if (input.homeState !== undefined) setClause.homeState = input.homeState;
  if (input.homePinnedPosition !== undefined) setClause.homePinnedPosition = input.homePinnedPosition;
  if (input.sortOrder !== undefined) setClause.sortOrder = input.sortOrder;
  if (input.dedupGroupOverride !== undefined) setClause.dedupGroupOverride = input.dedupGroupOverride;
  if (input.forceRepresentative !== undefined) setClause.forceRepresentative = input.forceRepresentative;
  if (input.note !== undefined) setClause.note = input.note;
  if (input.updatedBy !== undefined) setClause.updatedBy = input.updatedBy;

  await db
    .insert(photobookSettings)
    .values(defaults)
    .onConflictDoUpdate({
      target: [photobookSettings.personName, photobookSettings.productId],
      set: setClause,
    });
}

// 手動除外を解除して自動判定(auto)に戻す（設定行ごと削除。存在しなければ何もしない）
export async function resetPhotobookSetting(personName: string, productId: string): Promise<void> {
  await db.delete(photobookSettings).where(
    and(eq(photobookSettings.personName, personName), eq(photobookSettings.productId, productId)),
  );
}

// ── VODプロバイダー（vod_providers）──────────────────────────────────────────

export interface VodProviderInput {
  slug: string;
  name: string;
  logoUrl: string;
  isActive: boolean;
  updatedAt?: number;
}

export async function upsertVodProvider(record: VodProviderInput): Promise<void> {
  const now = new Date(record.updatedAt ?? Date.now());
  await db
    .insert(vodProviders)
    .values({
      slug:      record.slug,
      name:      record.name,
      logoUrl:   record.logoUrl ?? '',
      isActive:  record.isActive ?? true,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: vodProviders.slug,
      set: {
        name:      record.name,
        logoUrl:   record.logoUrl ?? '',
        isActive:  record.isActive ?? true,
        updatedAt: now,
      },
    });
}

// ── インポート人物（persons）──────────────────────────────────────────────────

export interface ImportedPersonInput {
  name: string;
  group: string;
  genre: string;
  aliases: string[];
  tmdbPersonId?: number;
  description?: string;
  importedAt: number;
  dataFetchStatus: string;
}

export async function upsertPersonFromImport(person: ImportedPersonInput): Promise<void> {
  const config: Record<string, unknown> = {};
  if (person.aliases.length > 0) config.aliases = person.aliases;
  if (person.tmdbPersonId) config.tmdbPersonId = person.tmdbPersonId;

  const row = {
    name:            person.name,
    groupName:       person.group ?? '',
    genre:           person.genre ?? '坂道',
    aliases:         person.aliases ?? [],
    tmdbPersonId:    person.tmdbPersonId ?? null,
    description:     person.description ?? null,
    source:          'imported' as const,
    dataFetchStatus: person.dataFetchStatus ?? 'not_started',
    importedAt:      new Date(person.importedAt),
    config,
  };
  await db
    .insert(persons)
    .values(row)
    .onConflictDoUpdate({
      target: persons.name,
      set: {
        groupName:       row.groupName,
        genre:           row.genre,
        aliases:         row.aliases,
        tmdbPersonId:    row.tmdbPersonId,
        description:     row.description,
        dataFetchStatus: row.dataFetchStatus,
        importedAt:      row.importedAt,
        updatedAt:       new Date(),
      },
    });
}

export async function updatePersonFetchStatusInDB(
  name: string,
  dataFetchStatus: string,
  errorMessage?: string,
  lastDataFetchedAt?: Date,
): Promise<void> {
  if (lastDataFetchedAt) {
    await db.update(persons)
      .set({ dataFetchStatus, dataFetchError: errorMessage ?? null, lastDataFetchedAt, updatedAt: new Date() })
      .where(eq(persons.name, name));
  } else {
    await db.update(persons)
      .set({ dataFetchStatus, dataFetchError: errorMessage ?? null, updatedAt: new Date() })
      .where(eq(persons.name, name));
  }
}

export async function publishPersonInDB(name: string, publishedAt: number): Promise<void> {
  await db.update(persons)
    .set({ publishedAt: new Date(publishedAt), updatedAt: new Date() })
    .where(eq(persons.name, name));
}

export async function unpublishPersonInDB(name: string): Promise<void> {
  await db.update(persons)
    .set({ publishedAt: null, updatedAt: new Date() })
    .where(eq(persons.name, name));
}

// ── DB専用書き込みモード用 物理削除関数 ─────────────────────────────────────

export async function deleteVerdictInDB(personName: string, productId: string): Promise<void> {
  await db.delete(verdicts)
    .where(and(eq(verdicts.personName, personName), eq(verdicts.productId, productId)));
}

export async function deleteGroupMetaInDB(groupName: string): Promise<void> {
  await db.delete(groupMeta).where(eq(groupMeta.groupName, groupName));
}

export async function deleteVodProviderInDB(slug: string): Promise<void> {
  await db.delete(vodProviders).where(eq(vodProviders.slug, slug));
}

export async function deleteImportedPersonInDB(name: string): Promise<void> {
  await db.delete(persons).where(eq(persons.name, name));
}

// VOD配信データを一括 UPDATE（CSVインポート用）
// 両モードとも CTE json_array_elements を使い1チャンク=1 SQL文。
//
// ※ drizzle-orm/neon-http は db.transaction() を非対応（実行時例外）。
//    wrapInTransaction=true (同期モード): neonSql.transaction() で HTTP バッチ API を使用。
//      複数クエリを1リクエストでアトミックに実行（BEGIN/COMMIT はバッチ API が自動付与）。
//    wrapInTransaction=false (追加/更新モード): 各チャンクを直列実行。
export async function batchUpdateVodData(
  workList: Array<{ personName: string; id: string; vodData: Record<string, unknown> }>,
  wrapInTransaction: boolean,
): Promise<void> {
  if (workList.length === 0) return;
  const CHUNK = 500;

  // neonSql tagged template → NeonQueryPromise（await するか .transaction() に渡す）
  const buildCTE = (chunk: typeof workList) => {
    const batchJson = JSON.stringify(
      chunk.map((w) => ({ person_name: w.personName, id: w.id, vod_data: w.vodData })),
    );
    return neonSql`
      WITH _u AS (
        SELECT
          elem->>'person_name' AS pn,
          elem->>'id'          AS id,
          elem->'vod_data'     AS vd
        FROM jsonb_array_elements(${batchJson}::jsonb) AS elem
      )
      UPDATE works
      SET vod_data = _u.vd, updated_at = NOW()
      FROM _u
      WHERE works.person_name = _u.pn AND works.id = _u.id
    `;
  };

  if (wrapInTransaction) {
    // neonSql.transaction() は Neon HTTP バッチ API を使い全チャンクをアトミックに実行する。
    // 途中で1件でも失敗した場合は全ロールバック。
    const chunks: ReturnType<typeof buildCTE>[] = [];
    for (let i = 0; i < workList.length; i += CHUNK) {
      chunks.push(buildCTE(workList.slice(i, i + CHUNK)));
    }
    await neonSql.transaction(chunks);
  } else {
    for (let i = 0; i < workList.length; i += CHUNK) {
      await buildCTE(workList.slice(i, i + CHUNK));
    }
  }
}
