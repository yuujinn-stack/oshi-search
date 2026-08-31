// VODアフィリエイト広告データの永続ストレージ（Neon DB）。
//
// 重要な設計方針:
// ・「作品がどのVODで配信されているか」（vod-dedup.ts / works.vod_data）とは完全に別概念。
//   このファイルは「そのVODサービスとアフィリエイト提携しているか」だけを扱う。
// ・ここでの取得に失敗しても既存VOD表示に影響してはいけないため、公開ページ向けの
//   resolveAffiliateCreative() は例外を投げず、失敗時・未登録時は null を返す
//   （呼び出し側は null のとき必ず既存リンク・既存UIへフォールバックする）。
// ・クリック数・表示回数などの計測は一切行わない（ASP側の管理画面で確認する方針）。

import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  affiliatePrograms as affiliateProgramsTable,
  affiliateCreatives as affiliateCreativesTable,
  affiliatePlacements as affiliatePlacementsTable,
} from '@/db/schema';
import { KNOWN_SLOT_KEYS } from '@/lib/affiliate-constants';

export { KNOWN_SLOT_KEYS };

export type AffiliateProgramStatus = 'active' | 'paused' | 'pending' | 'ended';
export type AffiliateCreativeType = 'raw_html' | 'direct_url' | 'banner' | 'text' | 'embed';
export type AffiliateDevice = 'all' | 'desktop' | 'mobile';

