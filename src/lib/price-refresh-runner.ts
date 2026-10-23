// 価格の分割自動更新（価格更新専用モードを、1回の実行時間の枠内で少しずつ進める）。
//
// - OpenAI API は一切使わない（src/lib/price-refresh.ts と同じく AI 判定・判定の保存を import しない）。
//   関連判定は「公開中（related）の商品を優先する」ための読み取りにだけ使う（verdicts を直接 SELECT。書き込みなし）。
// - 1回の実行で、期限（budgetMs）まで人物を順番に処理する。人物ごとに
//     (A) カテゴリ検索で価格を更新（前回の続きのカテゴリから）
//     (B) コード指定で、取得日時が不明・古い公開中の商品の価格を更新（1人あたり最大 lookupPerPerson 件）
// - 進み具合は Redis（既存の Upstash。ジョブの補助データ）に人物ごとに保存し、途中で止まっても次回は続きから。
//   順番：途中で止まった人物 → まだ一度も完了していない人物 → 完了が古い人物。
// - 同時に2つ動かないよう、実行ロック（Redis SET NX、期限つき）を取る。楽天APIの間隔は共通の制御（rakuten-api-gate.ts）。
// - 新規商品の検索・AI判定（src/lib/batch-processor.ts の processPerson / 既存の自動更新 Cron）とは別の処理。
import { neonSql } from '@/db/client';
import { getAllPersonsMerged } from '@/lib/persons';
import { getRedis } from '@/lib/redis';
import { CATEGORIES, listPersonsWithProducts, productIdentityKey as productIdentityKeyOf, type PriceReview } from '@/lib/product-store';
import {
  lookupCodeOf,
  lookupPricesByCode,
  refreshPersonPrices,
  selectLookupCandidates,
  type CachedLookup,
  type LookupCache,
  type LookupResult,
} from '@/lib/price-refresh';
import type { CategorySummary } from '@/lib/price-refresh';
import { countDbRead, snapshotIo } from '@/lib/price-refresh-io';
import { rakutenApiCallCount } from '@/lib/rakuten-api-gate';
import type { RakutenItem } from '@/types/rakuten';
import type { PersonWithConfig, ProductCategory } from '@/types/person';

export const STATE_KEY = 'price-refresh:state';
export const LOCK_KEY = 'price-refresh:runner-lock';
export const LOOKUP_CACHE_PREFIX = 'price-lookup:';
/** 自動停止の印（価格以外の変更を検知したら記録。手動で消すまで実行しない） */
export const HALT_KEY = 'price-refresh:halt';
/** 直近の実行の要約（管理画面 /admin/price-refresh の表示用） */
export const LAST_RUN_KEY = 'price-refresh:last-run';
/**
 * 価格の確認待ちの受け取り箱（Redis のハッシュ。項目＝人物・カテゴリ・商品ID・変更前の価格・取得した価格の組）。
 * 管理画面が DB（price_reviews）に取り込んだら消す（src/lib/price-review-store.ts）。人物の直近の結果は次の処理で上書きされるため、
 * 確認待ちが管理画面に取り込まれる前に消えないようにここにも残す。
 */
export const REVIEW_INBOX_KEY = 'price-refresh:review-inbox';
/** 受け取り箱の項目数の上限（1項目は約300バイト。これ以上は追加せず、追加できなかった数を REVIEW_INBOX_DROPPED_KEY に数える） */
export const MAX_REVIEW_INBOX = 20000;
/**
 * 受け取り箱が満杯で追加できなかった確認待ちの数（累計。管理画面に警告を出す）。追加できなかった確認待ちも、
 * 保存済みの商品は変えていないため、次にその人物を処理したときに再び見つかる（人物の直近の結果にも最大50件残る）。
 */
export const REVIEW_INBOX_DROPPED_KEY = 'price-refresh:review-inbox-dropped';
/** 1人の1回の処理で受け取り箱に入れる確認待ちの上限 */
const MAX_INBOX_PER_PERSON = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 楽天のエラー（503 等・通信エラー・保存失敗）がこの回数続いたら、その回を終える（429 は1回で終える。コード指定の取得にも渡す） */
export const MAX_CONSECUTIVE_FAILURES = 3;

export interface PersonRefreshState {
  /** 最後に (A)(B) を最後まで終えた日時 */
  completedAt?: number;
  /** 処理を始めた日時（completedAt より新しければ途中で止まっている） */
  startedAt?: number;
  /** 次に処理するカテゴリの位置（CATEGORIES の添字。途中再開用） */
  nextCategory?: number;
  /** 直近の処理結果（管理画面の表示用。取得できなかったカテゴリ・商品は保存済みのデータを変更していない） */
  last?: PersonLastResult;
}

export interface FailedCategory {
  category: string;
  /** fetch_failed（楽天から取得できなかった：429・503・ネットワーク等）／db_error（保存に失敗） */
  status: string;
  httpStatus?: number;
}

export interface PersonLastResult {
  at: number;
  /** カテゴリ検索で価格の項目を更新した商品数 */
  updated: number;
  /** 今回処理したカテゴリ数 */
  categories: number;
  failedCategories: FailedCategory[];
  lookup?: Pick<LookupResult, 'attempted' | 'fromCache' | 'applied' | 'notFound' | 'mismatched' | 'failed' | 'unavailable' | 'stoppedBy'>;
  completed: boolean;
  /** 価格以外の変更を検知して自動停止した */
  halted?: boolean;
  /** 楽天のエラー（429、または 503 等の連続）でこの人物の途中でその回を終えた */
  stop?: StopDetail;
  /** 前回の価格から30%以上の変動などで反映せず確認対象にした商品（最大 MAX_REVIEWS_PER_PERSON 件。保存済みの商品は変更していない） */
  priceReviews?: TimedPriceReview[];
  /** 判定が related でないため更新しなかった商品の数 */
  notEligible?: number;
  /** この人物の処理で使った量 */
  usage?: RunUsage;
}

