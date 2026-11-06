// 推し活サービスのアフィリエイト案件・広告素材の永続ストレージ（Neon DB）。
//
// - VODアフィリエイト（affiliate-store.ts / affiliate_* テーブル）とは別。VOD側には一切触れない。
// - 公開ページ向けの getPublicOshikatsuAds() は例外を投げない。テーブル未作成・DB障害時は「広告なし」を返し、
//   公開ページは従来どおり公式サイトへの通常リンクを表示する。
// - 広告タグ（ad_html）は保存前に checkAdTag で確認し、通ったものだけをそのまま（改変せず）保存する。
//   確認は API ルート側で行う（このファイルは保存・取得だけ）。

import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  oshikatsuAffiliateServices as servicesTable,
  oshikatsuAffiliateCreatives as creativesTable,
} from '@/db/schema';
import { adBlockedReason, type CreativeKind, type OshikatsuAspId, type OshikatsuCategoryId, type PartnershipStatus } from './constants';
import { pickPublicAdCreative, type PublicAdCreative } from './core';

export interface OshikatsuAffiliateService {
  id: number;
  serviceKey: string;
  serviceName: string;
  category: OshikatsuCategoryId;
  aspId: OshikatsuAspId;
  programId: string | null;
  officialUrl: string;
  partnershipStatus: PartnershipStatus;
  isAdEnabled: boolean;
  note: string | null;
  /** 提携状況・広告素材を最後に確認した日時（未確認は null） */
  checkedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface OshikatsuAffiliateCreative {
  id: number;
  serviceId: number;
  name: string;
  kind: CreativeKind;
  adHtml: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface OshikatsuAffiliateServiceWithCreatives extends OshikatsuAffiliateService {
  creatives: OshikatsuAffiliateCreative[];
}

function serviceRow(r: typeof servicesTable.$inferSelect): OshikatsuAffiliateService {
  return {
    id: r.id,
    serviceKey: r.serviceKey,
    serviceName: r.serviceName,
    category: r.category as OshikatsuCategoryId,
    aspId: r.aspId as OshikatsuAspId,
    programId: r.programId,
    officialUrl: r.officialUrl,
    partnershipStatus: r.partnershipStatus as PartnershipStatus,
    isAdEnabled: r.isAdEnabled,
    note: r.note,
    checkedAt: r.checkedAt ? r.checkedAt.getTime() : null,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

function creativeRow(r: typeof creativesTable.$inferSelect): OshikatsuAffiliateCreative {
  return {
    id: r.id,
    serviceId: r.serviceId,
    name: r.name,
    kind: r.kind as CreativeKind,
    adHtml: r.adHtml,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

// ─── 管理画面用 ───────────────────────────────────────────────────────────────
export async function listOshikatsuAffiliateServicesOrThrow(): Promise<OshikatsuAffiliateServiceWithCreatives[]> {
  const [services, creatives] = await Promise.all([
    db.select().from(servicesTable).orderBy(asc(servicesTable.category), asc(servicesTable.id)),
    db.select().from(creativesTable).orderBy(asc(creativesTable.sortOrder), asc(creativesTable.id)),
  ]);
  const byService = new Map<number, OshikatsuAffiliateCreative[]>();
  for (const c of creatives.map(creativeRow)) {
    const list = byService.get(c.serviceId) ?? [];
    list.push(c);
    byService.set(c.serviceId, list);
  }
  return services.map(serviceRow).map((s) => ({ ...s, creatives: byService.get(s.id) ?? [] }));
}

export async function getOshikatsuAffiliateService(id: number): Promise<OshikatsuAffiliateService | null> {
  const [row] = await db.select().from(servicesTable).where(eq(servicesTable.id, id));
  return row ? serviceRow(row) : null;
}

export async function getOshikatsuAffiliateCreative(id: number): Promise<OshikatsuAffiliateCreative | null> {
  const [row] = await db.select().from(creativesTable).where(eq(creativesTable.id, id));
  return row ? creativeRow(row) : null;
}

export async function findOshikatsuAffiliateServiceByKey(serviceKey: string): Promise<OshikatsuAffiliateService | null> {
  const [row] = await db.select().from(servicesTable).where(eq(servicesTable.serviceKey, serviceKey));
  return row ? serviceRow(row) : null;
}

export interface OshikatsuAffiliateServiceInput {
  serviceKey: string;
  serviceName: string;
  category: OshikatsuCategoryId;
  aspId: OshikatsuAspId;
  programId: string | null;
  officialUrl: string;
  partnershipStatus: PartnershipStatus;
  isAdEnabled: boolean;
  note: string | null;
  checkedAt: number | null;
}

function toDbValues<T extends { checkedAt?: number | null }>(input: T): Omit<T, 'checkedAt'> & { checkedAt?: Date | null } {
  const { checkedAt, ...rest } = input;
  return checkedAt === undefined ? rest : { ...rest, checkedAt: checkedAt === null ? null : new Date(checkedAt) };
}

export async function createOshikatsuAffiliateService(input: OshikatsuAffiliateServiceInput): Promise<OshikatsuAffiliateService> {
  const [row] = await db.insert(servicesTable).values(toDbValues(input)).returning();
  return serviceRow(row);
}

/** serviceKey は作成後に変更しない（公開ページとの結びつきが変わるため） */
export async function updateOshikatsuAffiliateService(
  id: number,
  patch: Partial<Omit<OshikatsuAffiliateServiceInput, 'serviceKey'>>,
): Promise<OshikatsuAffiliateService | null> {
  const [row] = await db.update(servicesTable)
    .set({ ...toDbValues(patch), updatedAt: new Date() })
    .where(eq(servicesTable.id, id))
    .returning();
  return row ? serviceRow(row) : null;
}

export interface OshikatsuAffiliateCreativeInput {
  name: string;
  kind: CreativeKind;
  adHtml: string;
  isActive: boolean;
  sortOrder: number;
}

export async function createOshikatsuAffiliateCreative(serviceId: number, input: OshikatsuAffiliateCreativeInput): Promise<OshikatsuAffiliateCreative> {
  const [row] = await db.insert(creativesTable).values({ serviceId, ...input }).returning();
  await touchService(serviceId);
  return creativeRow(row);
}

export async function updateOshikatsuAffiliateCreative(id: number, patch: Partial<OshikatsuAffiliateCreativeInput>): Promise<OshikatsuAffiliateCreative | null> {
  const [row] = await db.update(creativesTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(creativesTable.id, id))
    .returning();
  if (row) await touchService(row.serviceId);
  return row ? creativeRow(row) : null;
}

export async function deleteOshikatsuAffiliateCreative(id: number): Promise<void> {
  const [row] = await db.delete(creativesTable).where(eq(creativesTable.id, id)).returning();
  if (row) await touchService(row.serviceId);
}

// 素材を変更したら案件の「最終更新日時」も更新する
async function touchService(serviceId: number): Promise<void> {
  await db.update(servicesTable).set({ updatedAt: new Date() }).where(eq(servicesTable.id, serviceId));
}

// ─── 公開ページ用 ─────────────────────────────────────────────────────────────
/**
 * 公開ページの各サービスに表示する広告タグ。広告を出さないサービスは結果に含めない（＝通常リンクを表示）。
 * 例外は投げない（テーブル未作成・DB障害時は空を返す）。
 * サイト側の方針で広告を止めているサービス（OSHIKATSU_AD_BLOCKED）は、管理画面で有効にしても含めない。
 * 判定に必要な列だけを読む（あとから追加した列（checked_at など）が本番DBに未反映でも、公開ページの広告表示に影響させないため）。
 */
export async function getPublicOshikatsuAds(serviceKeys: readonly string[]): Promise<Record<string, PublicAdCreative>> {
  const keys = serviceKeys.filter((k) => adBlockedReason(k) === null);
  if (keys.length === 0) return {};
  try {
    const services = await db
      .select({
        id: servicesTable.id,
        serviceKey: servicesTable.serviceKey,
        aspId: servicesTable.aspId,
        partnershipStatus: servicesTable.partnershipStatus,
        isAdEnabled: servicesTable.isAdEnabled,
      })
      .from(servicesTable)
      .where(inArray(servicesTable.serviceKey, keys));
    const candidates = services.filter((s) => s.partnershipStatus === 'approved' && s.isAdEnabled);
    if (candidates.length === 0) return {};
    const creatives = await db.select().from(creativesTable)
      .where(inArray(creativesTable.serviceId, candidates.map((s) => s.id)));
    const result: Record<string, PublicAdCreative> = {};
    for (const s of candidates) {
      const picked = pickPublicAdCreative(s, creatives.filter((c) => c.serviceId === s.id).map(creativeRow));
      if (picked) result[s.serviceKey] = picked;
    }
    return result;
  } catch (err) {
    console.error('[oshikatsu-affiliate] getPublicOshikatsuAds failed:', String(err));
    return {};
  }
}
