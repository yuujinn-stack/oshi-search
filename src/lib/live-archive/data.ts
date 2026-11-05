// 過去のライブ映像発掘特集のデータ取得（サーバー専用）。
// 商品は既存の products（人物×保存カテゴリ）の「Blu-ray・DVD」行を読むだけ（書き込み・楽天APIの呼び出しはしない）。
// 楽天のキャンペーンは楽天イベント管理のテーブルを読むだけ。テーブルが無い・読めないときは枠を出さない。
import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { products as productsTable } from '@/db/schema';
import { withPriceFreshness } from '@/lib/price-freshness';
import { listPublishedOpenEvents, neonEventDb } from '@/lib/rakuten-event/store';
import { publicCampaigns, type PublicCampaign } from '@/lib/rakuten-campaign/core';
import type { StoredCategoryData } from '@/lib/product-store';
import type { ProductCategory } from '@/types/person';
import type { RakutenItem } from '@/types/rakuten';
import { buildLiveArchive, indexByBooksNumber, isLiveArchiveGroup, type LiveArchiveEntry } from './core';

/** 掲載リストの商品はすべて楽天ブックスの DVD 検索で取得した「Blu-ray・DVD」カテゴリにある */
const LIVE_CATEGORY: ProductCategory = 'Blu-ray・DVD';

function withFreshness(items: RakutenItem[], nowMs: number): RakutenItem[] {
  return items.map((p) => withPriceFreshness(p, nowMs));
}

/** グループページ用：ページで読み込み済みのメンバーの商品データから作る（追加のDB読み取りなし） */
export function liveArchiveFromStored(
  groupName: string,
  storedList: Array<Partial<Record<ProductCategory, StoredCategoryData>>>,
  nowMs: number,
): LiveArchiveEntry[] {
  if (!isLiveArchiveGroup(groupName)) return [];
  const items = storedList.flatMap((s) => s[LIVE_CATEGORY]?.products ?? []);
  return buildLiveArchive(groupName, indexByBooksNumber(withFreshness(items, nowMs)));
}

/** 一覧ページ用：メンバーの「Blu-ray・DVD」行だけを読む */
export async function loadLiveArchive(groupName: string, memberNames: string[], nowMs: number): Promise<LiveArchiveEntry[]> {
  if (!isLiveArchiveGroup(groupName) || memberNames.length === 0) return [];
  const rows = await db.select({ items: productsTable.items }).from(productsTable)
    .where(and(inArray(productsTable.personName, memberNames), eq(productsTable.category, LIVE_CATEGORY)));
  const items = rows.flatMap((r) => (Array.isArray(r.items) ? (r.items as RakutenItem[]) : []));
  return buildLiveArchive(groupName, indexByBooksNumber(withFreshness(items, nowMs)));
}

/** 公開してよい楽天のキャンペーン（読めないときは空） */
export async function loadPublicCampaigns(nowMs: number): Promise<PublicCampaign[]> {
  try {
    return publicCampaigns(await listPublishedOpenEvents(neonEventDb()), nowMs);
  } catch (err) {
    const e = err as { name?: string; code?: string } | null;
    console.error('[live-archive] campaigns unavailable:', e?.name ?? 'Error', e?.code ?? '');
    return [];
  }
}