/** カテゴリの処理の順（進み具合 nextCategory の添字。dry-run の表示用） */
export const CATEGORIES_ORDER: readonly string[] = CATEGORIES;

/** 1カテゴリの検索で使う楽天APIの回数の上限の目安（検索語・ページ数による。API 回数の上限の判定に使う） */
export const MAX_CALLS_PER_CATEGORY = 12;

/** 実行で使った量（楽天APIの呼び出し回数・DB から読んだ行数と量の目安） */
export interface RunUsage { apiCalls: number; dbRowsRead: number; dbBytesRead: number }

/** 人物ごとに記録する確認対象の上限（Redis の容量を抑えるため） */
export const MAX_REVIEWS_PER_PERSON = 50;

/** 楽天のエラーでその回を終えたときの原因と位置 */
export interface StopDetail {
  /** 止まった人物 */
  person: string;
  /** 止まったカテゴリ（コード指定の取得で止まった場合は「コード指定」） */
  category: string;
  /** 原因（例：「本・雑誌: 503」「コード指定: 通信エラー」） */
  reasons: string[];
}

export interface LastRunInfo {
  startedAt: number;
  finishedAt: number;
  /** 人物を指定した手動テストか */
  manualTest: boolean;
  status: RunSummary['status'];
  stoppedBy: RunSummary['stoppedBy'];
  persons: number;
  completed: number;
  updated: number;
  lookedUp: number;
  lookupApplied: number;
  /** 取得できなかったカテゴリの延べ数 */
  failedCategories: number;
  /** 楽天のエラーでその回を終えた場合の原因と位置 */
  stopDetail?: StopDetail;
  /** 確認対象にした商品の数（全人物） */
  priceReviews?: number;
  /** この実行で使った量 */
  usage?: RunUsage;
}

/** 進み具合の保存先（本番は Redis。テスト・ローカルはメモリ） */
export interface RefreshStateStore {
  getAll(): Promise<Record<string, PersonRefreshState>>;
  set(personName: string, state: PersonRefreshState): Promise<void>;
  acquireLock(owner: string, ttlMs: number): Promise<boolean>;
  releaseLock(owner: string): Promise<void>;
  /** 自動停止の印（無ければ null） */
  getHalt(): Promise<HaltInfo | null>;
  setHalt(info: HaltInfo): Promise<void>;
  /** 直近の実行の要約（管理画面の表示用。無くても動く） */
  setLastRun?(info: LastRunInfo): Promise<void>;
  /** 価格の確認待ちを受け取り箱に追加（管理画面が DB に取り込む。無くても動く） */
  addReviews?(personName: string, reviews: readonly TimedPriceReview[]): Promise<void>;
}

export interface HaltInfo { at: number; person: string; reasons: string[] }

/** 確認待ち（楽天から価格を取得した日時つき） */
export type TimedPriceReview = PriceReview & { fetchedAt?: number };

/** 受け取り箱の項目のキー（同じ組は上書きされる） */
export function reviewInboxField(person: string, r: Pick<PriceReview, 'category' | 'id' | 'previousPrice' | 'fetchedPrice'>): string {
  return JSON.stringify([person, r.category ?? '', r.id, r.previousPrice, r.fetchedPrice]);
}

export function createRedisStateStore(): RefreshStateStore | null {
  const redis = getRedis();
  if (!redis) return null;
  return {
    async getAll() {
      const raw = (await redis.hgetall<Record<string, unknown>>(STATE_KEY)) ?? {};
      const out: Record<string, PersonRefreshState> = {};
      for (const [k, v] of Object.entries(raw)) {
        try { out[k] = typeof v === 'string' ? JSON.parse(v) : (v as PersonRefreshState); } catch { /* 壊れた値は無視 */ }
      }
      return out;
    },
    async set(personName, state) { await redis.hset(STATE_KEY, { [personName]: JSON.stringify(state) }); },
    async acquireLock(owner, ttlMs) { return (await redis.set(LOCK_KEY, owner, { nx: true, px: ttlMs })) === 'OK'; },
    async releaseLock(owner) {
      // 自分のロックだけ外す
      await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", [LOCK_KEY], [owner]);
    },
    async getHalt() {
      const v = await redis.get<HaltInfo | string>(HALT_KEY);
      if (!v) return null;
      try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return { at: 0, person: '', reasons: ['不明'] }; }
    },
    async setHalt(info) { await redis.set(HALT_KEY, JSON.stringify(info)); }, // 期限なし（手動で消すまで）
    async setLastRun(info) { await redis.set(LAST_RUN_KEY, JSON.stringify(info)); },
    async addReviews(personName, reviews) {
      const list = reviews.filter((r) => r.category).slice(0, MAX_INBOX_PER_PERSON);
      if (list.length === 0) return;
      // 既にある項目（同じ組）は上書きなので数を増やさない。新しい項目は空きの分だけ追加し、入らなかった数を数える
      const keys = list.map((r) => reviewInboxField(personName, r));
      const [count, present] = await Promise.all([redis.hlen(REVIEW_INBOX_KEY), redis.hmget<Record<string, unknown>>(REVIEW_INBOX_KEY, ...keys)]);
      let room = Math.max(0, MAX_REVIEW_INBOX - count);
      const fields: Record<string, string> = {};
      let dropped = 0;
      list.forEach((r, i) => {
        const exists = present?.[keys[i]] != null;
        if (!exists && room <= 0) { dropped++; return; }
        if (!exists) room--;
        fields[keys[i]] = JSON.stringify({ person: personName, ...r });
      });
      if (Object.keys(fields).length) await redis.hset(REVIEW_INBOX_KEY, fields);
      if (dropped) await redis.incrby(REVIEW_INBOX_DROPPED_KEY, dropped);
    },
  };
}

