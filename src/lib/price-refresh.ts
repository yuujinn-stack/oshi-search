// 価格更新専用モード：保存済みの楽天商品の価格・画像・商品情報を、楽天APIだけで更新する。
//
// - OpenAI API は一切使わない。このモジュールは AI 判定（src/lib/ai-judge.ts）・判定の保存（judgment-store）を
//   import しないため、呼び出し経路そのものが存在しない（OpenAI の設定が無い環境でも動く）。
// - 関連判定（verdicts）・掲載状態は変更しない。
// - 既存に無い商品は追加しない（新規商品の発見と AI 判定は src/lib/batch-processor.ts の別処理）。
// - 変更する DB の項目は products の items 内の price・priceFetchedAt・reviewCount・reviewAverage と、
//   (A) で価格を更新したカテゴリ行の fetched_at（カテゴリを再検索した日時）だけ。
// - 楽天APIの呼び出し間隔・同時実行は共通の制御（src/lib/rakuten-api-gate.ts）に従う。
//
// 更新の方法は2つ：
//   (A) カテゴリ検索（refreshPersonPrices）… 人物のカテゴリを従来どおり検索し、結果に含まれた既存商品
//       （楽天の同一性キーが一致したもの）の価格の項目（price・priceFetchedAt・reviewCount・reviewAverage）だけを更新。
//       商品名・画像・URL・アフィリエイトURL・ID・並び・件数は変えない（手動登録の商品も同じ）。
//       保存は既存行の UPDATE だけ（INSERT しない）。
//   (B) コード指定（lookupPricesByCode）… 楽天ブックスの商品番号（book:<番号>）または楽天市場APIの itemCode を
//       保存している商品を1件ずつ楽天市場商品検索APIで取得し、返ってきた itemCode が一致したときだけ価格の項目を更新。
//       (A) で検索結果に出ない商品も正確に更新できる。商品ページのURLだけでは楽天市場の itemCode が分からないため、
//       itemCode を保存していない楽天市場の商品（旧ID・手動登録の一部）は (A) でのみ更新する（推測しない）。
// どちらも、楽天の店舗コード・商品コード（楽天ブックスは商品番号）が既存と異なる場合は更新しない。
// 楽天APIのエラー・429・タイムアウト・0件・在庫切れで取得できない商品は変更しない（価格・取得日時とも）。
import { getProductsByCategory } from '@/lib/rakuten';
import {
  CATEGORIES,
  applyPriceUpdates,
  getAllStoredProducts,
  getStoredCategoryRow,
  mergePriceFieldsOnly,
  productIdentityKey,
  savePriceOnlyItems,
  type PriceUpdate,
} from '@/lib/product-store';
import {
  RakutenApiBusyError,
  RakutenApiCooldownError,
  RakutenApiLeaseLostError,
  RakutenApiUnavailableError,
  currentRakutenApiSession,
  rakutenApiFetch,
  withRakutenApiSession,
} from '@/lib/rakuten-api-gate';
import type { RakutenItem } from '@/types/rakuten';
import type { PersonWithConfig, ProductCategory } from '@/types/person';

export type PriceRefreshStatus =
  | 'updated'          // 保存した（今回取得できた既存商品の価格等を更新）
  | 'no_existing'      // 保存済みの商品が無いカテゴリ（追加しないので何もしない）
  | 'no_results'       // 楽天の検索結果が0件（既存はそのまま）
  | 'fetch_failed'     // 楽天APIのエラー・429・タイムアウト（既存はそのまま）
  | 'config_missing'   // 楽天APIの認証情報なし
  | 'db_error';        // 保存に失敗（既存はそのまま）

export interface PriceRefreshCategoryResult {
  category: ProductCategory;
  status: PriceRefreshStatus;
  httpStatus?: number;
  /** 今回の検索結果に含まれ、価格等を更新した既存商品の数 */
  updated: number;
  /** 今回の検索結果に含まれず、変更しなかった既存商品の数 */
  notReturned: number;
  /** 既存に無いため追加しなかった商品の数（新規商品の発見処理で扱う） */
  newCandidates: number;
  /** IDやURLは一致したが楽天の商品コードが違うため更新しなかった数 */
  identityMismatches: number;
}

export interface PriceRefreshResult {
  personName: string;
  categories: PriceRefreshCategoryResult[];
  updated: number;
  newCandidates: number;
  identityMismatches: number;
  fetchFailed: number;
  /** 期限（deadline）に達して処理しなかったカテゴリ（次回この続きから） */
  remaining: ProductCategory[];
  /** 楽天APIの認証情報が無い */
  configMissing: boolean;
}

