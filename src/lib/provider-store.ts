// 配信サービス（VOD）プロバイダーデータの永続ストレージ（Neon DB）
// 管理画面からのみ書き込み、ProviderLogo コンポーネントから読み取る

import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { vodProviders as vodProvidersTable } from '@/db/schema';
import { upsertVodProvider, deleteVodProviderInDB } from '@/db/write';
import { normalizeProviderName } from '@/lib/vod-dedup';

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

// 日本で確実に終了しているサービスの正規化済みスラグ（静的安全策）
// vod_providers テーブルに未登録の場合や DB 障害時のフォールバックとして機能する
// dTV → Lemino 移行済み / GYAO! → 2023年7月終了 / Paravi → U-NEXT 統合済み
// ※ dTV を Lemino へ、Paravi を U-NEXT へ自動置き換えはしない（非表示のみ）
const KNOWN_TERMINATED_SLUGS = new Set(['dtv', 'gyao', 'paravi']);

// isActive=false のプロバイダーの正規化済みslugセットを返す
// DB結果と KNOWN_TERMINATED_SLUGS を合算する
// DB接続失敗時は KNOWN_TERMINATED_SLUGS のみを返す（完全 fail-open より安全）
export async function getInactiveProviderSlugs(): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ slug: vodProvidersTable.slug })
      .from(vodProvidersTable)
      .where(eq(vodProvidersTable.isActive, false));
    const dbSlugs = new Set(rows.map((r) => normalizeProviderName(r.slug)));
    return new Set([...KNOWN_TERMINATED_SLUGS, ...dbSlugs]);
  } catch {
    // DB障害時: 静的リストのみ返す（完全な空Setは避ける）
    return new Set(KNOWN_TERMINATED_SLUGS);
  }
}

export async function saveProvider(record: ProviderRecord): Promise<void> {
  await upsertVodProvider(record);
}

export async function deleteProvider(slug: string): Promise<void> {
  await deleteVodProviderInDB(slug);
}
