// デュアルライト用 DB 書き込み関数
// Redis が正本。DB 書き込みは Redis 成功後に fire-and-forget で実行する。
// 失敗時は console.warn('[dual-write] DB_ERR ...') のみ出力し、本番処理を失敗扱いにしない。

import { db } from './client';
import { products, verdicts, works, personMeta, groupMeta, vodProviders, persons } from './schema';
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
    posterUrl:       work.posterUrl ?? null,
    confidenceScore: String(work.confidenceScore ?? 0),
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
        posterUrl:       row.posterUrl,
        confidenceScore: row.confidenceScore,
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

// CSVインポート用バッチ書き込み: vodData のみを並列更新
// syncMode=true の場合はトランザクションで原子的に実行
export async function batchUpsertWorkVodData(
  workList: WorkRecord[],
  wrapInTransaction: boolean,
): Promise<void> {
  if (workList.length === 0) return;

  if (wrapInTransaction) {
    await db.transaction(async (tx) => {
      await Promise.all(
        workList.map((w) => {
          const { vodData } = buildWorkRow(w);
          return tx
            .update(works)
            .set({ vodData, updatedAt: new Date() })
            .where(and(eq(works.personName, w.personName), eq(works.id, w.id)));
        }),
      );
    });
  } else {
    await Promise.all(
      workList.map((w) => {
        const { vodData } = buildWorkRow(w);
        return db
          .update(works)
          .set({ vodData, updatedAt: new Date() })
          .where(and(eq(works.personName, w.personName), eq(works.id, w.id)));
      }),
    );
  }
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
        updatedAt:      row.updatedAt,
      },
    });
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