const empty = (category: ProductCategory, status: PriceRefreshStatus, httpStatus?: number): PriceRefreshCategoryResult =>
  ({ category, status, httpStatus, updated: 0, notReturned: 0, newCandidates: 0, identityMismatches: 0 });

/**
 * (A) カテゴリ検索による価格更新。deadline（epoch ms）を過ぎたら次のカテゴリに進まず、残りを remaining で返す。
 */
export async function refreshPersonPrices(
  person: Pick<PersonWithConfig, 'name' | 'group' | 'config'>,
  categories: readonly ProductCategory[] = CATEGORIES,
  opts: {
    deadline?: number;
    now?: () => number;
    /** 保存済み商品の読み取り結果（カテゴリに商品があるかの判定だけに使う。省略時は読み取る） */
    stored?: Partial<Record<ProductCategory, { products: RakutenItem[] }>>;
  } = {},
): Promise<PriceRefreshResult> {
  const now = opts.now ?? (() => Date.now());
  const stored = opts.stored ?? await getAllStoredProducts(person.name);
  const results: PriceRefreshCategoryResult[] = [];
  const remaining: ProductCategory[] = [];
  let configMissing = false;

  for (const [i, category] of categories.entries()) {
    if (opts.deadline && now() >= opts.deadline) {
      remaining.push(...categories.slice(i));
      break;
    }
    if ((stored[category]?.products.length ?? 0) === 0) {
      results.push(empty(category, 'no_existing'));
      continue;
    }
    // 1カテゴリ分の検索（複数ページ・複数キーワード）は、楽天APIの共通の使用権（src/lib/rakuten-api-gate.ts：
    // 1.1秒以上の間隔・429 が続いたら全経路で停止）の中で行う。rakuten.ts はこの使用権をそのまま使う
    const res = await withRakutenApiSession(
      { label: `price-search:${category}`, maxWaitMs: 60_000, onUnavailable: 'local' },
      () => getProductsByCategory(person.name, person.group, category, person.config, 'no-store'),
    );
    if (res.status === 'config_missing') {
      results.push(empty(category, 'config_missing'));
      configMissing = true;
      break; // 全カテゴリ同じ結果になる
    }
    if (res.status === 'upstream_error') { results.push(empty(category, 'fetch_failed', res.httpStatus)); continue; }
    if (res.status === 'error' || res.status === 'no_data') { results.push(empty(category, 'fetch_failed')); continue; }
    if (res.status === 'empty') { results.push(empty(category, 'no_results')); continue; }

    try {
      // 保存直前の最新の行に対して、価格の項目だけを反映（並び・件数・ID・商品名・URL・アフィリエイトURL等は不変）
      const fetchedAt = now();
      const row = await getStoredCategoryRow(person.name, category);
      if (!row || row.items.length === 0) { results.push(empty(category, 'no_existing')); continue; }
      const merged = mergePriceFieldsOnly(row.items, res.products, fetchedAt);
      if (merged.updated > 0) await savePriceOnlyItems(person.name, category, merged.items, fetchedAt);
      results.push({
        category,
        status: 'updated',
        updated: merged.updated,
        notReturned: merged.notReturned + merged.unidentifiable,
        newCandidates: merged.newCandidates,
        identityMismatches: merged.identityMismatches,
      });
    } catch (err) {
      console.error(`[price-refresh] 保存失敗 ${person.name}/${category}: ${err instanceof Error ? err.message : String(err)}`);
      results.push(empty(category, 'db_error'));
    }
  }

  const sum = (k: 'updated' | 'newCandidates' | 'identityMismatches') => results.reduce((n, r) => n + r[k], 0);
  return {
    personName: person.name,
    categories: results,
    updated: sum('updated'),
    newCandidates: sum('newCandidates'),
    identityMismatches: sum('identityMismatches'),
    fetchFailed: results.filter((r) => r.status === 'fetch_failed').length,
    remaining,
    configMissing,
  };
}

// ── (B) コード指定 ──────────────────────────────────────────────────────────────

const ICHIBA_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
// 楽天市場APIの itemCode（店舗コード:数字の商品ID）。商品ページURLの商品コード（管理番号）とは別物
const API_ITEM_CODE_RE = /^[a-z0-9][a-z0-9_-]*:\d+$/i;

