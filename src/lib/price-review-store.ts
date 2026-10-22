// 価格の確認待ち（前回の価格から30%以上の変動などで自動更新しなかった商品）の保存・承認・却下（管理画面 /admin/price-refresh）。
//
// 流れ：
//   1. 価格更新（GitHub Actions・price_refresher）は確認待ちを Redis の受け取り箱（REVIEW_INBOX_KEY）と人物ごとの直近の結果に書く
//      （price_refresher には新しいテーブルの権限を付けない）。
//   2. 管理画面の「取り込む」（POST）と、承認・却下（POST）のときに syncPriceReviewsFromRedis() が Redis の確認待ちを
//      DB（price_reviews）に取り込む（正本は DB）。画面の表示（GET）は読み取りだけ（DB・Redis に書かない）。
//      取り込んだ受け取り箱の項目は、読んだ値のままの場合だけ消す（取り込み中に価格更新が書いた新しい値は残す）。
//      DB に入った確認待ちは、承認・却下・新しい変更案が出るまで残る。
//   3. 承認：1つのトランザクション（Serializable）で、確認待ちの状態の更新・商品の price と priceFetchedAt の更新・履歴の追加を行う。
//      承認直前に DB 側で「同じIDの商品が1件だけある・保存済みの価格が変更前の価格のまま・商品ページURL等が検出時と同じ・
//      判定が related」を確認し、どれかが違えば何も更新しない（stale にして確認待ちから外す）。
//   4. 却下：保存済みの商品は変えず、状態と履歴だけ。同じ組（変更前の価格・取得した価格）は再表示しない。
//      取得した価格が変わるなど別の変更案になれば、新しい確認待ちとして表示する。
//
// 商品の更新は items の該当商品の price・priceFetchedAt の2項目だけ（jsonb_set）。商品名・URL・アフィリエイトURL・画像・
// 判定・表示設定・並び順・カテゴリ行の fetched_at は変えない。
import { neonSql } from '@/db/client';
import { getRedis } from '@/lib/redis';
import { CATEGORIES, type PriceReview } from '@/lib/product-store';
import { MAX_REVIEW_INBOX, REVIEW_INBOX_DROPPED_KEY, REVIEW_INBOX_KEY, STATE_KEY, type PersonRefreshState } from '@/lib/price-refresh-runner';

export type PriceReviewStatus = 'pending' | 'approved' | 'rejected' | 'superseded' | 'stale';
export type PriceReviewAction = 'approve' | 'reject';

/** 取得からこの日数以上経った価格の変更案は承認できない（14日ちょうども不可。楽天の価格が変わっている可能性がある。却下はできる） */
export const PRICE_REVIEW_MAX_AGE_DAYS = 14;

/** 承認の期限：取得日時がこれ以前（取得から14日以上）なら承認できない */
export function priceReviewCutoffMs(nowMs: number): number {
  return nowMs - PRICE_REVIEW_MAX_AGE_DAYS * DAY_MS;
}

/** 取得から14日以上経っているか（一覧の表示・承認前の確認・承認の SQL〔fetched_at_ms > 期限〕で同じ境目を使う） */
export function isPriceReviewExpired(fetchedAtMs: number, nowMs: number): boolean {
  return fetchedAtMs <= priceReviewCutoffMs(nowMs);
}
const DAY_MS = 24 * 60 * 60 * 1000;
/** 価格の上限（integer 列・明らかな異常値の防止） */
const MAX_PRICE = 100_000_000;
export const PRICE_REVIEW_PAGE_SIZE = 30;

export interface SqlStmt { text: string; params: unknown[] }
export type Row = Record<string, unknown>;

/** DB の操作（本番は Neon、テストは隔離した DB） */
export interface ReviewDb {
  query(text: string, params?: unknown[]): Promise<Row[]>;
  /** 1つのトランザクションで順に実行する。どれかが失敗したらすべて取り消す */
  transaction(stmts: SqlStmt[], opts?: { serializable?: boolean }): Promise<Row[][]>;
}

export function neonReviewDb(): ReviewDb {
  return {
    query: (text, params = []) => neonSql.query(text, params) as Promise<Row[]>,
    transaction: (stmts, opts) => neonSql.transaction(
      stmts.map((s) => neonSql.query(s.text, s.params)),
      opts?.serializable ? { isolationLevel: 'Serializable' } : undefined,
    ) as Promise<Row[][]>,
  };
}