/** コード指定の取得結果の共有キャッシュ（Redis。読み取りは MGET 1回、書き込みは取得した件数ぶん。期限つき） */
export function createRedisLookupCache(ttlMs: number): LookupCache | null {
  const redis = getRedis();
  if (!redis) return null;
  return {
    async getMany(codes) {
      const out = new Map<string, CachedLookup>();
      if (codes.length === 0) return out;
      const values = await redis.mget<(CachedLookup | string | null)[]>(...codes.map((c) => LOOKUP_CACHE_PREFIX + c));
      values.forEach((v, i) => {
        if (!v) return;
        try { out.set(codes[i], typeof v === 'string' ? JSON.parse(v) : v); } catch { /* 壊れた値は無視 */ }
      });
      return out;
    },
    async setMany(entries) {
      if (entries.length === 0) return;
      const pipe = redis.pipeline();
      for (const e of entries) pipe.set(LOOKUP_CACHE_PREFIX + e.itemCode, JSON.stringify(e), { px: ttlMs });
      await pipe.exec();
    },
  };
}

export function createMemoryStateStore(initial: Record<string, PersonRefreshState> = {}): RefreshStateStore & { states: Record<string, PersonRefreshState>; reviewInbox: Record<string, TimedPriceReview & { person: string }>; readonly halt: HaltInfo | null; readonly lastRun: LastRunInfo | null } {
  const states = { ...initial };
  let lock: string | null = null;
  let halt: HaltInfo | null = null;
  let lastRun: LastRunInfo | null = null;
  const reviewInbox: Record<string, TimedPriceReview & { person: string }> = {};
  return {
    states,
    reviewInbox,
    async addReviews(p, rs) { for (const r of rs) if (r.category) reviewInbox[reviewInboxField(p, r)] = { person: p, ...r }; },
    get halt() { return halt; },
    get lastRun() { return lastRun; },
    async setLastRun(info) { lastRun = structuredClone(info); },
    async getHalt() { return halt; },
    async setHalt(info) { halt = info; },
    async getAll() { return structuredClone(states); },
    async set(p, s) { states[p] = structuredClone(s); },
    async acquireLock(owner) { if (lock) return false; lock = owner; return true; },
    async releaseLock(owner) { if (lock === owner) lock = null; },
  };
}

/**
 * その回に処理する人物と順番（純粋関数。実行と dry-run の予定表示で同じものを使う）。
 * 途中で止まった人物 → 未完了 → 完了が古い順。最後に完了してから minIntervalMs 未満の人物は除く（only を指定したら除かない）。
 */
export function selectRunOrder(
  names: readonly string[],
  states: Record<string, PersonRefreshState>,
  nowMs: number,
  minIntervalMs: number,
  only?: ReadonlySet<string> | null,
): string[] {
  return orderPersons(names.filter((n) => !only || only.has(n)), states)
    .filter((n) => only || !(states[n]?.completedAt && (!states[n].startedAt || states[n].completedAt! >= states[n].startedAt!) && nowMs - states[n].completedAt! < minIntervalMs));
}

/** 処理する順番：途中で止まった人物 → 未完了 → 完了が古い順 */
export function orderPersons(names: readonly string[], states: Record<string, PersonRefreshState>): string[] {
  const rank = (n: string) => {
    const s = states[n];
    if (s?.startedAt && (!s.completedAt || s.startedAt > s.completedAt)) return [0, s.startedAt] as const;
    if (!s?.completedAt) return [1, 0] as const;
    return [2, s.completedAt] as const;
  };
  return [...names].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || a.localeCompare(b, 'ja');
  });
}

export interface RunOptions {
  /** 1回の実行で新しい作業を始めてよい時間（これを過ぎたら次の作業に進まない） */
  budgetMs: number;
  /** 1回で処理する人物の上限 */
  maxPersons?: number;
  /** 1人あたりのコード指定の取得件数の上限 */
  lookupPerPerson?: number;
  /** この期間内に価格を取得した商品はコード指定の対象にしない */
  lookupFreshMs?: number;
  /** 同じ人物を再処理するまでの最短間隔（完了してからこの時間はスキップ） */
  minIntervalMs?: number;
  /** 楽天のエラーがこの回数続いたらその回を終える（既定 MAX_CONSECUTIVE_FAILURES） */
  maxConsecutiveFailures?: number;
  /** 1回の実行で使う楽天APIの回数の上限（次のカテゴリで上限を超えうるなら始めない。続きは次回） */
  maxApiCalls?: number;
  /** 1回の実行で楽天を検索するカテゴリ数の上限（続きは次回） */
  maxCategories?: number;
  store?: RefreshStateStore;
  now?: () => number;
  /** 手動テスト用：この人物だけ処理する（名前の完全一致。再処理の間隔は無視） */
  onlyPersons?: readonly string[];
  /** コード指定の取得結果の共有キャッシュ（省略時は Redis） */
  lookupCache?: LookupCache | null;
  /** テスト用 */
  persons?: PersonWithConfig[];
  relatedIdsOf?: (personName: string) => Promise<Set<string>>;
  /** 価格以外の変更の検知に使う指紋（テスト用。省略時は DB で計算） */
  fingerprintOf?: (personName: string) => Promise<PersonFingerprint>;
  /** カテゴリごとの商品数・対象数（テスト用。省略時は DB 側で数える） */
  categorySummaryOf?: (personName: string) => Promise<CategorySummary>;
  /** コード指定の候補になりうる商品（テスト用。省略時は DB 側で絞って読む） */
  lookupItemsOf?: (personName: string, cutoffMs: number, limit: number) => Promise<Partial<Record<ProductCategory, { products: RakutenItem[] }>>>;
}

/**
 * カテゴリごとの商品数と、そのうち判定が related の数（DB 側で数える。商品の中身は読まない）。
 * 人物の全商品を読む代わりに使う（カテゴリに商品・対象があるかの判定用）。
 */
