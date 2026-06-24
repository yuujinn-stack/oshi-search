// 楽天APIから取得した商品データを Redis に永続保存するモジュール
// バッチ処理でのみ書き込み、人物ページと管理画面から読み取る

import { getRedis } from './redis';
import type { RakutenItem } from '@/types/rakuten';
import type { ProductCategory } from '@/types/person';

export const CATEGORIES: ProductCategory[] = ['写真集', '本・雑誌', 'Blu-ray・DVD', 'グッズ', 'CD', '中古'];

export interface StoredCategoryData {
  products: RakutenItem[];
  fetchedAt: number; // バッチ実行のタイムスタンプ
}

// Redis hash key: "products:{personName}" → field: category → value: JSON
function hashKey(personName: string): string {
  return `products:${personName}`;
}

// カテゴリ単位で商品を保存（バッチ処理から呼ぶ）
// verdictIds を渡すと、新規フェッチに含まれなかった verdict 済み商品を既存データから保持する。
// これにより「手動採用した商品が楽天再取得で消える」問題を防ぐ。
export async function storeProducts(
  personName: string,
  category: ProductCategory,
  products: RakutenItem[],
  verdictIds?: Set<string>,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  let finalProducts = products;

  if (verdictIds && verdictIds.size > 0) {
    const raw = await redis.hget(hashKey(personName), category);
    if (raw) {
      try {
        const existing: StoredCategoryData = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const newIds = new Set(products.map((p) => p.id));
        const preserved = (existing.products ?? []).filter(
          (p) => !newIds.has(p.id) && verdictIds.has(p.id),
        );
        if (preserved.length > 0) {
          console.log(`[store] ${personName}/${category}: verdict済み${preserved.length}件を保持`);
          finalProducts = [...products, ...preserved];
        }
      } catch { /* 既存データ取得失敗時はそのまま上書き */ }
    }
  }

  const data: StoredCategoryData = { products: finalProducts, fetchedAt: Date.now() };
  await redis.hset(hashKey(personName), { [category]: JSON.stringify(data) });
}

// 人物の全カテゴリを一括取得（人物ページレンダリング時）
export async function getAllStoredProducts(
  personName: string
): Promise<Partial<Record<ProductCategory, StoredCategoryData>>> {
  const redis = getRedis();
  if (!redis) return {};
  try {
    const raw = await redis.hgetall(hashKey(personName));
    if (!raw) return {};
    const result: Partial<Record<ProductCategory, StoredCategoryData>> = {};
    for (const [k, v] of Object.entries(raw)) {
      if ((CATEGORIES as string[]).includes(k)) {
        try {
          const parsed = typeof v === 'string' ? JSON.parse(v) : v;
          result[k as ProductCategory] = parsed as StoredCategoryData;
        } catch { /* 壊れたデータはスキップ */ }
      }
    }
    return result;
  } catch {
    return {};
  }
}

// バッチの最終実行情報を保存
export async function saveBatchMeta(meta: {
  lastRunAt: number;
  personCount: number;
  aiJudged: number;
}): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set('batch:meta', JSON.stringify(meta), { ex: 60 * 60 * 24 * 30 });
}

// バッチの最終実行情報を取得
export async function getBatchMeta(): Promise<{
  lastRunAt: number;
  personCount: number;
  aiJudged: number;
} | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get<string>('batch:meta');
    if (!raw) return null;
    return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
  } catch {
    return null;
  }
}
