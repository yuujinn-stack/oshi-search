// 配信サービス（VOD）プロバイダーデータの永続ストレージ（Neon DB）
// 管理画面からのみ書き込み、ProviderLogo コンポーネントから読み取る

import { db } from '@/db/client';
import { vodProviders as vodProvidersTable } from '@/db/schema';
import { upsertVodProvider, deleteVodProviderInDB } from '@/db/write';

export interface ProviderRecord {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

// DB行 → ProviderRecord マッピング（id は DB に存在しないため slug で代替）
function dbRowToProviderRecord(r: typeof vodProvidersTable.$inferSelect): ProviderRecord {
  return {
    id:        r.slug,
    name:      r.name,
    slug:      r.slug,
    logoUrl:   r.logoUrl,
    isActive:  r.isActive,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  };
}

export async function getAllProviders(): Promise<ProviderRecord[]> {
  try {
    const rows = await db.select().from(vodProvidersTable);
    return rows.map(dbRowToProviderRecord).sort((a, b) => a.slug.localeCompare(b.slug));
  } catch (err) {
    console.error('[db] getAllProviders failed:', String(err));
    return [];
  }
}

// DBエラー時に throw する版（管理画面で error/empty を区別するために使う）
export async function getAllProvidersOrThrow(): Promise<ProviderRecord[]> {
  const rows = await db.select().from(vodProvidersTable);
  return rows.map(dbRowToProviderRecord).sort((a, b) => a.slug.localeCompare(b.slug));
}

// アクティブなプロバイダーの slug → logoUrl マップを返す（/api/providers 用）
export async function getActiveProviderLogoMap(): Promise<Record<string, string>> {
  const providers = await getAllProviders();
  const map: Record<string, string> = {};
  for (const p of providers) {
    if (p.isActive && p.logoUrl) {
      map[p.slug] = p.logoUrl;
    }
  }
  return map;
}

export async function saveProvider(record: ProviderRecord): Promise<void> {
  await upsertVodProvider(record);
}

export async function deleteProvider(slug: string): Promise<void> {
  await deleteVodProviderInDB(slug);
}