export async function categorySummaryFromDb(personName: string): Promise<CategorySummary> {
  const rows = (await neonSql`
    SELECT p.category, jsonb_array_length(p.items)::int AS items,
      (SELECT count(*)::int FROM jsonb_array_elements(p.items) e
        JOIN verdicts v ON v.person_name = p.person_name AND v.product_id = e->>'id' AND v.verdict = 'related') AS eligible
    FROM products p WHERE p.person_name = ${personName}`) as { category: ProductCategory; items: number; eligible: number }[];
  countDbRead(0, rows);
  return Object.fromEntries(rows.map((r) => [r.category, { items: r.items, eligible: r.eligible }])) as CategorySummary;
}

// コード指定の候補の並び（従来の selectLookupCandidates と同じ：取得日時の古い順〔不明は最初〕→ カテゴリの順 → 保存の順）
const CATEGORY_ORDER_SQL = `ARRAY[${CATEGORIES.map((c) => `'${c.replace(/'/g, "''")}'`).join(',')}]::text[]`;

/**
 * コード指定の候補になりうる商品だけを DB で絞って読む：判定が related、取得日時が無い・cutoffMs 以前、
 * 楽天ブックスの URL または楽天市場の数字の itemCode を持つ商品を、従来の候補の順で limit 件まで。
 * 最終的な候補は selectLookupCandidates（lookupCodeOf の判定）で決めるため、ここは広めに絞る（足りなければ続きを読む）。
 */
export async function lookupItemsFromDb(personName: string, cutoffMs: number, limit: number): Promise<Partial<Record<ProductCategory, { products: RakutenItem[] }>>> {
  const out: Partial<Record<ProductCategory, { products: RakutenItem[] }>> = {};
  if (limit <= 0) return out;
  const page = Math.max(limit * 2, 50);
  const text = `
    SELECT p.category, t.e AS item
    FROM products p CROSS JOIN LATERAL jsonb_array_elements(p.items) WITH ORDINALITY AS t(e, i)
    JOIN verdicts v ON v.person_name = p.person_name AND v.product_id = t.e->>'id' AND v.verdict = 'related'
    WHERE p.person_name = $1
      AND CASE WHEN jsonb_typeof(t.e->'priceFetchedAt') = 'number' THEN (t.e->>'priceFetchedAt')::numeric <= $2 ELSE true END
      -- 楽天ブックス（books.rakuten.co.jp/rb/番号、または楽天市場の店舗 book：item.rakuten.co.jp/book/番号。アフィリエイトURLの中でエンコードされていても含む）
      -- または楽天市場の数字の itemCode。最終的な判定は lookupCodeOf で行うので、ここは広めに絞る
      AND (coalesce(t.e->>'itemUrl', '') ILIKE '%books.rakuten.co.jp%' OR coalesce(t.e->>'affiliateUrl', '') ILIKE '%books.rakuten.co.jp%'
           OR coalesce(t.e->>'itemUrl', '') ILIKE '%item.rakuten.co.jp%book%' OR coalesce(t.e->>'affiliateUrl', '') ILIKE '%item.rakuten.co.jp%book%'
           OR lower(coalesce(t.e->>'itemCode', '')) ~ '^[a-z0-9][a-z0-9_-]*:[0-9]+$')
    ORDER BY CASE WHEN jsonb_typeof(t.e->'priceFetchedAt') = 'number' THEN (t.e->>'priceFetchedAt')::numeric ELSE 0 END,
      array_position(${CATEGORY_ORDER_SQL}, p.category), t.i
    LIMIT $3 OFFSET $4`;
  let offset = 0;
  let found = 0;
  for (;;) {
    const rows = (await neonSql.query(text, [personName, cutoffMs, page, offset])) as { category: ProductCategory; item: RakutenItem }[];
    countDbRead(0, rows);
    for (const r of rows) {
      (out[r.category] ??= { products: [] }).products.push(r.item);
      if (lookupCodeOf(r.item)) found++;
    }
    if (found >= limit || rows.length < page) break;
    offset += page;
  }
  return out;
}

/**
 * 人物の「価格以外」の指紋。商品はカテゴリごとに件数と、価格の項目（price・priceFetchedAt）を
 * 除いた各商品の内容を並び順どおりにつないだハッシュ。判定（verdicts）は全項目のハッシュ。DB 側で計算し、転送量はごくわずか。
 */
export interface PersonFingerprint {
  products: Record<string, { count: number; hash: string }>;
  verdicts: { count: number; hash: string };
}

export async function fingerprintFromDb(personName: string): Promise<PersonFingerprint> {
  const prows = (await neonSql`
    SELECT p.category, count(t.e)::int AS n,
      md5(coalesce(string_agg((t.e - ARRAY['price','priceFetchedAt'])::text, '|' ORDER BY t.i), '')) AS h
    FROM products p LEFT JOIN LATERAL jsonb_array_elements(p.items) WITH ORDINALITY AS t(e, i) ON true
    WHERE p.person_name = ${personName}
    GROUP BY p.category`) as { category: string; n: number; h: string }[];
  const [v] = (await neonSql`
    SELECT count(*)::int AS n,
      md5(coalesce(string_agg(product_id || ':' || verdict || ':' || score::text || ':' || source || ':' || coalesce(reason, '') || ':' || coalesce(prompt_version, ''), '|' ORDER BY product_id), '')) AS h
    FROM verdicts WHERE person_name = ${personName}`) as { n: number; h: string }[];
  return {
    products: Object.fromEntries(prows.map((r) => [r.category, { count: r.n, hash: r.h }])),
    verdicts: { count: v?.n ?? 0, hash: v?.h ?? '' },
  };
}