/** コード指定で取得できる商品なら、楽天市場商品検索APIに渡す itemCode を返す（分からなければ null。推測しない） */
export function lookupCodeOf(item: Pick<RakutenItem, 'itemUrl' | 'affiliateUrl' | 'itemCode'>): string | null {
  const key = productIdentityKey(item);
  if (key.startsWith('books:')) return `book:${key.slice('books:'.length)}`;
  const code = (item.itemCode ?? '').trim().toLowerCase();
  if (API_ITEM_CODE_RE.test(code) && key === `ichiba:${code.replace(':', '/')}`) return code;
  // 商品ページから同一性キーが取れない場合でも、楽天市場APIの itemCode があればそれで照合する
  if (API_ITEM_CODE_RE.test(code) && !key) return code;
  return null;
}

interface IchibaApiItem { itemCode?: string; itemPrice?: number; reviewCount?: number; reviewAverage?: number }

export interface LookupCandidate {
  category: ProductCategory;
  item: RakutenItem;
  code: string;
}

/**
 * 更新の候補を選ぶ：コード指定で取得できる商品のうち、priceFetchedAt が freshMs 以内でないもの。
 * 取得日時が不明な商品を最優先、その後は古い順（日時は推測で補わない）。onlyIds を渡すとその商品だけ。
 */
export function selectLookupCandidates(
  stored: Partial<Record<ProductCategory, { products: RakutenItem[] }>>,
  opts: { nowMs: number; freshMs: number; limit: number; onlyIds?: ReadonlySet<string> },
): LookupCandidate[] {
  const list: LookupCandidate[] = [];
  for (const category of CATEGORIES) {
    for (const item of stored[category]?.products ?? []) {
      if (opts.onlyIds && !opts.onlyIds.has(item.id)) continue;
      if (item.priceFetchedAt && opts.nowMs - item.priceFetchedAt < opts.freshMs) continue;
      const code = lookupCodeOf(item);
      if (code) list.push({ category, item, code });
    }
  }
  list.sort((a, b) => (a.item.priceFetchedAt ?? 0) - (b.item.priceFetchedAt ?? 0));
  return list.slice(0, opts.limit);
}

/**
 * コード指定の取得結果の共有キャッシュ（同じ商品が複数の人物に保存されているため。例：グループのCDは全メンバーに保存）。
 * 値は楽天APIから実際に取得した価格と取得日時。期限内に同じコードが出たら API を呼ばずにその値（取得日時もそのまま）を使う。
 */
export interface CachedLookup { itemCode: string; price: number; fetchedAt: number; reviewCount?: number; reviewAverage?: number }
export interface LookupCache {
  getMany(codes: readonly string[]): Promise<Map<string, CachedLookup>>;
  setMany(entries: readonly CachedLookup[]): Promise<void>;
}

export interface LookupResult {
  /** 楽天APIを呼んだ件数 */
  attempted: number;
  /** 共有キャッシュから使った件数（楽天APIは呼んでいない） */
  fromCache: number;
  applied: number;
  notFound: number;
  mismatched: number;
  failed: number;
  stoppedBy: 'done' | 'deadline' | 'rate_limited' | 'gate' | 'config_missing';
}

const GATE_ERRORS = [RakutenApiBusyError, RakutenApiCooldownError, RakutenApiLeaseLostError, RakutenApiUnavailableError];

/**
 * (B) コード指定で価格を取得して反映する。1件ずつ・共通の呼び出し制御の1つの使用権でまとめて行う。
 * 429 を受けたら再試行せず全経路共通の停止を記録して終了。
 */