// ── 取り込み ───────────────────────────────────────────────────────────────────

/** 価格更新が見つけた確認待ち（Redis から） */
export interface IncomingPriceReview extends PriceReview {
  person: string;
  /** 楽天から価格を取得した日時（ms） */
  fetchedAt: number;
}

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** Redis から読んだ値を検証する（不正なものは取り込まない） */
export function parseIncomingReview(v: unknown): IncomingPriceReview | null {
  const r = v as Partial<IncomingPriceReview> | null;
  if (!r || typeof r !== 'object') return null;
  if (!isText(r.person, 200) || !isText(r.id, 300) || !(CATEGORIES as string[]).includes(r.category ?? '')) return null;
  if (!isInt(r.previousPrice, 0, MAX_PRICE) || !isInt(r.fetchedPrice, 1, MAX_PRICE)) return null;
  if (r.reason !== 'price_change_30pct' && r.reason !== 'no_previous_price') return null;
  if (!isInt(r.fetchedAt, 1, 8_640_000_000_000_000)) return null;
  const changeRate = typeof r.changeRate === 'number' && Number.isFinite(r.changeRate) ? r.changeRate : null;
  return { person: r.person, category: r.category, id: r.id, previousPrice: r.previousPrice, fetchedPrice: r.fetchedPrice, changeRate, reason: r.reason, fetchedAt: r.fetchedAt };
}

/** 商品の現在の価格（数値でなければ 0。priceChangeReview と同じく、価格が無い商品は 0 として比べる） */
const PRICE_SQL = (it: string) => `(CASE WHEN jsonb_typeof(${it}->'price') = 'number' THEN (${it}->>'price')::numeric ELSE 0 END)`;
/** 商品の同一性の確認に使う項目（検出時と承認直前で比べる） */
const IDENTITY_SQL = (it: string) => `jsonb_build_object('itemUrl', ${it}->'itemUrl', 'affiliateUrl', ${it}->'affiliateUrl', 'itemCode', ${it}->'itemCode')`;
/**
 * 確認待ち r の商品が、承認してよい状態か（DB 側で確認）：同じIDの商品がカテゴリ内に1件だけ・保存済みの価格が変更前の価格のまま・
 * 商品ページURL等が検出時と同じ・判定が related。p は products の行。
 */
const ITEM_MATCH_SQL = `
  p.person_name = r.person_name AND p.category = r.category
  AND (SELECT count(*) FROM jsonb_array_elements(p.items) e(it) WHERE e.it->>'id' = r.item_id) = 1
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.items) e(it)
              WHERE e.it->>'id' = r.item_id AND ${PRICE_SQL('e.it')} = r.previous_price AND ${IDENTITY_SQL('e.it')} = r.item_identity)
  AND EXISTS (SELECT 1 FROM verdicts v WHERE v.person_name = r.person_name AND v.product_id = r.item_id AND v.verdict = 'related')`;

/** 取り込みの文（1件につき2文）。取得日時の古い順に並べて渡す */
export function buildSyncStatements(reviews: readonly IncomingPriceReview[]): SqlStmt[] {
  const out: SqlStmt[] = [];
  for (const r of [...reviews].sort((a, b) => a.fetchedAt - b.fetchedAt)) {
    const base = [r.person, r.category, r.id, r.previousPrice, r.fetchedPrice, r.fetchedAt];
    // 同じ商品の、より古い別の変更案（確認待ち）は superseded にする
    out.push({
      text: `UPDATE price_reviews SET status = 'superseded', updated_at = now()
        WHERE person_name = $1 AND category = $2 AND item_id = $3 AND status = 'pending'
          AND NOT (previous_price = $4 AND fetched_price = $5) AND fetched_at_ms < $6`,
      params: base,
    });
    // 新しい変更案は確認待ちに。同じ組が既にあれば：却下済みはそのまま（再表示しない）、それ以外はより新しい取得のときだけ確認待ちに戻す。
    // 商品が保存されていなければ取り込まない（商品を新規追加しない）
    out.push({
      text: `INSERT INTO price_reviews (person_name, category, item_id, previous_price, fetched_price, change_rate, reason, fetched_at_ms, item_identity, item_title)
        SELECT $1::text, $2::text, $3::text, $4::int, $5::int, $7::float8, $8::text, $6::bigint, ${IDENTITY_SQL('e.it')}, left(e.it->>'title', 500)
        FROM products p, jsonb_array_elements(p.items) e(it)
        WHERE p.person_name = $1 AND p.category = $2 AND e.it->>'id' = $3
        LIMIT 1
        ON CONFLICT (person_name, category, item_id, previous_price, fetched_price) DO UPDATE SET
          status = 'pending', fetched_at_ms = EXCLUDED.fetched_at_ms, change_rate = EXCLUDED.change_rate, reason = EXCLUDED.reason,
          item_identity = EXCLUDED.item_identity, item_title = EXCLUDED.item_title, updated_at = now(),
          decided_by = NULL, decided_at = NULL
        WHERE price_reviews.status <> 'rejected' AND EXCLUDED.fetched_at_ms > price_reviews.fetched_at_ms`,
      params: [...base, r.changeRate, r.reason],
    });
  }
  return out;
}