/** 指紋の差（価格以外の変更）。空なら変更なし */
export function fingerprintDiff(a: PersonFingerprint, b: PersonFingerprint): string[] {
  const out: string[] = [];
  if (a.verdicts.count !== b.verdicts.count || a.verdicts.hash !== b.verdicts.hash) out.push('判定（verdicts）が変わった');
  const cats = new Set([...Object.keys(a.products), ...Object.keys(b.products)]);
  for (const c of cats) {
    const x = a.products[c], y = b.products[c];
    if (!x || !y) { out.push(`${c}: カテゴリ行の有無が変わった`); continue; }
    if (x.count !== y.count) out.push(`${c}: 商品件数が変わった（${x.count}→${y.count}）`);
    else if (x.hash !== y.hash) out.push(`${c}: 価格以外の項目または並びが変わった`);
  }
  return out;
}

export interface RunSummary {
  status: 'ok' | 'locked' | 'no_state_store' | 'config_missing' | 'halted';
  persons: { name: string; categories: number; updated: number; lookup?: LookupResult; completed: boolean; failedCategories: FailedCategory[]; priceReviews: PriceReview[]; usage?: RunUsage }[];
  updated: number;
  lookedUp: number;
  lookupApplied: number;
  stoppedBy: 'budget' | 'max_persons' | 'max_api_calls' | 'max_categories' | 'all_done' | 'rate_limited' | 'upstream_errors' | 'config_missing' | 'locked' | 'no_state_store' | 'halted';
  /** この実行で使った量 */
  usage?: RunUsage;
  /** 自動停止したとき（または停止中だったとき）の内容 */
  halt?: HaltInfo;
  /** 楽天のエラー（429、または 503 等の連続）でその回を終えたときの原因と位置 */
  stopDetail?: StopDetail;
}

async function relatedIdsFromDb(personName: string): Promise<Set<string>> {
  const rows = (await neonSql`SELECT product_id FROM verdicts WHERE person_name = ${personName} AND verdict = 'related'`) as { product_id: string }[];
  countDbRead(0, rows);
  return new Set(rows.map((r) => r.product_id));
}

export async function runPriceRefreshBatch(opts: RunOptions): Promise<RunSummary> {
  const now = opts.now ?? (() => Date.now());
  const store = opts.store ?? createRedisStateStore();
  const startedAt = now();
  const summary = await runBatch({ ...opts, store: store ?? undefined }, store);
  // 実際に処理した実行だけ要約を残す（ロック中・停止中で何もしなかった回は残さない）
  const ran = store && summary.status !== 'locked' && summary.status !== 'no_state_store' && !(summary.status === 'halted' && summary.persons.length === 0);
  if (ran) {
    try {
      await store.setLastRun?.({
        startedAt, finishedAt: now(), manualTest: !!opts.onlyPersons?.length,
        status: summary.status, stoppedBy: summary.stoppedBy,
        persons: summary.persons.length, completed: summary.persons.filter((p) => p.completed).length,
        updated: summary.updated, lookedUp: summary.lookedUp, lookupApplied: summary.lookupApplied,
        failedCategories: summary.persons.reduce((n, p) => n + p.failedCategories.length, 0),
        stopDetail: summary.stopDetail,
        priceReviews: summary.persons.reduce((n, p) => n + p.priceReviews.length, 0),
        usage: summary.usage,
      });
    } catch { /* 表示用の要約が保存できなくても価格更新の結果は変わらない */ }
  }
  return summary;
}

function lookupBrief(l: LookupResult): PersonLastResult['lookup'] {
  return { attempted: l.attempted, fromCache: l.fromCache, applied: l.applied, notFound: l.notFound, mismatched: l.mismatched, failed: l.failed, unavailable: l.unavailable ?? 0, stoppedBy: l.stoppedBy };
}

/** 実行・人物の処理で使った量（開始時との差） */
function usageSince(start: { calls: number; io: { dbRowsRead: number; dbBytesRead: number } }): RunUsage {
  const io = snapshotIo();
  return { apiCalls: rakutenApiCallCount() - start.calls, dbRowsRead: io.dbRowsRead - start.io.dbRowsRead, dbBytesRead: io.dbBytesRead - start.io.dbBytesRead };
}
const usageStart = () => ({ calls: rakutenApiCallCount(), io: snapshotIo() });

async function runBatch(opts: RunOptions, storeOrNull: RefreshStateStore | null): Promise<RunSummary> {
  const run = usageStart();
  const summary = await runBatchInner(opts, storeOrNull, run);
  return { ...summary, usage: usageSince(run) };
}

