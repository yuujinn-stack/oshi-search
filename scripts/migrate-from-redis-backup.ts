/**
 * Redis バックアップJSON → Neon Postgres 移行スクリプト
 *
 * 実行方法:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-from-redis-backup.ts <backup.json>
 *
 * または package.json の npm script を使う:
 *   npm run db:migrate -- ./redis-backup-YYYYMMDD.json
 *
 * 注意:
 * - 既存 Redis の読み書き処理は変更しない（フェーズ0）
 * - 同じスクリプトを複数回実行しても安全（onConflictDoNothing で重複スキップ）
 * - persons:published に存在するが persons に登録がない人物は警告ログのみ
 */

import path from 'node:path';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import {
  persons,
  personMeta,
  groupMeta,
  vodProviders,
  works,
  products,
  verdicts,
} from '../src/db/schema';

// ── バックアップJSON の型定義 ──────────────────────────────────────────────

interface HashEntry {
  key: string;
  type: 'hash';
  count: number;
  data: Record<string, unknown>;
}

interface HashCollectionEntry {
  key: string;
  type: 'hash-collection';
  keyCount: number;
  count: number;
  data: Record<string, Record<string, unknown>>;
}

interface BackupJson {
  exportedAt: string;
  totalRecords: number;
  entries: Array<HashEntry | HashCollectionEntry>;
}

// ── Redis から復元するデータ型（インライン定義でimport依存なし）──────────

interface ImportedPersonRecord {
  name: string;
  group: string;
  genre: string;
  aliases?: string[];
  tmdbPersonId?: number;
  description?: string;
  importedAt?: number;
  dataFetchStatus?: string;
  lastDataFetchedAt?: number;
  dataFetchErrorMessage?: string;
}

interface PublishedPersonRecord {
  name: string;
  group: string;
  genre: string;
  config?: Record<string, unknown>;
  publishedAt?: number;
}

interface PersonMetaRecord {
  activityStatus?: string;
  generation?: string;
  titles?: string[];
  currentGroupName?: string;
  joinedAt?: string;
  leftAt?: string;
  formerGroupNames?: string[];
  membershipNote?: string;
  primaryGenre?: string;
  genres?: string[];
  publicRoles?: string[];
  awards?: string[];
  careerStatus?: string;
  roleNote?: string;
  memo?: string;
  priority?: string;
  updatedAt?: number;
}

interface GroupMetaRecord {
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
  createdAt?: number;
  updatedAt?: number;
}

interface ProviderRecord {
  slug: string;
  name: string;
  logoUrl?: string;
  isActive?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

interface StoredCategoryData {
  products: unknown[];
  fetchedAt: number;
}

interface WorkRecord {
  id: string;
  personName: string;
  title: string;
  originalTitle?: string;
  normalizedTitle?: string;
  type: string;
  tmdbId?: number;
  source: string;
  releaseYear?: number;
  roleName?: string;
  overview?: string;
  posterUrl?: string;
  confidenceScore?: number;
  status: string;
  deleted?: boolean;
  deletedAt?: number;
  deletedBy?: string;
  checkedAt?: number;
  aiDecision?: string;
  aiSamePerson?: boolean;
  aiReason?: string;
  aiRelation?: string;
  aiStatusRecommendation?: string;
  aiNeedsHumanReview?: boolean;
  usedAi?: boolean;
  tmdbMatchedPersonId?: number;
  tmdbMatchedPersonName?: string;
  vodProviders?: unknown[];
  vodUpdatedAt?: number;
  vodAiCheckedAt?: number;
  vodStatus?: string;
  nextVodCheckAt?: number;
  lastVodCheckAt?: number;
  vodCheckSource?: string;
  vodCheckStatus?: string;
  vodCheckError?: string;
  priorityRecheck?: boolean;
  createdAt: number;
  updatedAt: number;
}

interface JudgmentRecord {
  verdict: string;
  score: number;
  source: string;
  reason?: string;
  timestamp: number;
  promptVersion?: string;
}

// ── ヘルパー ──────────────────────────────────────────────────────────────

/** Upstash hgetall の値は自動デシリアライズ済みのこともある。両方に対応する。 */
function parse<T>(v: unknown): T {
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }
  return v as T;
}

/** Unix ミリ秒 → Date（nullなら null） */
function msToDate(ms: number | null | undefined): Date | null {
  if (!ms) return null;
  return new Date(ms);
}

