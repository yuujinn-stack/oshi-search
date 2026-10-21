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
import { CATEGORIES, getAllStoredProducts, listPersonsWithProducts, productIdentityKey as productIdentityKeyOf } from '@/lib/product-store';
import {
  lookupCodeOf,
  lookupPricesByCode,
  refreshPersonPrices,
  selectLookupCandidates,
  type CachedLookup,
  type LookupCache,
  type LookupResult,
} from '@/lib/price-refresh';
import type { PersonWithConfig, ProductCategory } from '@/types/person';

export const STATE_KEY = 'price-refresh:state';
export const LOCK_KEY = 'price-refresh:runner-lock';
export const LOOKUP_CACHE_PREFIX = 'price-lookup:';
/** 自動停止の印（価格以外の変更を検知したら記録。手動で消すまで実行しない） */
export const HALT_KEY = 'price-refresh:halt';
/** 直近の実行の要約（管理画面 /admin/price-refresh の表示用） */
export const LAST_RUN_KEY = 'price-refresh:last-run';
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
  lookup?: Pick<LookupResult, 'attempted' | 'fromCache' | 'applied' | 'notFound' | 'mismatched' | 'failed' | 'stoppedBy'>;
  completed: boolean;
  /** 価格以外の変更を検知して自動停止した */
  halted?: boolean;
  /** 楽天のエラー（429、または 503 等の連続）でこの人物の途中でその回を終えた */
  stop?: StopDetail;
}

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
}

export interface HaltInfo { at: number; person: string; reasons: string[] }

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

export function createMemoryStateStore(initial: Record<string, PersonRefreshState> = {}): RefreshStateStore & { states: Record<string, PersonRefreshState>; readonly halt: HaltInfo | null; readonly lastRun: LastRunInfo | null } {
  const states = { ...initial };
  let lock: string | null = null;
  let halt: HaltInfo | null = null;
  let lastRun: LastRunInfo | null = null;
  return {
    states,
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
  persons: { name: string; categories: number; updated: number; lookup?: LookupResult; completed: boolean; failedCategories: FailedCategory[] }[];
  updated: number;
  lookedUp: number;
  lookupApplied: number;
  stoppedBy: 'budget' | 'max_persons' | 'all_done' | 'rate_limited' | 'upstream_errors' | 'config_missing' | 'locked' | 'no_state_store' | 'halted';
  /** 自動停止したとき（または停止中だったとき）の内容 */
  halt?: HaltInfo;
  /** 楽天のエラー（429、または 503 等の連続）でその回を終えたときの原因と位置 */
  stopDetail?: StopDetail;
}

async function relatedIdsFromDb(personName: string): Promise<Set<string>> {
  const rows = (await neonSql`SELECT product_id FROM verdicts WHERE person_name = ${personName} AND verdict = 'related'`) as { product_id: string }[];
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
      });
    } catch { /* 表示用の要約が保存できなくても価格更新の結果は変わらない */ }
  }
  return summary;
}

function lookupBrief(l: LookupResult): PersonLastResult['lookup'] {
  return { attempted: l.attempted, fromCache: l.fromCache, applied: l.applied, notFound: l.notFound, mismatched: l.mismatched, failed: l.failed, stoppedBy: l.stoppedBy };
}