async function runBatchInner(opts: RunOptions, storeOrNull: RefreshStateStore | null, run: ReturnType<typeof usageStart>): Promise<RunSummary> {
  const now = opts.now ?? (() => Date.now());
  const store = storeOrNull;
  const base: RunSummary = { status: 'ok', persons: [], updated: 0, lookedUp: 0, lookupApplied: 0, stoppedBy: 'all_done' };
  if (!store) return { ...base, status: 'no_state_store', stoppedBy: 'no_state_store' };

  const startedAt = now();
  const deadline = startedAt + opts.budgetMs;
  const owner = `price-refresh:${startedAt}:${Math.random().toString(36).slice(2)}`;
  // ロックは実行の枠＋最長のカテゴリ1件分の余裕。落ちても期限切れで次回は取得できる
  // 自動停止の印があれば何もしない（手動で原因を確認し、印を消してから再開）
  const existingHalt = await store.getHalt();
  if (existingHalt) return { ...base, status: 'halted', stoppedBy: 'halted', halt: existingHalt };
  if (!(await store.acquireLock(owner, opts.budgetMs + 5 * 60_000))) return { ...base, status: 'locked', stoppedBy: 'locked' };

  try {
    const persons = opts.persons ?? (await getAllPersonsMerged());
    const withProducts = new Set(opts.persons ? persons.map((p) => p.name) : await listPersonsWithProducts());
    const byName = new Map(persons.filter((p) => withProducts.has(p.name)).map((p) => [p.name, p]));
    const states = await store.getAll();
    const minInterval = opts.minIntervalMs ?? DAY_MS;
    const only = opts.onlyPersons?.length ? new Set(opts.onlyPersons) : null;
    const order = selectRunOrder([...byName.keys()], states, now(), minInterval, only);
    const lookupFreshMs = opts.lookupFreshMs ?? 3 * DAY_MS;
    const lookupCache = opts.lookupCache === undefined ? createRedisLookupCache(lookupFreshMs) : opts.lookupCache;
    const relatedIdsOf = opts.relatedIdsOf ?? relatedIdsFromDb;
    const fingerprintOf = opts.fingerprintOf ?? fingerprintFromDb;
    const categorySummaryOf = opts.categorySummaryOf ?? categorySummaryFromDb;
    const lookupItemsOf = opts.lookupItemsOf ?? lookupItemsFromDb;
    // 1回の実行の上限（楽天APIの回数・カテゴリ数）。超えそうなら次の作業を始めず、続きは次回（進み具合は保存済み）
    const callsUsed = () => rakutenApiCallCount() - run.calls;
    let categoriesSearched = 0;
    let limitStop: 'max_api_calls' | 'max_categories' | undefined;
    const limitReached = (): typeof limitStop => {
      if (opts.maxApiCalls && callsUsed() + MAX_CALLS_PER_CATEGORY > opts.maxApiCalls) return 'max_api_calls';
      if (opts.maxCategories && categoriesSearched >= opts.maxCategories) return 'max_categories';
      return undefined;
    };

    const maxFailures = Math.max(1, opts.maxConsecutiveFailures ?? MAX_CONSECUTIVE_FAILURES);
    // 楽天のエラーの連続回数（人物をまたいで数える。取得できたカテゴリ・商品があれば 0 に戻す）
    let failureStreak = 0;
    const recentFailures: string[] = [];
    for (const name of order) {
      if (now() >= deadline) { base.stoppedBy = 'budget'; break; }
      if (opts.maxPersons && base.persons.length >= opts.maxPersons) { base.stoppedBy = 'max_persons'; break; }
      if ((limitStop = limitReached())) { base.stoppedBy = limitStop; break; }
      const person = byName.get(name)!;
      const prev = states[name] ?? {};
      const personStart = usageStart();
      // 処理前の「価格以外」の指紋（処理後と比べ、価格以外が変わっていたら自動停止）
      const before = await fingerprintOf(name);
      const resumeFrom = prev.startedAt && (!prev.completedAt || prev.startedAt > prev.completedAt) ? prev.nextCategory ?? 0 : 0;
      let cur: PersonRefreshState = { ...prev, startedAt: now(), nextCategory: resumeFrom };
      await store.set(name, cur);
      const failedCategories: FailedCategory[] = [];
      // 更新の対象は判定が related の商品だけ（判定・表示設定は読むだけで変えない）
      const relatedIds = await relatedIdsOf(name);
      const priceReviews: TimedPriceReview[] = [];
      // 確認待ちに楽天から価格を取得した日時を付ける（承認時に priceFetchedAt にする）
      const timed = (rs?: readonly PriceReview[]) => (rs ?? []).map((x) => ({ ...x, fetchedAt: now() }));
      // 確認待ちを受け取り箱にも残す（失敗しても価格更新は続ける。人物の直近の結果にも残っている）
      const keepReviews = async () => {
        if (priceReviews.length && store.addReviews) await store.addReviews(name, priceReviews).catch(() => {});
      };
      let notEligible = 0;

      // (A) カテゴリ検索（前回の続きから。カテゴリを1つ終えるごとに進み具合を保存）
      let categoriesDone = 0;
      let updated = 0;
      let rateLimited = false;
      let errorStopped = false;
      let stopDetail: StopDetail | undefined;
      // カテゴリごとの商品数・対象数だけを DB 側で数える（人物の全商品は読まない。保存時は各カテゴリの最新の行を読み直す）
      const summary = resumeFrom < CATEGORIES.length ? await categorySummaryOf(name) : undefined;
      for (let i = resumeFrom; i < CATEGORIES.length; i++) {
        if (now() >= deadline) break;
        const sc = summary?.[CATEGORIES[i] as ProductCategory];
        const willSearch = (sc?.items ?? 0) > 0 && (sc?.eligible ?? 0) > 0;
        // 楽天を検索するカテゴリだけ、上限を確認してから始める（超えそうなら続きは次回）
        if (willSearch && (limitStop = limitReached())) break;
        const r = await refreshPersonPrices(person, [CATEGORIES[i] as ProductCategory], { deadline, now, summary: summary ?? {}, eligibleIds: relatedIds });
        if (willSearch) categoriesSearched++;
        if (r.configMissing) return { ...base, status: 'config_missing', stoppedBy: 'config_missing' };
        if (r.remaining.length > 0) break;
        updated += r.updated;
        categoriesDone++;
        priceReviews.push(...timed(r.reviews));
        notEligible += r.categories.reduce((n, c) => n + (c.notEligible ?? 0), 0);
        let categoryFailed = false;
        for (const c of r.categories) {
          if (c.status !== 'fetch_failed' && c.status !== 'db_error') continue;
          failedCategories.push({ category: c.category, status: c.status, httpStatus: c.httpStatus });
          recentFailures.push(`${c.category}: ${c.status === 'db_error' ? '保存失敗' : c.httpStatus ?? '通信エラー'}`);
          categoryFailed = true;
        }
        if (r.categories.some((c) => c.httpStatus === 429)) rateLimited = true;
        if (categoryFailed) failureStreak++;
        else if (r.categories.some((c) => c.status === 'updated' || c.status === 'no_results')) { failureStreak = 0; recentFailures.length = 0; }
        errorStopped = !rateLimited && failureStreak >= maxFailures;
        const stopping = rateLimited || errorStopped;
        // その回を終える場合、失敗したカテゴリは次回もう一度取得する（進み具合を進めない。保存済みの商品は変更していない）
        cur = { ...prev, startedAt: now(), nextCategory: stopping && categoryFailed ? i : i + 1 };
        await store.set(name, cur);
        if (stopping) {
          stopDetail = { person: name, category: CATEGORIES[i], reasons: rateLimited ? [`${CATEGORIES[i]}: 429`] : recentFailures.slice(-maxFailures) };
          break;
        }
      }
      const finishedCategories = resumeFrom + categoriesDone >= CATEGORIES.length;

      // (B) コード指定（取得日時が不明・古い公開中の商品。カテゴリ検索を最後まで終えた人物だけ）
      let lookup: LookupResult | undefined;
      let lookupTruncated = false;
      if (finishedCategories && !limitStop && !rateLimited && !errorStopped && now() < deadline && (opts.lookupPerPerson ?? 0) > 0) {
        // 候補になりうる商品だけを DB で絞って読む（人物の全商品は読まない）
        const nowMs = now();
        const stored = await lookupItemsOf(name, nowMs - lookupFreshMs, opts.lookupPerPerson!);
        const all = selectLookupCandidates(stored, {
          nowMs, freshMs: lookupFreshMs, limit: opts.lookupPerPerson!, onlyIds: relatedIds,
        });
        // 楽天APIの回数の上限の残りの分だけ（1件につき最大1回）。残りは次回
        const remainingCalls = opts.maxApiCalls ? Math.max(0, opts.maxApiCalls - callsUsed()) : all.length;
        const candidates = all.slice(0, remainingCalls);
        lookupTruncated = candidates.length < all.length;
        if (lookupTruncated) limitStop = 'max_api_calls';
        lookup = await lookupPricesByCode(name, candidates, { deadline, now, cache: lookupCache ?? undefined, cacheMaxAgeMs: lookupFreshMs, maxConsecutiveFailures: maxFailures });
        base.lookedUp += lookup.attempted;
        base.lookupApplied += lookup.applied;
        priceReviews.push(...timed(lookup.reviews));
        if (lookup.attempted > lookup.failed) { failureStreak = 0; recentFailures.length = 0; }
        if (lookup.stoppedBy === 'rate_limited') {
          rateLimited = true;
          stopDetail = { person: name, category: 'コード指定', reasons: ['コード指定: 429'] };
        }
        if (lookup.stoppedBy === 'upstream_errors') {
          errorStopped = true;
          stopDetail = { person: name, category: 'コード指定', reasons: (lookup.errors ?? []).map((e) => `コード指定: ${e}`) };
        }
      }
      // 処理後の確認：価格以外（判定・商品件数・ID・商品名・URL・アフィリエイトURL・並び等）が変わっていたら自動停止
      const diff = fingerprintDiff(before, await fingerprintOf(name));
      if (diff.length > 0) {
        const halt: HaltInfo = { at: now(), person: name, reasons: diff };
        await store.setHalt(halt);
        const usage = usageSince(personStart);
        await keepReviews();
        await store.set(name, { ...cur, last: { at: now(), updated, categories: categoriesDone, failedCategories, lookup: lookup && lookupBrief(lookup), completed: false, halted: true, priceReviews: priceReviews.slice(0, MAX_REVIEWS_PER_PERSON), notEligible, usage } });
        base.persons.push({ name, categories: categoriesDone, updated, lookup, completed: false, failedCategories, priceReviews, usage });
        return { ...base, status: 'halted', stoppedBy: 'halted', halt };
      }
      // 上限でカテゴリ検索の途中・コード指定の前で止めた場合も未完了（次回は続きから）
      const lookupSkippedByLimit = finishedCategories && !lookup && !!limitStop && (opts.lookupPerPerson ?? 0) > 0;
      const lookupFinished = (!lookup && !lookupSkippedByLimit) || (!!lookup && lookup.stoppedBy === 'done' && !lookupTruncated);
      const completed = finishedCategories && lookupFinished && !rateLimited && !errorStopped;
      const usage = usageSince(personStart);
      const last: PersonLastResult = {
        at: now(), updated, categories: categoriesDone, failedCategories, lookup: lookup && lookupBrief(lookup), completed,
        ...(stopDetail && { stop: stopDetail }), priceReviews: priceReviews.slice(0, MAX_REVIEWS_PER_PERSON), notEligible, usage,
      };
      await keepReviews();
      if (completed) await store.set(name, { completedAt: now(), startedAt: prev.startedAt, nextCategory: 0, last });
      else await store.set(name, { ...cur, last });
      base.persons.push({ name, categories: categoriesDone, updated, lookup, completed, failedCategories, priceReviews, usage });
      base.updated += updated;
      if (rateLimited) { base.stoppedBy = 'rate_limited'; base.stopDetail = stopDetail; break; }
      // 楽天のエラー（503 等）が続いた：その回を終える（続きは次回。失敗したカテゴリから取り直す）
      if (errorStopped) { base.stoppedBy = 'upstream_errors'; base.stopDetail = stopDetail; break; }
      // 1回の上限（楽天APIの回数・カテゴリ数）に達した（続きは次回）
      if (limitStop) { base.stoppedBy = limitStop; break; }
      // 時間の枠を使い切って人物の途中で止まった（続きは次回）
      if (!completed && now() >= deadline) { base.stoppedBy = 'budget'; break; }
    }
    return base;
  } finally {
    await store.releaseLock(owner);
  }
}