export interface SyncResult { received: number; valid: number; synced: boolean; error?: string }

/** 確認待ちを DB に取り込む（1つのトランザクション。失敗したら何も取り込まない） */
export async function syncPriceReviews(dbx: ReviewDb, reviews: readonly IncomingPriceReview[]): Promise<void> {
  if (reviews.length === 0) return;
  await dbx.transaction(buildSyncStatements(reviews));
}

/** Redis の確認待ち（受け取り箱と、人物ごとの直近の結果）を DB に取り込み、取り込んだ受け取り箱の項目を消す */
export async function syncPriceReviewsFromRedis(dbx: ReviewDb = neonReviewDb()): Promise<SyncResult> {
  const redis = getRedis();
  if (!redis) return { received: 0, valid: 0, synced: false, error: 'redis_not_configured' };
  const [inbox, states] = await Promise.all([
    redis.hgetall<Record<string, unknown>>(REVIEW_INBOX_KEY),
    redis.hgetall<Record<string, unknown>>(STATE_KEY),
  ]);
  const parse = (v: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
  const inboxFields = Object.keys(inbox ?? {});
  const all: unknown[] = inboxFields.map((f) => parse(inbox![f]));
  // 受け取り箱を使う前の実行の結果（人物ごとの直近の結果の確認待ち）。取得日時は直近の処理の日時
  for (const [person, v] of Object.entries(states ?? {})) {
    const st = parse(v) as PersonRefreshState | null;
    for (const r of st?.last?.priceReviews ?? []) all.push({ person, fetchedAt: (r as { fetchedAt?: number }).fetchedAt ?? st!.last!.at, ...r });
  }
  const valid = all.map(parseIncomingReview).filter((r): r is IncomingPriceReview => !!r);
  await syncPriceReviews(dbx, valid);
  // DB に取り込めたら、受け取り箱の項目を「読んだ値のままなら」消す（読んだ後に価格更新が書き直した項目は次回に取り込む）
  if (inboxFields.length) {
    const args: string[] = [];
    for (const f of inboxFields) {
      const v = inbox![f];
      args.push(f, typeof v === 'string' ? v : JSON.stringify(v));
    }
    await redis.eval(
      "local n = 0 for i = 1, #ARGV, 2 do if redis.call('HGET', KEYS[1], ARGV[i]) == ARGV[i + 1] then n = n + redis.call('HDEL', KEYS[1], ARGV[i]) end end return n",
      [REVIEW_INBOX_KEY], args,
    );
  }
  return { received: all.length, valid: valid.length, synced: true };
}

export interface ReviewInboxStatus {
  /** Redis の受け取り箱にある、まだ DB に取り込んでいない確認待ちの数 */
  waiting: number;
  capacity: number;
  /** 受け取り箱が満杯で追加できなかった数（累計。次にその人物を処理したときに再び見つかる） */
  dropped: number;
}

/** 受け取り箱の状況（読み取りのみ） */
export async function getReviewInboxStatus(): Promise<ReviewInboxStatus | null> {
  const redis = getRedis();
  if (!redis) return null;
  const [waiting, dropped] = await Promise.all([redis.hlen(REVIEW_INBOX_KEY), redis.get<number | string>(REVIEW_INBOX_DROPPED_KEY)]);
  return { waiting, capacity: MAX_REVIEW_INBOX, dropped: Number(dropped ?? 0) || 0 };
}

// ── 一覧・履歴 ─────────────────────────────────────────────────────────────────

export interface PendingPriceReview {
  id: number;
  personName: string;
  category: string;
  itemId: string;
  itemTitle: string | null;
  previousPrice: number;
  fetchedPrice: number;
  changeRate: number | null;
  reason: string;
  fetchedAtMs: number;
  /** 現在 DB に保存されている価格（商品が無ければ null） */
  currentPrice: number | null;
  /** 承認できない理由（承認ボタンを押せない。null なら承認できる見込み。最終確認は承認時に DB 側で行う） */
  blocker: 'item_missing' | 'price_changed' | 'identity_changed' | 'not_related' | 'expired' | null;
}

const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export async function listPendingPriceReviews(dbx: ReviewDb, page: number, nowMs = Date.now()): Promise<{ rows: PendingPriceReview[]; total: number }> {
  const offset = Math.max(0, page - 1) * PRICE_REVIEW_PAGE_SIZE;
  const [countRows, rows] = await Promise.all([
    dbx.query(`SELECT count(*)::int AS n FROM price_reviews WHERE status = 'pending'`),
    dbx.query(`SELECT r.id, r.person_name, r.category, r.item_id, r.item_title, r.previous_price, r.fetched_price, r.change_rate, r.reason, r.fetched_at_ms,
        cur.n AS item_count, cur.price AS current_price, cur.price_json, cur.same_identity,
        EXISTS (SELECT 1 FROM verdicts v WHERE v.person_name = r.person_name AND v.product_id = r.item_id AND v.verdict = 'related') AS related
      FROM price_reviews r
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n, max(${PRICE_SQL('e.it')}) AS price, bool_and(jsonb_typeof(e.it->'price') = 'number') AS price_json,
               bool_and(${IDENTITY_SQL('e.it')} = r.item_identity) AS same_identity
        FROM products p, jsonb_array_elements(p.items) e(it)
        WHERE p.person_name = r.person_name AND p.category = r.category AND e.it->>'id' = r.item_id
      ) cur ON true
      WHERE r.status = 'pending'
      ORDER BY r.fetched_at_ms DESC, r.id DESC
      LIMIT $1 OFFSET $2`, [PRICE_REVIEW_PAGE_SIZE, offset]),
  ]);
  return {
    total: num(countRows[0]?.n ?? 0),
    rows: rows.map((r) => {
      const fetchedAtMs = num(r.fetched_at_ms);
      const itemCount = num(r.item_count ?? 0);
      const currentPrice = itemCount === 1 && r.price_json ? num(r.current_price) : itemCount === 1 ? 0 : null;
      const blocker: PendingPriceReview['blocker'] =
        itemCount !== 1 ? 'item_missing'
          : !r.same_identity ? 'identity_changed'
            : num(r.current_price) !== num(r.previous_price) ? 'price_changed'
              : !r.related ? 'not_related'
                : isPriceReviewExpired(fetchedAtMs, nowMs) ? 'expired'
                  : null;
      return {
        id: num(r.id), personName: String(r.person_name), category: String(r.category), itemId: String(r.item_id),
        itemTitle: r.item_title == null ? null : String(r.item_title),
        previousPrice: num(r.previous_price), fetchedPrice: num(r.fetched_price), changeRate: numOrNull(r.change_rate),
        reason: String(r.reason), fetchedAtMs, currentPrice, blocker,
      };
    }),
  };
}

export interface PriceReviewLog {
  id: number;
  reviewId: number;
  personName: string;
  category: string;
  itemId: string;
  itemTitle: string | null;
  previousPrice: number;
  fetchedPrice: number;
  action: 'approved' | 'rejected' | 'stale';
  performedBy: string;
  note: string | null;
  createdAt: string;
}

export async function listPriceReviewLogs(dbx: ReviewDb, page: number): Promise<{ rows: PriceReviewLog[]; total: number }> {
  const offset = Math.max(0, page - 1) * PRICE_REVIEW_PAGE_SIZE;
  const [countRows, rows] = await Promise.all([
    dbx.query(`SELECT count(*)::int AS n FROM price_review_logs`),
    dbx.query(`SELECT * FROM price_review_logs ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`, [PRICE_REVIEW_PAGE_SIZE, offset]),
  ]);
  return {
    total: num(countRows[0]?.n ?? 0),
    rows: rows.map((r) => ({
      id: num(r.id), reviewId: num(r.review_id), personName: String(r.person_name), category: String(r.category), itemId: String(r.item_id),
      itemTitle: r.item_title == null ? null : String(r.item_title), previousPrice: num(r.previous_price), fetchedPrice: num(r.fetched_price),
      action: String(r.action) as PriceReviewLog['action'], performedBy: String(r.performed_by), note: r.note == null ? null : String(r.note),
      createdAt: new Date(r.created_at as string | Date).toISOString(),
    })),
  };
}

// ── 承認・却下 ─────────────────────────────────────────────────────────────────

export interface DecideInput {
  action: PriceReviewAction;
  id: number;
  /** 管理画面で確認した変更前の価格・取得した価格（DB の確認待ちと一致しなければ何もしない） */
  expectedPreviousPrice: number;
  expectedFetchedPrice: number;
  operator: string;
}

export type DecideCode =
  | 'approved' | 'rejected'
  | 'invalid_input' | 'not_found' | 'already_decided' | 'price_mismatch' | 'expired' | 'stale' | 'conflict';

export interface DecideResult { ok: boolean; code: DecideCode; message: string; status?: PriceReviewStatus; detail?: string }

/** 操作者名（1〜50文字。制御文字は不可） */
export function normalizeOperator(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > 50 || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/** リクエストの検証（サーバー側） */
export function parseDecideInput(body: unknown): DecideInput | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  if (b.action !== 'approve' && b.action !== 'reject') return null;
  const operator = normalizeOperator(b.operator);
  if (!operator || !isInt(b.id, 1, 2_147_483_647)) return null;
  if (!isInt(b.expectedPreviousPrice, 0, MAX_PRICE) || !isInt(b.expectedFetchedPrice, 1, MAX_PRICE)) return null;
  return { action: b.action, id: b.id, expectedPreviousPrice: b.expectedPreviousPrice, expectedFetchedPrice: b.expectedFetchedPrice, operator };
}

/** 承認の文（1つの Serializable トランザクション）。$1=id, $2=操作者, $3=変更前の価格, $4=取得した価格, $5=承認の期限（取得日時がこれ以前なら承認しない） */
export function buildApproveStatements(input: DecideInput, cutoffMs: number): SqlStmt[] {
  const thisDecision = `r.id = $1 AND r.status = 'approved' AND r.decided_at = now() AND r.decided_by = $2`;
  return [
    // 1. 確認待ちを承認済みに（確認待ちのまま・価格が画面と同じ・古すぎない・商品が承認してよい状態のときだけ）
    {
      text: `UPDATE price_reviews r SET status = 'approved', decided_by = $2, decided_at = now(), updated_at = now()
        WHERE r.id = $1 AND r.status = 'pending' AND r.previous_price = $3 AND r.fetched_price = $4 AND r.fetched_at_ms > $5
          AND EXISTS (SELECT 1 FROM products p WHERE ${ITEM_MATCH_SQL})
        RETURNING r.id`,
      params: [input.id, input.operator, input.expectedPreviousPrice, input.expectedFetchedPrice, cutoffMs],
    },
    // 2. 商品の price・priceFetchedAt だけを更新（このトランザクションで承認した確認待ちだけ。同じ条件をもう一度確認）
    {
      text: `UPDATE products p SET items = jsonb_set(
          jsonb_set(p.items,
            ARRAY[(SELECT (e.ord - 1)::text FROM jsonb_array_elements(p.items) WITH ORDINALITY e(it, ord) WHERE e.it->>'id' = r.item_id), 'price'],
            to_jsonb(r.fetched_price)),
          ARRAY[(SELECT (e.ord - 1)::text FROM jsonb_array_elements(p.items) WITH ORDINALITY e(it, ord) WHERE e.it->>'id' = r.item_id), 'priceFetchedAt'],
          to_jsonb(r.fetched_at_ms))
        FROM price_reviews r
        WHERE ${thisDecision} AND ${ITEM_MATCH_SQL}
        RETURNING p.person_name`,
      params: [input.id, input.operator],
    },
    // 3. 承認したのに商品が更新されていなければ、エラーにしてトランザクション全体を取り消す（承認済みだけが残ることを防ぐ）
    {
      text: `SELECT 1 / (CASE WHEN EXISTS (SELECT 1 FROM price_reviews r WHERE ${thisDecision})
          AND NOT EXISTS (SELECT 1 FROM price_reviews r, products p, jsonb_array_elements(p.items) e(it)
            WHERE ${thisDecision} AND p.person_name = r.person_name AND p.category = r.category AND e.it->>'id' = r.item_id
              AND e.it->'price' = to_jsonb(r.fetched_price) AND e.it->'priceFetchedAt' = to_jsonb(r.fetched_at_ms))
        THEN 0 ELSE 1 END) AS ok`,
      params: [input.id, input.operator],
    },
    // 4. 履歴
    {
      text: `INSERT INTO price_review_logs (review_id, person_name, category, item_id, item_title, previous_price, fetched_price, action, performed_by)
        SELECT r.id, r.person_name, r.category, r.item_id, r.item_title, r.previous_price, r.fetched_price, 'approved', r.decided_by
        FROM price_reviews r WHERE ${thisDecision}
        RETURNING id`,
      params: [input.id, input.operator],
    },
  ];
}

/** 却下の文（1つの Serializable トランザクション）。保存済みの商品は変更しない */
export function buildRejectStatements(input: DecideInput): SqlStmt[] {
  return [
    {
      text: `UPDATE price_reviews r SET status = 'rejected', decided_by = $2, decided_at = now(), updated_at = now()
        WHERE r.id = $1 AND r.status = 'pending' AND r.previous_price = $3 AND r.fetched_price = $4
        RETURNING r.id`,
      params: [input.id, input.operator, input.expectedPreviousPrice, input.expectedFetchedPrice],
    },
    {
      text: `INSERT INTO price_review_logs (review_id, person_name, category, item_id, item_title, previous_price, fetched_price, action, performed_by)
        SELECT r.id, r.person_name, r.category, r.item_id, r.item_title, r.previous_price, r.fetched_price, 'rejected', r.decided_by
        FROM price_reviews r WHERE r.id = $1 AND r.status = 'rejected' AND r.decided_at = now() AND r.decided_by = $2
        RETURNING id`,
      params: [input.id, input.operator],
    },
  ];
}

const STALE_LABEL: Record<string, string> = {
  item_missing: '商品が削除された、または同じIDの商品が複数ある',
  identity_changed: '商品ページURL・アフィリエイトURL・商品コードが検出時と違う',
  price_changed: '保存済みの価格が変更前の価格から変わった',
  not_related: '判定が related ではなくなった',
};

function isSerializationFailure(e: unknown): boolean {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  const code = x?.code ?? x?.cause?.code;
  return code === '40001' || code === '40P01';
}

/** 承認・却下（二重の操作・同時の操作でも、二重に更新しない） */
export async function decidePriceReview(dbx: ReviewDb, input: DecideInput, nowMs = Date.now()): Promise<DecideResult> {
  const rows = await dbx.query(`SELECT id, status, previous_price, fetched_price, fetched_at_ms FROM price_reviews WHERE id = $1`, [input.id]);
  const cur = rows[0];
  if (!cur) return { ok: false, code: 'not_found', message: '確認待ちが見つかりません（削除された可能性があります）' };
  const status = String(cur.status) as PriceReviewStatus;
  if (status !== 'pending') return { ok: false, code: 'already_decided', status, message: `既に処理済みです（${STATUS_LABEL[status] ?? status}）。もう一度は実行しません` };
  if (num(cur.previous_price) !== input.expectedPreviousPrice || num(cur.fetched_price) !== input.expectedFetchedPrice) {
    return { ok: false, code: 'price_mismatch', message: '画面の価格と確認待ちの価格が一致しません。画面を再読み込みしてください' };
  }
  const cutoffMs = priceReviewCutoffMs(nowMs);
  if (input.action === 'approve' && isPriceReviewExpired(num(cur.fetched_at_ms), nowMs)) {
    return { ok: false, code: 'expired', message: `取得から${PRICE_REVIEW_MAX_AGE_DAYS}日以上経った価格のため承認できません（次の価格更新で再取得されるのを待つか、却下してください）` };
  }

  let results: Row[][];
  try {
    results = await dbx.transaction(input.action === 'approve' ? buildApproveStatements(input, cutoffMs) : buildRejectStatements(input), { serializable: true });
  } catch (e) {
    if (isSerializationFailure(e)) return { ok: false, code: 'conflict', message: '同時に別の操作が行われたため中止しました（何も変更していません）。画面を再読み込みしてください' };
    throw e;
  }
  if (results[0]?.length === 1) {
    return input.action === 'approve'
      ? { ok: true, code: 'approved', message: `承認しました：価格を ¥${input.expectedPreviousPrice.toLocaleString()} → ¥${input.expectedFetchedPrice.toLocaleString()} に更新しました` }
      : { ok: true, code: 'rejected', message: '却下しました（保存済みの価格は変更していません）' };
  }

  // 何も更新しなかった：理由を調べる（読み取りのみ）
  const again = (await dbx.query(`SELECT status FROM price_reviews WHERE id = $1`, [input.id]))[0];
  if (!again) return { ok: false, code: 'not_found', message: '確認待ちが見つかりません' };
  if (String(again.status) !== 'pending') {
    const st = String(again.status) as PriceReviewStatus;
    return { ok: false, code: 'already_decided', status: st, message: `既に処理済みです（${STATUS_LABEL[st] ?? st}）。もう一度は実行しません` };
  }
  if (input.action === 'reject') return { ok: false, code: 'conflict', message: '却下できませんでした（何も変更していません）。画面を再読み込みしてください' };
  const reason = await staleReason(dbx, input.id);
  // 承認できない状態の確認待ちは stale にして一覧から外す（商品は変更しない。新しい変更案が出れば再び表示される）
  await dbx.transaction([
    { text: `UPDATE price_reviews SET status = 'stale', updated_at = now() WHERE id = $1 AND status = 'pending'`, params: [input.id] },
    {
      text: `INSERT INTO price_review_logs (review_id, person_name, category, item_id, item_title, previous_price, fetched_price, action, performed_by, note)
        SELECT id, person_name, category, item_id, item_title, previous_price, fetched_price, 'stale', $2, $3 FROM price_reviews WHERE id = $1 AND status = 'stale'`,
      params: [input.id, input.operator, STALE_LABEL[reason] ?? reason],
    },
  ], { serializable: true }).catch((e) => { if (!isSerializationFailure(e)) throw e; });
  return { ok: false, code: 'stale', detail: reason, message: `更新しませんでした：${STALE_LABEL[reason] ?? reason}。確認待ちから外しました（商品は変更していません）` };
}

async function staleReason(dbx: ReviewDb, id: number): Promise<string> {
  const r = (await dbx.query(`SELECT
      (SELECT count(*)::int FROM products p, jsonb_array_elements(p.items) e(it)
        WHERE p.person_name = r.person_name AND p.category = r.category AND e.it->>'id' = r.item_id) AS n,
      (SELECT bool_and(${IDENTITY_SQL('e.it')} = r.item_identity) FROM products p, jsonb_array_elements(p.items) e(it)
        WHERE p.person_name = r.person_name AND p.category = r.category AND e.it->>'id' = r.item_id) AS same_identity,
      (SELECT bool_and(${PRICE_SQL('e.it')} = r.previous_price) FROM products p, jsonb_array_elements(p.items) e(it)
        WHERE p.person_name = r.person_name AND p.category = r.category AND e.it->>'id' = r.item_id) AS same_price,
      EXISTS (SELECT 1 FROM verdicts v WHERE v.person_name = r.person_name AND v.product_id = r.item_id AND v.verdict = 'related') AS related
    FROM price_reviews r WHERE r.id = $1`, [id]))[0];
  if (!r || num(r.n) !== 1) return 'item_missing';
  if (!r.same_identity) return 'identity_changed';
  if (!r.same_price) return 'price_changed';
  if (!r.related) return 'not_related';
  return 'price_changed';
}

export const STATUS_LABEL: Record<PriceReviewStatus, string> = {
  pending: '確認待ち', approved: '承認済み', rejected: '却下済み', superseded: '新しい変更案に置き換え済み', stale: '保存済みの商品が変わったため対象外',
};