export async function lookupPricesByCode(
  personName: string,
  candidates: readonly LookupCandidate[],
  opts: { deadline?: number; now?: () => number; cache?: LookupCache; cacheMaxAgeMs?: number } = {},
): Promise<LookupResult> {
  const now = opts.now ?? (() => Date.now());
  const result: LookupResult = { attempted: 0, fromCache: 0, applied: 0, notFound: 0, mismatched: 0, failed: 0, stoppedBy: 'done' };
  if (candidates.length === 0) return result;

  const updatesByCategory = new Map<ProductCategory, Map<string, PriceUpdate>>();
  const addUpdate = (c: LookupCandidate, v: CachedLookup) => {
    const map = updatesByCategory.get(c.category) ?? new Map<string, PriceUpdate>();
    map.set(c.item.id, {
      identityKey: productIdentityKey(c.item),
      price: v.price,
      priceFetchedAt: v.fetchedAt,
      reviewCount: v.reviewCount,
      reviewAverage: v.reviewAverage,
    });
    updatesByCategory.set(c.category, map);
  };

  // 共有キャッシュ（期限内・同じ itemCode・その商品の既存の取得日時より新しいものだけ使う）
  let pending: LookupCandidate[] = [...candidates];
  if (opts.cache) {
    try {
      const cached = await opts.cache.getMany([...new Set(pending.map((c) => c.code))]);
      const maxAge = opts.cacheMaxAgeMs ?? 3 * 24 * 60 * 60 * 1000;
      pending = pending.filter((c) => {
        const v = cached.get(c.code);
        if (!v || v.itemCode !== c.code || !(v.price > 0) || now() - v.fetchedAt > maxAge) return true;
        if (c.item.priceFetchedAt && c.item.priceFetchedAt >= v.fetchedAt) { result.fromCache++; return false; }
        addUpdate(c, v);
        result.fromCache++;
        return false;
      });
    } catch {
      // キャッシュが使えなくても楽天APIで続行
    }
  }
  const fetchedNow: CachedLookup[] = [];
  const doneByCode = new Map<string, CachedLookup | null>();
  const appId = (process.env.RAKUTEN_APP_ID ?? '').trim();
  const accessKey = (process.env.RAKUTEN_ACCESS_KEY ?? '').trim();
  if (!appId || !accessKey) return { ...result, stoppedBy: 'config_missing' };
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim() || 'https://oshi-search.jp';

  if (pending.length > 0) await withRakutenApiSession({ label: 'price-lookup', maxWaitMs: 60_000, onUnavailable: 'local' }, async () => {
    for (const c of pending) {
      // 同じ実行内で同じコードを取得済みなら API を呼ばない（同じ人物の複数カテゴリなど）
      if (doneByCode.has(c.code)) { const v = doneByCode.get(c.code); if (v) addUpdate(c, v); result.fromCache++; continue; }
      if (opts.deadline && now() >= opts.deadline) { result.stoppedBy = 'deadline'; break; }
      result.attempted++;
      const params = new URLSearchParams({ applicationId: appId, accessKey, itemCode: c.code, hits: '1' });
      let res: Response;
      try {
        res = await rakutenApiFetch(`${ICHIBA_ENDPOINT}?${params}`, { cache: 'no-store', headers: { Origin: origin, accessKey } },
          { label: 'price-lookup', maxWaitMs: 60_000, onUnavailable: 'local' });
      } catch (err) {
        if (GATE_ERRORS.some((E) => err instanceof E)) { result.stoppedBy = err instanceof RakutenApiCooldownError ? 'rate_limited' : 'gate'; result.failed++; break; }
        result.failed++;
        continue; // ネットワーク障害・タイムアウト：この商品は変更しない
      }
      if (res.status === 429) {
        await currentRakutenApiSession()?.reportRateLimited(res);
        result.failed++;
        result.stoppedBy = 'rate_limited';
        break;
      }
      if (!res.ok) { result.failed++; continue; }
      const data = (await res.json()) as { Items?: { Item: IchibaApiItem }[] };
      const it = data.Items?.[0]?.Item;
      if (!it) { result.notFound++; doneByCode.set(c.code, null); continue; } // 販売終了・在庫切れ等：変更しない
      if ((it.itemCode ?? '').toLowerCase() !== c.code || !(Number(it.itemPrice) > 0)) { result.mismatched++; doneByCode.set(c.code, null); continue; }
      const v: CachedLookup = {
        itemCode: c.code,
        price: Number(it.itemPrice),
        fetchedAt: Date.now(),
        reviewCount: typeof it.reviewCount === 'number' ? it.reviewCount : undefined,
        reviewAverage: typeof it.reviewAverage === 'number' ? it.reviewAverage : undefined,
      };
      doneByCode.set(c.code, v);
      fetchedNow.push(v);
      addUpdate(c, v);
    }
  });
  if (opts.cache && fetchedNow.length > 0) {
    try { await opts.cache.setMany(fetchedNow); } catch { /* 共有できなくても反映は続ける */ }
  }

  for (const [category, updates] of updatesByCategory) {
    try {
      const r = await applyPriceUpdates(personName, category, updates);
      result.applied += r.applied;
    } catch (err) {
      console.error(`[price-refresh] コード指定の保存失敗 ${personName}/${category}: ${err instanceof Error ? err.message : String(err)}`);
      result.failed += updates.size;
    }
  }
  return result;
}