// ── dry-run（読み取りのみ。楽天API・DB・Redis への書き込みは一切しない）──────────────────

/**
 * 見積もり用に、商品の ID・商品ページURL・アフィリエイトURL・楽天市場の itemCode・価格の取得日時だけを読む
 * （同一性キー・コード指定の判定に必要な項目。全項目を読むより転送量が少ない）。
 */
export async function lightItemsFromDb(personName: string): Promise<Partial<Record<ProductCategory, { products: RakutenItem[] }>>> {
  const rows = (await neonSql`
    SELECT p.category,
      coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', t.e->'id', 'itemUrl', t.e->'itemUrl', 'affiliateUrl', t.e->'affiliateUrl', 'itemCode', t.e->'itemCode', 'priceFetchedAt', t.e->'priceFetchedAt'
      )) ORDER BY t.i) FILTER (WHERE t.e IS NOT NULL), '[]'::jsonb) AS items
    FROM products p LEFT JOIN LATERAL jsonb_array_elements(p.items) WITH ORDINALITY AS t(e, i) ON true
    WHERE p.person_name = ${personName}
    GROUP BY p.person_name, p.category`) as { category: ProductCategory; items: RakutenItem[] }[];
  countDbRead(rows.length, rows);
  return Object.fromEntries(rows.map((r) => [r.category, { products: r.items }])) as Partial<Record<ProductCategory, { products: RakutenItem[] }>>;
}

