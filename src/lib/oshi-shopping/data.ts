// 推し活お買い物診断のデータ取得（サーバー専用）。DB は読み取りのみ。
//
// 表示を速くするため、推しの関連商品（DB）と一般商品（楽天API）を別々に取得する（それぞれ既存の unstable_cache でキャッシュ）。
// ページは推しの関連商品を先に描画し、一般商品は取得でき次第ストリーミングで表示する（Suspense）。
import { unstable_cache } from 'next/cache';
import { getPersonWithConfigMerged } from '@/lib/persons';
import { getAllStoredProductsOrThrow } from '@/lib/product-store';
import { getAllVerdictsOrThrow } from '@/lib/judgment-store';
import { neonSql } from '@/db/client';
import { getRedis } from '@/lib/redis';
import { lookupCodeOf } from '@/lib/price-refresh';
import { LOOKUP_CACHE_PREFIX } from '@/lib/price-refresh-runner';
import type { ProductCategory, RakutenItem } from '@/types/rakuten';
import { getPersonMeta } from '@/lib/person-meta';
import type { PersonDisplayContext } from '@/lib/product-display-score';
import { selectGeneralItems, selectPersonItems, type GeneralPickResult, type PersonPickResult } from './core';
import { getGeneralItemEntries } from './general-items';
import { lookupGeneralItems } from './rakuten-lookup';
import type { OshiShoppingBudget, OshiShoppingUse } from './params';

export interface OshiShoppingPersonPart {
  person: { name: string; group: string };
  personItems: PersonPickResult | null;
  /** 推しの関連商品を取得できなかった（DBエラー等） */
  personError: boolean;
}

export interface OshiShoppingGeneralPart {
  generalItems: GeneralPickResult;
  /** 選定リストが未設定（環境変数なし・不正） */
  notConfigured: boolean;
  /** 取得に失敗した件数（API エラー等） */
  failed: number;
}

/** 人物が登録されていなければ null */
export async function loadOshiShoppingPersonPart(
  personName: string,
  use: OshiShoppingUse,
  budget: OshiShoppingBudget,
): Promise<OshiShoppingPersonPart | null> {
  const person = await getPersonWithConfigMerged(personName);
  if (!person) return null;

  const meta = await getPersonMeta(person.name).catch(() => null);
  const ctx: PersonDisplayContext = {
    name: person.name,
    groupName: person.group ?? '',
    aliases: (person.config.aliases ?? []).filter((a) => a.length >= 3),
    generation: meta?.generation ?? '',
  };

  let personItems: PersonPickResult | null = null;
  try {
    personItems = await cachedSelectPersonItems(ctx, use, budget);
  } catch (err) {
    console.error('[oshi-shopping] 関連商品の取得に失敗しました:', String(err));
  }
  return { person: { name: person.name, group: person.group ?? '' }, personError: personItems === null, personItems };
}

// 選定結果（最大4件＋件数）だけを短時間キャッシュする（/oshi-vod と同じ unstable_cache。商品データ自体は1日1回の更新）。
// 取得エラーは例外のまま投げ、キャッシュさせない。
const PERSON_RESULT_CACHE_SECONDS = 60 * 60;
export const OSHI_SHOPPING_PERSON_CACHE_TAG = 'oshi-shopping-person';
// 2: 判定が不確かな商品（旧IDの重複）・価格の確認待ち・販売終了の確認済みを除外、価格の表示を strict に（Task 132）
const PERSON_RESULT_VERSION = 2;

function cachedSelectPersonItems(ctx: PersonDisplayContext, use: OshiShoppingUse, budget: OshiShoppingBudget): Promise<PersonPickResult> {
  return unstable_cache(
    async () => {
      const [stored, verdicts] = await Promise.all([getAllStoredProductsOrThrow(ctx.name), getAllVerdictsOrThrow(ctx.name)]);
      const [priceReviewIds, unavailableIds] = await Promise.all([pendingPriceReviewIds(ctx.name), knownUnavailableIds(stored, verdicts)]);
      return selectPersonItems({ storedData: stored, verdicts, priceReviewIds, unavailableIds }, ctx, use, budget);
    },
    ['oshi-shopping-person', `v${PERSON_RESULT_VERSION}`, ctx.name, ctx.groupName, ctx.generation ?? '', ctx.aliases.join('|'), use, budget],
    { revalidate: PERSON_RESULT_CACHE_SECONDS, tags: [OSHI_SHOPPING_PERSON_CACHE_TAG] },
  )();
}

/** 価格の確認待ち（pending）の商品ID（読み取りのみ。テーブルが無い・読めない場合は空＝従来どおり） */
async function pendingPriceReviewIds(personName: string): Promise<Set<string>> {
  try {
    const rows = (await neonSql`SELECT item_id FROM price_reviews WHERE person_name = ${personName} AND status = 'pending'`) as { item_id: string }[];
    return new Set(rows.map((r) => r.item_id));
  } catch {
    return new Set();
  }
}

/**
 * 価格更新（コード指定）が楽天ブックスで「品切れ・販売終了等で購入できない」と確認した商品ID（読み取りのみ）。
 * 価格更新の共有キャッシュ（Redis、期限3日）の status 付きの値を読むだけ。読めなければ空（従来どおり）。
 */
async function knownUnavailableIds(
  stored: Partial<Record<ProductCategory, { products: RakutenItem[] }>>,
  verdicts: Record<string, { verdict: string } | undefined>,
): Promise<Set<string>> {
  const redis = getRedis();
  if (!redis) return new Set();
  const byCode = new Map<string, string[]>();
  for (const row of Object.values(stored)) {
    for (const p of row?.products ?? []) {
      if (verdicts[p.id]?.verdict !== 'related') continue;
      const code = lookupCodeOf(p);
      if (code?.startsWith('book:')) (byCode.get(code) ?? byCode.set(code, []).get(code)!).push(p.id);
    }
  }
  if (byCode.size === 0) return new Set();
  try {
    const codes = [...byCode.keys()];
    const values = await redis.mget<(unknown)[]>(...codes.map((c) => LOOKUP_CACHE_PREFIX + c));
    const out = new Set<string>();
    values.forEach((v, i) => {
      let x: { status?: string } | null = null;
      try { x = typeof v === 'string' ? JSON.parse(v) : (v as { status?: string } | null); } catch { /* 壊れた値は無視 */ }
      if (x?.status === 'unavailable') for (const id of byCode.get(codes[i]) ?? []) out.add(id);
    });
    return out;
  } catch {
    return new Set();
  }
}

export async function loadOshiShoppingGeneralPart(use: OshiShoppingUse, budget: OshiShoppingBudget): Promise<OshiShoppingGeneralPart> {
  const entries = getGeneralItemEntries();
  const forUse = entries.filter((e) => e.use === use);
  if (forUse.length === 0) {
    return { generalItems: selectGeneralItems([], new Map(), use, budget), notConfigured: entries.length === 0, failed: 0 };
  }
  const { items, failed } = await lookupGeneralItems(forUse.map((e) => e.itemCode));
  return { generalItems: selectGeneralItems(forUse, items, use, budget), notConfigured: false, failed };
}