export interface AffiliateProgram {
  id: number;
  vodService: string;
  aspName: string;
  programName: string;
  status: AffiliateProgramStatus;
  rulesNote: string | null;
  directUrlAllowed: boolean;
  customCreativeAllowed: boolean;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AffiliateCreative {
  id: number;
  programId: number;
  name: string;
  type: AffiliateCreativeType;
  rawCode: string | null;
  destinationUrl: string | null;
  imageUrl: string | null;
  altText: string | null;
  width: number | null;
  height: number | null;
  device: AffiliateDevice;
  priority: number;
  isActive: boolean;
  startsAt: number | null;
  endsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AffiliatePlacement {
  id: number;
  creativeId: number;
  slotKey: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

function programRow(r: typeof affiliateProgramsTable.$inferSelect): AffiliateProgram {
  return {
    id: r.id,
    vodService: r.vodService,
    aspName: r.aspName,
    programName: r.programName,
    status: r.status as AffiliateProgramStatus,
    rulesNote: r.rulesNote,
    directUrlAllowed: r.directUrlAllowed,
    customCreativeAllowed: r.customCreativeAllowed,
    isActive: r.isActive,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

function creativeRow(r: typeof affiliateCreativesTable.$inferSelect): AffiliateCreative {
  return {
    id: r.id,
    programId: r.programId,
    name: r.name,
    type: r.type as AffiliateCreativeType,
    rawCode: r.rawCode,
    destinationUrl: r.destinationUrl,
    imageUrl: r.imageUrl,
    altText: r.altText,
    width: r.width,
    height: r.height,
    device: r.device as AffiliateDevice,
    priority: r.priority,
    isActive: r.isActive,
    startsAt: r.startsAt ? r.startsAt.getTime() : null,
    endsAt: r.endsAt ? r.endsAt.getTime() : null,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

function placementRow(r: typeof affiliatePlacementsTable.$inferSelect): AffiliatePlacement {
  return {
    id: r.id,
    creativeId: r.creativeId,
    slotKey: r.slotKey,
    isActive: r.isActive,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

// ─── 管理画面用: 案件+素材+掲載位置を1回で取得（一覧表示用） ────────────────────
export interface AffiliateProgramWithCreatives extends AffiliateProgram {
  creatives: (AffiliateCreative & { placements: AffiliatePlacement[] })[];
}

export async function getAllAffiliateProgramsOrThrow(): Promise<AffiliateProgramWithCreatives[]> {
  const [programs, creatives, placements] = await Promise.all([
    db.select().from(affiliateProgramsTable),
    db.select().from(affiliateCreativesTable),
    db.select().from(affiliatePlacementsTable),
  ]);

  const placementsByCreative = new Map<number, AffiliatePlacement[]>();
  for (const p of placements.map(placementRow)) {
    const list = placementsByCreative.get(p.creativeId) ?? [];
    list.push(p);
    placementsByCreative.set(p.creativeId, list);
  }

  const creativesByProgram = new Map<number, (AffiliateCreative & { placements: AffiliatePlacement[] })[]>();
  for (const c of creatives.map(creativeRow)) {
    const list = creativesByProgram.get(c.programId) ?? [];
    list.push({ ...c, placements: placementsByCreative.get(c.id) ?? [] });
    creativesByProgram.set(c.programId, list);
  }

  return programs
    .map(programRow)
    .map((p) => ({ ...p, creatives: creativesByProgram.get(p.id) ?? [] }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// ─── 案件 CRUD ────────────────────────────────────────────────────────────────
export interface AffiliateProgramInput {
  vodService: string;
  aspName: string;
  programName: string;
  status: AffiliateProgramStatus;
  rulesNote?: string | null;
  directUrlAllowed: boolean;
  customCreativeAllowed: boolean;
  isActive: boolean;
}

export async function createAffiliateProgram(input: AffiliateProgramInput): Promise<AffiliateProgram> {
  const [row] = await db.insert(affiliateProgramsTable).values({
    vodService: input.vodService,
    aspName: input.aspName,
    programName: input.programName,
    status: input.status,
    rulesNote: input.rulesNote ?? null,
    directUrlAllowed: input.directUrlAllowed,
    customCreativeAllowed: input.customCreativeAllowed,
    isActive: input.isActive,
  }).returning();
  return programRow(row);
}

export async function updateAffiliateProgram(id: number, input: AffiliateProgramInput): Promise<AffiliateProgram | null> {
  const [row] = await db.update(affiliateProgramsTable).set({
    vodService: input.vodService,
    aspName: input.aspName,
    programName: input.programName,
    status: input.status,
    rulesNote: input.rulesNote ?? null,
    directUrlAllowed: input.directUrlAllowed,
    customCreativeAllowed: input.customCreativeAllowed,
    isActive: input.isActive,
    updatedAt: new Date(),
  }).where(eq(affiliateProgramsTable.id, id)).returning();
  return row ? programRow(row) : null;
}

// 案件削除。紐づく広告素材・掲載位置も合わせて削除する（案件停止だけなら isActive=false を推奨）。
export async function deleteAffiliateProgram(id: number): Promise<void> {
  const creatives = await db
    .select({ id: affiliateCreativesTable.id })
    .from(affiliateCreativesTable)
    .where(eq(affiliateCreativesTable.programId, id));
  const creativeIds = creatives.map((c) => c.id);
  if (creativeIds.length > 0) {
    await db.delete(affiliatePlacementsTable).where(inArray(affiliatePlacementsTable.creativeId, creativeIds));
    await db.delete(affiliateCreativesTable).where(inArray(affiliateCreativesTable.id, creativeIds));
  }
  await db.delete(affiliateProgramsTable).where(eq(affiliateProgramsTable.id, id));
}

// ─── 広告素材 CRUD ────────────────────────────────────────────────────────────
export interface AffiliateCreativeInput {
  name: string;
  type: AffiliateCreativeType;
  rawCode?: string | null;
  destinationUrl?: string | null;
  imageUrl?: string | null;
  altText?: string | null;
  width?: number | null;
  height?: number | null;
  device: AffiliateDevice;
  priority: number;
  isActive: boolean;
  startsAt?: number | null;
  endsAt?: number | null;
}

export async function createAffiliateCreative(programId: number, input: AffiliateCreativeInput): Promise<AffiliateCreative> {
  const [row] = await db.insert(affiliateCreativesTable).values({
    programId,
    name: input.name,
    type: input.type,
    rawCode: input.rawCode ?? null,
    destinationUrl: input.destinationUrl ?? null,
    imageUrl: input.imageUrl ?? null,
    altText: input.altText ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    device: input.device,
    priority: input.priority,
    isActive: input.isActive,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
  }).returning();
  return creativeRow(row);
}

export async function updateAffiliateCreative(id: number, input: AffiliateCreativeInput): Promise<AffiliateCreative | null> {
  const [row] = await db.update(affiliateCreativesTable).set({
    name: input.name,
    type: input.type,
    rawCode: input.rawCode ?? null,
    destinationUrl: input.destinationUrl ?? null,
    imageUrl: input.imageUrl ?? null,
    altText: input.altText ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    device: input.device,
    priority: input.priority,
    isActive: input.isActive,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    updatedAt: new Date(),
  }).where(eq(affiliateCreativesTable.id, id)).returning();
  return row ? creativeRow(row) : null;
}

export async function deleteAffiliateCreative(id: number): Promise<void> {
  await db.delete(affiliatePlacementsTable).where(eq(affiliatePlacementsTable.creativeId, id));
  await db.delete(affiliateCreativesTable).where(eq(affiliateCreativesTable.id, id));
}

// ─── 掲載位置 CRUD ────────────────────────────────────────────────────────────
export async function addAffiliatePlacement(creativeId: number, slotKey: string): Promise<AffiliatePlacement> {
  const [row] = await db.insert(affiliatePlacementsTable).values({
    creativeId,
    slotKey,
    isActive: true,
  }).returning();
  return placementRow(row);
}

export async function setAffiliatePlacementActive(id: number, isActive: boolean): Promise<AffiliatePlacement | null> {
  const [row] = await db.update(affiliatePlacementsTable).set({
    isActive,
    updatedAt: new Date(),
  }).where(eq(affiliatePlacementsTable.id, id)).returning();
  return row ? placementRow(row) : null;
}

export async function deleteAffiliatePlacement(id: number): Promise<void> {
  await db.delete(affiliatePlacementsTable).where(eq(affiliatePlacementsTable.id, id));
}

// ─── 公開ページ用: 掲載位置解決ロジック ────────────────────────────────────────
//
// vodService + slotKey を受け取り、その組み合わせで実際に表示すべき広告素材を1件返す。
// 判定順序: 有効な案件 → 有効な素材 → 該当slotKeyのplacement → 期限内 → device一致 → priority降順。
// device は 'desktop' と 'mobile' それぞれについて個別に最有力候補を計算する
// （ヘッダーのUser-Agent判定はページのISR/静的レンダリングを妨げるため使わず、
//  呼び出し側で CSS のレスポンシブ表示切り替えにより最終的な出し分けを行う）。
export interface ResolvedAffiliateCreative {
  id: number;
  programId: number;
  name: string;
  type: AffiliateCreativeType;
  rawCode: string | null;
  destinationUrl: string | null;
  imageUrl: string | null;
  altText: string | null;
  width: number | null;
  height: number | null;
}

function toResolved(c: AffiliateCreative): ResolvedAffiliateCreative {
  return {
    id: c.id,
    programId: c.programId,
    name: c.name,
    type: c.type,
    rawCode: c.rawCode,
    destinationUrl: c.destinationUrl,
    imageUrl: c.imageUrl,
    altText: c.altText,
    width: c.width,
    height: c.height,
  };
}

export interface AffiliateSlotResolution {
  mobile: ResolvedAffiliateCreative | null;
  desktop: ResolvedAffiliateCreative | null;
}

const EMPTY_RESOLUTION: AffiliateSlotResolution = { mobile: null, desktop: null };

export async function resolveAffiliateSlot(vodService: string, slotKey: string): Promise<AffiliateSlotResolution> {
  try {
    const programs = await db
      .select({ id: affiliateProgramsTable.id })
      .from(affiliateProgramsTable)
      .where(and(
        eq(affiliateProgramsTable.vodService, vodService),
        eq(affiliateProgramsTable.isActive, true),
        eq(affiliateProgramsTable.status, 'active'),
      ));
    if (programs.length === 0) return EMPTY_RESOLUTION;
    const programIds = programs.map((p) => p.id);

    const creatives = await db
      .select()
      .from(affiliateCreativesTable)
      .where(and(
        inArray(affiliateCreativesTable.programId, programIds),
        eq(affiliateCreativesTable.isActive, true),
      ));
    if (creatives.length === 0) return EMPTY_RESOLUTION;
    const creativeIds = creatives.map((c) => c.id);

    const placements = await db
      .select()
      .from(affiliatePlacementsTable)
      .where(and(
        inArray(affiliatePlacementsTable.creativeId, creativeIds),
        eq(affiliatePlacementsTable.slotKey, slotKey),
        eq(affiliatePlacementsTable.isActive, true),
      ));
    if (placements.length === 0) return EMPTY_RESOLUTION;
    const placedCreativeIds = new Set(placements.map((p) => p.creativeId));

    const now = Date.now();
    const eligible = creatives
      .map(creativeRow)
      .filter((c) => placedCreativeIds.has(c.id))
      .filter((c) => c.startsAt === null || c.startsAt <= now)
      .filter((c) => c.endsAt === null || c.endsAt >= now);

    function pickBest(device: 'desktop' | 'mobile'): AffiliateCreative | null {
      const candidates = eligible.filter((c) => c.device === 'all' || c.device === device);
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.createdAt - b.createdAt; // 同順位は先に作成されたものを安定して優先
      });
      return candidates[0];
    }

    const desktopBest = pickBest('desktop');
    const mobileBest = pickBest('mobile');

    return {
      desktop: desktopBest ? toResolved(desktopBest) : null,
      mobile: mobileBest ? toResolved(mobileBest) : null,
    };
  } catch (err) {
    // Affiliate機能の障害で本体ページ（作品詳細・VODページ・人物ページ)を落とさない。
    console.error('[affiliate-store] resolveAffiliateSlot failed:', String(err));
    return EMPTY_RESOLUTION;
  }
}

// ── デバッグ・管理画面用: 案件単体取得 ──────────────────────────────────────
export async function getAffiliateProgramById(id: number): Promise<AffiliateProgram | null> {
  const [row] = await db.select().from(affiliateProgramsTable).where(eq(affiliateProgramsTable.id, id));
  return row ? programRow(row) : null;
}

export async function getAffiliateCreativeById(id: number): Promise<AffiliateCreative | null> {
  const [row] = await db.select().from(affiliateCreativesTable).where(eq(affiliateCreativesTable.id, id));
  return row ? creativeRow(row) : null;
}

export async function getAffiliatePlacementById(id: number): Promise<AffiliatePlacement | null> {
  const [row] = await db.select().from(affiliatePlacementsTable).where(eq(affiliatePlacementsTable.id, id));
  return row ? placementRow(row) : null;
}

export async function getAffiliateCreativesByProgramId(programId: number): Promise<AffiliateCreative[]> {
  const rows = await db
    .select()
    .from(affiliateCreativesTable)
    .where(eq(affiliateCreativesTable.programId, programId))
    .orderBy(desc(affiliateCreativesTable.priority));
  return rows.map(creativeRow);
}