function findHash(entries: BackupJson['entries'], key: string): HashEntry | null {
  const e = entries.find((x) => x.key === key && x.type === 'hash');
  return e ? (e as HashEntry) : null;
}

function findHashCollection(
  entries: BackupJson['entries'],
  keyPattern: string,
): HashCollectionEntry | null {
  const e = entries.find((x) => x.key === keyPattern && x.type === 'hash-collection');
  return e ? (e as HashCollectionEntry) : null;
}

/** 分割して挿入（Neon の statement サイズ制限対策） */
async function batchInsert<T extends Record<string, unknown>>(
  table: Parameters<typeof db.insert>[0],
  rows: T[],
  batchSize = 200,
): Promise<number> {
  if (rows.length === 0) return 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.insert(table).values(rows.slice(i, i + batchSize) as any).onConflictDoNothing());
  }
  return rows.length;
}

// ── カウンタ ──────────────────────────────────────────────────────────────

const counts = {
  staticPersons:   0,
  importedPersons: 0,
  publishedPersons: 0,
  personMetaRows:  0,
  groupMetaRows:   0,
  vodProviderRows: 0,
  workRows:        0,
  productRows:     0,
  verdictRows:     0,
};

// ── メイン ────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL が設定されていません。');
    console.error('   npx dotenv -e .env.local -- npx tsx scripts/migrate-from-redis-backup.ts <backup.json>');
    process.exit(1);
  }

  const backupPath = process.argv[2];
  if (!backupPath) {
    console.error('使い方: npx tsx scripts/migrate-from-redis-backup.ts <backup.json>');
    process.exit(1);
  }

  const resolvedBackup = path.resolve(backupPath);
  if (!fs.existsSync(resolvedBackup)) {
    console.error(`❌ ファイルが見つかりません: ${resolvedBackup}`);
    process.exit(1);
  }

  console.log(`\n📂 バックアップJSON: ${resolvedBackup}`);
  const backup: BackupJson = JSON.parse(fs.readFileSync(resolvedBackup, 'utf-8'));
  console.log(`   exportedAt: ${backup.exportedAt}`);
  console.log(`   totalRecords: ${backup.totalRecords}`);

  // ── 静的データ読み込み ───────────────────────────────────────────────────
  const masterPath = path.resolve('data/persons_master.json');
  const configPath = path.resolve('data/persons_config.json');

  if (!fs.existsSync(masterPath)) {
    console.error(`❌ data/persons_master.json が見つかりません`);
    process.exit(1);
  }

  const masterPersons = JSON.parse(fs.readFileSync(masterPath, 'utf-8')) as Array<{
    name: string; group: string; genre: string;
  }>;
  const personsConfig: Record<string, Record<string, unknown>> = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    : {};

  console.log(`\n📋 persons_master.json: ${masterPersons.length}人`);

  // ── 1. persons ────────────────────────────────────────────────────────────
  console.log('\n--- [1/8] persons ---');

  // 1a. static 人物（persons_master.json）
  const personMap = new Map<string, typeof persons.$inferInsert>();
  for (const p of masterPersons) {
    const config = personsConfig[p.name] ?? {};
    const aliases = (config.aliases as string[] | undefined) ?? [];
    const tmdbPersonId = (config.tmdbPersonId as number | undefined) ?? null;
    personMap.set(p.name, {
      name:            p.name,
      groupName:       p.group,
      genre:           p.genre,
      aliases,
      tmdbPersonId,
      source:          'static',
      dataFetchStatus: 'not_started',
      config,
    });
    counts.staticPersons++;
  }

  // 1b. imported 人物（バックアップ: imported:persons）— static より優先
  const importedEntry = findHash(backup.entries, 'imported:persons');
  if (!importedEntry) {
    console.warn('⚠️  imported:persons がバックアップに含まれていません');
  } else {
    for (const [, raw] of Object.entries(importedEntry.data)) {
      const p = parse<ImportedPersonRecord>(raw);
      if (!p.name) continue;
      const config = personsConfig[p.name] ?? {};
      personMap.set(p.name, {
        name:             p.name,
        groupName:        p.group,
        genre:            p.genre,
        aliases:          p.aliases ?? [],
        tmdbPersonId:     p.tmdbPersonId ?? null,
        description:      p.description ?? null,
        source:           'imported',
        dataFetchStatus:  p.dataFetchStatus ?? 'not_started',
        lastDataFetchedAt: msToDate(p.lastDataFetchedAt),
        dataFetchError:   p.dataFetchErrorMessage ?? null,
        importedAt:       msToDate(p.importedAt),
        config,
      });
      counts.importedPersons++;
    }
  }

  const personRows = [...personMap.values()];
  await batchInsert(persons, personRows);
  console.log(`  ✓ static ${counts.staticPersons}人 + imported ${counts.importedPersons}人 → ${personRows.length}件挿入`);

  // 1c. publishedAt 設定（persons:published）
  const publishedEntry = findHash(backup.entries, 'persons:published');
  if (!publishedEntry) {
    console.warn('⚠️  persons:published がバックアップに含まれていません');
  } else {
    let updatedCount = 0;
    for (const [name, raw] of Object.entries(publishedEntry.data)) {
      counts.publishedPersons++;
      if (!personMap.has(name)) {
        console.warn(`⚠️  persons:published に "${name}" が存在しますが、personsテーブルに見つかりません（スキップ）`);
        continue;
      }
      const rec = parse<PublishedPersonRecord>(raw);
      const publishedAt = rec.publishedAt ? new Date(rec.publishedAt) : new Date();
      await db.update(persons).set({ publishedAt }).where(eq(persons.name, name));
      updatedCount++;
    }
    console.log(`  ✓ publishedAt 設定: ${updatedCount}件（persons:published 合計: ${counts.publishedPersons}件）`);
  }

  // ── 2. person_meta ────────────────────────────────────────────────────────
  console.log('\n--- [2/8] person_meta ---');
  const metaEntry = findHash(backup.entries, 'admin:person-meta');
  if (!metaEntry) {
    console.warn('⚠️  admin:person-meta がバックアップに含まれていません');
  } else {
    const metaRows: (typeof personMeta.$inferInsert)[] = [];
    for (const [name, raw] of Object.entries(metaEntry.data)) {
      const m = parse<PersonMetaRecord>(raw);
      metaRows.push({
        personName:       name,
        activityStatus:   m.activityStatus ?? null,
        generation:       m.generation ?? null,
        titles:           m.titles ?? null,
        currentGroupName: m.currentGroupName ?? null,
        joinedAt:         m.joinedAt ?? null,
        leftAt:           m.leftAt ?? null,
        formerGroupNames: m.formerGroupNames ?? null,
        membershipNote:   m.membershipNote ?? null,
        primaryGenre:     m.primaryGenre ?? null,
        genres:           m.genres ?? null,
        publicRoles:      m.publicRoles ?? null,
        awards:           m.awards ?? null,
        careerStatus:     m.careerStatus ?? null,
        roleNote:         m.roleNote ?? null,
        memo:             m.memo ?? null,
        priority:         m.priority ?? null,
        updatedAt:        m.updatedAt ? new Date(m.updatedAt) : new Date(),
      });
    }
    counts.personMetaRows = await batchInsert(personMeta, metaRows);
    console.log(`  ✓ ${counts.personMetaRows}件`);
  }

  // ── 3. group_meta ─────────────────────────────────────────────────────────
  console.log('\n--- [3/8] group_meta ---');
  const groupEntry = findHash(backup.entries, 'admin:groups');
  if (!groupEntry) {
    console.warn('⚠️  admin:groups がバックアップに含まれていません');
    console.warn('   最新バックアップには含まれます。古いバックアップの場合は再取得してください。');
  } else {
    const groupRows: (typeof groupMeta.$inferInsert)[] = [];
    for (const [, raw] of Object.entries(groupEntry.data)) {
      const g = parse<GroupMetaRecord>(raw);
      if (!g.groupName) continue;
      groupRows.push({
        groupName:      g.groupName,
        slug:           g.slug ?? '',
        activityStatus: g.activityStatus ?? 'unknown',
        formedAt:       g.formedAt ?? null,
        endedAt:        g.endedAt ?? null,
        renamedFrom:    g.renamedFrom ?? null,
        renamedTo:      g.renamedTo ?? null,
        formerNames:    g.formerNames ?? [],
        officialSite:   g.officialSite ?? null,
        note:           g.note ?? null,
        createdAt:      g.createdAt ? new Date(g.createdAt) : new Date(),
        updatedAt:      g.updatedAt ? new Date(g.updatedAt) : new Date(),
      });
    }
    counts.groupMetaRows = await batchInsert(groupMeta, groupRows);
    console.log(`  ✓ ${counts.groupMetaRows}件`);
  }

  // ── 4. vod_providers ──────────────────────────────────────────────────────
  console.log('\n--- [4/8] vod_providers ---');
  const providersEntry = findHash(backup.entries, 'vod:providers');
  if (!providersEntry) {
    console.warn('⚠️  vod:providers がバックアップに含まれていません');
  } else {
    const providerRows: (typeof vodProviders.$inferInsert)[] = [];
    for (const [, raw] of Object.entries(providersEntry.data)) {
      const p = parse<ProviderRecord>(raw);
      if (!p.slug) continue;
      providerRows.push({
        slug:      p.slug,
        name:      p.name,
        logoUrl:   p.logoUrl ?? '',
        isActive:  p.isActive ?? true,
        createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
        updatedAt: p.updatedAt ? new Date(p.updatedAt) : new Date(),
      });
    }
    counts.vodProviderRows = await batchInsert(vodProviders, providerRows);
    console.log(`  ✓ ${counts.vodProviderRows}件`);
  }

  // ── 5. works ──────────────────────────────────────────────────────────────
  console.log('\n--- [5/8] works ---');
  const worksCollection = findHashCollection(backup.entries, 'works:*');
  if (!worksCollection) {
    console.warn('⚠️  works:* がバックアップに含まれていません');
  } else {
    let totalWorks = 0;
    for (const [redisKey, personWorks] of Object.entries(worksCollection.data)) {
      const personName = redisKey.replace(/^works:/, '');
      const workRows: (typeof works.$inferInsert)[] = [];

      for (const [, raw] of Object.entries(personWorks)) {
        const w = parse<WorkRecord>(raw);
        if (!w.id || !w.title) continue;

        // AI フィールドを JSONB にまとめる
        const aiData: Record<string, unknown> = {};
        if (w.aiDecision !== undefined)             aiData.aiDecision = w.aiDecision;
        if (w.aiSamePerson !== undefined)           aiData.aiSamePerson = w.aiSamePerson;
        if (w.aiReason !== undefined)               aiData.aiReason = w.aiReason;
        if (w.aiRelation !== undefined)             aiData.aiRelation = w.aiRelation;
        if (w.aiStatusRecommendation !== undefined) aiData.aiStatusRecommendation = w.aiStatusRecommendation;
        if (w.aiNeedsHumanReview !== undefined)     aiData.aiNeedsHumanReview = w.aiNeedsHumanReview;
        if (w.usedAi !== undefined)                 aiData.usedAi = w.usedAi;
        if (w.tmdbMatchedPersonId !== undefined)    aiData.tmdbMatchedPersonId = w.tmdbMatchedPersonId;
        if (w.tmdbMatchedPersonName !== undefined)  aiData.tmdbMatchedPersonName = w.tmdbMatchedPersonName;

        // VOD フィールドを JSONB にまとめる
        const vodData: Record<string, unknown> = {
          vodProviders: w.vodProviders ?? [],
        };
        if (w.vodUpdatedAt !== undefined)   vodData.vodUpdatedAt = w.vodUpdatedAt;
        if (w.vodAiCheckedAt !== undefined) vodData.vodAiCheckedAt = w.vodAiCheckedAt;
        if (w.vodStatus !== undefined)      vodData.vodStatus = w.vodStatus;
        if (w.nextVodCheckAt !== undefined) vodData.nextVodCheckAt = w.nextVodCheckAt;
        if (w.lastVodCheckAt !== undefined) vodData.lastVodCheckAt = w.lastVodCheckAt;
        if (w.vodCheckSource !== undefined) vodData.vodCheckSource = w.vodCheckSource;
        if (w.vodCheckStatus !== undefined) vodData.vodCheckStatus = w.vodCheckStatus;
        if (w.vodCheckError !== undefined)  vodData.vodCheckError = w.vodCheckError;
        if (w.priorityRecheck !== undefined) vodData.priorityRecheck = w.priorityRecheck;

        workRows.push({
          id:              w.id,
          personName:      w.personName ?? personName,
          title:           w.title,
          originalTitle:   w.originalTitle ?? null,
          normalizedTitle: w.normalizedTitle ?? '',
          type:            w.type,
          tmdbId:          w.tmdbId ?? null,
          source:          w.source,
          releaseYear:     w.releaseYear ?? null,
          roleName:        w.roleName ?? null,
          overview:        w.overview ?? null,
          posterUrl:       w.posterUrl ?? null,
          confidenceScore: String(w.confidenceScore ?? 0),
          status:          w.status,
          deleted:         w.deleted ?? false,
          deletedAt:       msToDate(w.deletedAt),
          deletedBy:       w.deletedBy ?? null,
          checkedAt:       msToDate(w.checkedAt),
          aiData,
          vodData,
          createdAt:       new Date(w.createdAt),
          updatedAt:       new Date(w.updatedAt),
        });
      }

      await batchInsert(works, workRows);
      totalWorks += workRows.length;
    }
    counts.workRows = totalWorks;
    console.log(`  ✓ ${counts.workRows}件（${Object.keys(worksCollection.data).length}人分）`);
  }

  // ── 6. products ──────────────────────────────────────────────────────────
  console.log('\n--- [6/8] products ---');
  const productsCollection = findHashCollection(backup.entries, 'products:*');
  if (!productsCollection) {
    console.warn('⚠️  products:* がバックアップに含まれていません');
  } else {
    const productRows: (typeof products.$inferInsert)[] = [];
    for (const [redisKey, categoryMap] of Object.entries(productsCollection.data)) {
      const personName = redisKey.replace(/^products:/, '');
      for (const [category, raw] of Object.entries(categoryMap)) {
        const cat = parse<StoredCategoryData>(raw);
        productRows.push({
          personName,
          category,
          fetchedAt:  cat.fetchedAt ? new Date(cat.fetchedAt) : new Date(),
          items:      cat.products ?? [],
        });
      }
    }
    counts.productRows = await batchInsert(products, productRows);
    console.log(`  ✓ ${counts.productRows}件（${Object.keys(productsCollection.data).length}人分）`);
  }

  // ── 7. verdicts ──────────────────────────────────────────────────────────
  console.log('\n--- [7/8] verdicts ---');
  const verdictsCollection = findHashCollection(backup.entries, 'verdicts:*');
  if (!verdictsCollection) {
    console.warn('⚠️  verdicts:* がバックアップに含まれていません');
  } else {
    let totalVerdicts = 0;
    for (const [redisKey, verdictMap] of Object.entries(verdictsCollection.data)) {
      const personName = redisKey.replace(/^verdicts:/, '');
      const verdictRows: (typeof verdicts.$inferInsert)[] = [];

      for (const [productId, raw] of Object.entries(verdictMap)) {
        const j = parse<JudgmentRecord>(raw);
        if (!j.verdict) continue;
        verdictRows.push({
          personName,
          productId,
          verdict:       j.verdict,
          score:         String(j.score ?? 0),
          source:        j.source,
          reason:        j.reason ?? null,
          promptVersion: j.promptVersion ?? null,
          judgedAt:      j.timestamp ? new Date(j.timestamp) : new Date(),
          updatedAt:     j.timestamp ? new Date(j.timestamp) : new Date(),
        });
      }

      await batchInsert(verdicts, verdictRows);
      totalVerdicts += verdictRows.length;
    }
    counts.verdictRows = totalVerdicts;
    console.log(`  ✓ ${counts.verdictRows}件（${Object.keys(verdictsCollection.data).length}人分）`);
  }

  // ── 8. 件数比較サマリー ──────────────────────────────────────────────────
  console.log('\n========== 移行完了 ==========');
  console.log(`  static 人物数     : ${counts.staticPersons}`);
  console.log(`  imported 人物数   : ${counts.importedPersons}`);
  console.log(`  published 人物数  : ${counts.publishedPersons}`);
  console.log(`  person_meta 件数  : ${counts.personMetaRows}`);
  console.log(`  group_meta 件数   : ${counts.groupMetaRows}`);
  console.log(`  vod_providers 件数: ${counts.vodProviderRows}`);
  console.log(`  works 件数        : ${counts.workRows}`);
  console.log(`  products 件数     : ${counts.productRows}`);
  console.log(`  verdicts 件数     : ${counts.verdictRows}`);
  console.log('==============================\n');
  console.log('✅ 完了。既存の Redis 読み書き処理はまだ変更されていません（フェーズ0）。');
}

main().catch((err) => {
  console.error('❌ 移行エラー:', err);
  process.exit(1);
});