async function runBatch(opts: RunOptions, storeOrNull: RefreshStateStore | null): Promise<RunSummary> {
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
    const order = orderPersons([...byName.keys()].filter((n) => !only || only.has(n)), states)
      .filter((n) => only || !(states[n]?.completedAt && (!states[n].startedAt || states[n].completedAt! >= states[n].startedAt!) && now() - states[n].completedAt! < minInterval));
    const lookupFreshMs = opts.lookupFreshMs ?? 3 * DAY_MS;
    const lookupCache = opts.lookupCache === undefined ? createRedisLookupCache(lookupFreshMs) : opts.lookupCache;
    const relatedIdsOf = opts.relatedIdsOf ?? relatedIdsFromDb;
    const fingerprintOf = opts.fingerprintOf ?? fingerprintFromDb;

    const maxFailures = Math.max(1, opts.maxConsecutiveFailures ?? MAX_CONSECUTIVE_FAILURES);
    // 楽天のエラーの連続回数（人物をまたいで数える。取得できたカテゴリ・商品があれば 0 に戻す）
    let failureStreak = 0;
    const recentFailures: string[] = [];
    for (const name of order) {
      if (now() >= deadline) { base.stoppedBy = 'budget'; break; }
      if (opts.maxPersons && base.persons.length >= opts.maxPersons) { base.stoppedBy = 'max_persons'; break; }
      const person = byName.get(name)!;
      const prev = states[name] ?? {};
      // 処理前の「価格以外」の指紋（処理後と比べ、価格以外が変わっていたら自動停止）
      const before = await fingerprintOf(name);
      const resumeFrom = prev.startedAt && (!prev.completedAt || prev.startedAt > prev.completedAt) ? prev.nextCategory ?? 0 : 0;
      let cur: PersonRefreshState = { ...prev, startedAt: now(), nextCategory: resumeFrom };
      await store.set(name, cur);
      const failedCategories: FailedCategory[] = [];

      // (A) カテゴリ検索（前回の続きから。カテゴリを1つ終えるごとに進み具合を保存）
      let categoriesDone = 0;
      let updated = 0;
      let rateLimited = false;
      let errorStopped = false;
      let stopDetail: StopDetail | undefined;
      // 保存済み商品は人物ごとに1回だけ読む（カテゴリに商品があるかの判定用。保存時は各カテゴリの最新の行を読み直す）
      const snapshot = resumeFrom < CATEGORIES.length ? await getAllStoredProducts(name) : undefined;
      for (let i = resumeFrom; i < CATEGORIES.length; i++) {
        if (now() >= deadline) break;
        const r = await refreshPersonPrices(person, [CATEGORIES[i] as ProductCategory], { deadline, now, stored: snapshot });
        if (r.configMissing) return { ...base, status: 'config_missing', stoppedBy: 'config_missing' };
        if (r.remaining.length > 0) break;
        updated += r.updated;
        categoriesDone++;
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
      if (finishedCategories && !rateLimited && !errorStopped && now() < deadline && (opts.lookupPerPerson ?? 0) > 0) {
        const stored = await getAllStoredProducts(name);
        const candidates = selectLookupCandidates(stored, {
          nowMs: now(), freshMs: lookupFreshMs, limit: opts.lookupPerPerson!, onlyIds: await relatedIdsOf(name),
        });
        lookup = await lookupPricesByCode(name, candidates, { deadline, now, cache: lookupCache ?? undefined, cacheMaxAgeMs: lookupFreshMs, maxConsecutiveFailures: maxFailures });
        base.lookedUp += lookup.attempted;
        base.lookupApplied += lookup.applied;
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
        await store.set(name, { ...cur, last: { at: now(), updated, categories: categoriesDone, failedCategories, lookup: lookup && lookupBrief(lookup), completed: false, halted: true } });
        base.persons.push({ name, categories: categoriesDone, updated, lookup, completed: false, failedCategories });
        return { ...base, status: 'halted', stoppedBy: 'halted', halt };
      }
      const lookupFinished = !lookup || lookup.stoppedBy === 'done';
      const completed = finishedCategories && lookupFinished && !rateLimited && !errorStopped;
      const last: PersonLastResult = { at: now(), updated, categories: categoriesDone, failedCategories, lookup: lookup && lookupBrief(lookup), completed, ...(stopDetail && { stop: stopDetail }) };
      if (completed) await store.set(name, { completedAt: now(), startedAt: prev.startedAt, nextCategory: 0, last });
      else await store.set(name, { ...cur, last });
      base.persons.push({ name, categories: categoriesDone, updated, lookup, completed, failedCategories });
      base.updated += updated;
      if (rateLimited) { base.stoppedBy = 'rate_limited'; base.stopDetail = stopDetail; break; }
      // 楽天のエラー（503 等）が続いた：その回を終える（続きは次回。失敗したカテゴリから取り直す）
      if (errorStopped) { base.stoppedBy = 'upstream_errors'; base.stopDetail = stopDetail; break; }
      // 時間の枠を使い切って人物の途中で止まった（続きは次回）
      if (!completed && now() >= deadline) { base.stoppedBy = 'budget'; break; }
    }
    return base;
  } finally {
    await store.releaseLock(owner);
  }
}

// ── dry-run（読み取りのみ。楽天API・DB・Redis への書き込みは一切しない）──────────────────

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
} = {}): Promise<PlanSummary> {
  const now = opts.now ?? (() => Date.now());
  const persons = opts.persons ?? (await getAllPersonsMerged());
  const withProducts = new Set(opts.persons ? persons.map((p) => p.name) : await listPersonsWithProducts());
  const only = opts.onlyPersons?.length ? new Set(opts.onlyPersons) : null;
  const names = persons.map((p) => p.name).filter((n) => withProducts.has(n) && (!only || only.has(n)));
  const relatedIdsOf = opts.relatedIdsOf ?? relatedIdsFromDb;
  const out: PlanPerson[] = [];
  const allCodes = new Set<string>();
  for (const name of names) {
    const stored = await getAllStoredProducts(name);
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