export interface PlanPerson {
  name: string;
  /** 商品が保存されているカテゴリ（カテゴリ検索の対象） */
  categories: number;
  /** カテゴリ検索の推定 API 回数（1カテゴリ3〜12回。人物名・別名・グループで検索語が増える） */
  searchCallsMin: number;
  searchCallsMax: number;
  /** 保存済み商品（カテゴリ検索で価格が更新されうる） */
  storedItems: number;
  /** 手動登録の商品（同じ商品と確認できたときだけ価格の項目を更新） */
  manualItems: number;
  /** コード指定の候補（公開中・取得日時が不明または古い。1人の上限まで） */
  lookupCandidates: number;
  /** その候補の異なるコードの数（同じ実行内の重複は1回） */
  lookupUniqueCodes: number;
  /** カテゴリ検索でしか更新できない公開中の商品 */
  searchOnlyRelated: number;
  /** 更新できない公開中の商品（同一性キーなし） */
  unidentifiableRelated: number;
}

export interface PlanSummary {
  persons: PlanPerson[];
  totals: Omit<PlanPerson, 'name'> & { persons: number; lookupUniqueCodesAll: number };
  /** DB の更新対象（カテゴリ行の数。価格更新では products テーブルの items と fetched_at だけ） */
  dbRowsToUpdate: number;
  note: string;
}

export async function planPriceRefresh(opts: {
  onlyPersons?: readonly string[];
  lookupPerPerson?: number;
  lookupFreshMs?: number;
  now?: () => number;
  persons?: PersonWithConfig[];
  relatedIdsOf?: (personName: string) => Promise<Set<string>>;
  /** 見積もりに使う商品の軽い項目（テスト用。省略時は DB から ID・URL・商品コード・取得日時だけを読む） */
  lightItemsOf?: (personName: string) => Promise<Partial<Record<ProductCategory, { products: RakutenItem[] }>>>;
} = {}): Promise<PlanSummary> {
  const now = opts.now ?? (() => Date.now());
  const persons = opts.persons ?? (await getAllPersonsMerged());
  const withProducts = new Set(opts.persons ? persons.map((p) => p.name) : await listPersonsWithProducts());
  const only = opts.onlyPersons?.length ? new Set(opts.onlyPersons) : null;
  const names = persons.map((p) => p.name).filter((n) => withProducts.has(n) && (!only || only.has(n)));
  const relatedIdsOf = opts.relatedIdsOf ?? relatedIdsFromDb;
  const lightItemsOf = opts.lightItemsOf ?? lightItemsFromDb;
  const out: PlanPerson[] = [];
  const allCodes = new Set<string>();
  for (const name of names) {
    // 見積もりに必要な項目だけを読む（商品名・画像・説明などは読まない）
    const stored = await lightItemsOf(name);
    const related = await relatedIdsOf(name);
    const cats = CATEGORIES.filter((c) => (stored[c]?.products.length ?? 0) > 0);
    const items = cats.flatMap((c) => stored[c]!.products);
    const candidates = selectLookupCandidates(stored, { nowMs: now(), freshMs: opts.lookupFreshMs ?? 3 * DAY_MS, limit: opts.lookupPerPerson ?? 60, onlyIds: related });
    const codes = new Set(candidates.map((c) => c.code));
    codes.forEach((c) => allCodes.add(c));
    const relatedItems = items.filter((p) => related.has(p.id));
    out.push({
      name,
      categories: cats.length,
      searchCallsMin: cats.length * 3,
      searchCallsMax: cats.length * 12,
      storedItems: items.length,
      manualItems: items.filter((p) => p.id.startsWith('mn-')).length,
      lookupCandidates: candidates.length,
      lookupUniqueCodes: codes.size,
      searchOnlyRelated: relatedItems.filter((p) => !lookupCodeOf(p) && productIdentityKeyOf(p)).length,
      unidentifiableRelated: relatedItems.filter((p) => !lookupCodeOf(p) && !productIdentityKeyOf(p)).length,
    });
  }
  const sum = (k: keyof Omit<PlanPerson, 'name'>) => out.reduce((n, p) => n + p[k], 0);
  return {
    persons: out,
    totals: {
      persons: out.length, categories: sum('categories'), searchCallsMin: sum('searchCallsMin'), searchCallsMax: sum('searchCallsMax'),
      storedItems: sum('storedItems'), manualItems: sum('manualItems'), lookupCandidates: sum('lookupCandidates'),
      lookupUniqueCodes: sum('lookupUniqueCodes'), lookupUniqueCodesAll: allCodes.size,
      searchOnlyRelated: sum('searchOnlyRelated'), unidentifiableRelated: sum('unidentifiableRelated'),
    },
    dbRowsToUpdate: sum('categories'),
    note: '推定値。コード指定の実際の API 回数は、共有キャッシュ（同じ商品を別の人物で取得済み）とカテゴリ検索での更新の分だけ少なくなる',
  };
}
