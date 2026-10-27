// 楽天イベント管理（/admin/rakuten-events）の DB 操作。サーバー専用。
// テーブル：rakuten_events・rakuten_event_products（drizzle/0022_rakuten_events.sql）。
//
// - 商品は既存の products.items（人物×保存カテゴリの JSON 配列）を読むだけで、products・verdicts には書き込まない。
//   商品の検索・紐付けは DB 側で JSON を展開して必要な項目だけを返す（items 全体を転送しない）。
// - 紐付けの確認状態は管理者の操作（updateEventProduct）でだけ変わる。自動で「対象外」にする処理は無い。
// - イベントの更新は、画面で読んだ時点の updated_at と一致するときだけ保存する（同時編集で上書きしない）。
import { neonSql } from '@/db/client';
import type {
  CheckStatus, EventInput, LinkUpdateInput, RakutenEvent, RakutenEventProduct,
} from './core';

export type Row = Record<string, unknown>;
export interface SqlStmt { text: string; params: unknown[] }
export interface EventDb {
  query(text: string, params?: unknown[]): Promise<Row[]>;
  transaction(stmts: SqlStmt[]): Promise<Row[][]>;
}

export function neonEventDb(): EventDb {
  return {
    query: (text, params = []) => neonSql.query(text, params) as Promise<Row[]>,
    transaction: (stmts) => neonSql.transaction(stmts.map((s) => neonSql.query(s.text, s.params))) as Promise<Row[][]>,
  };
}

/** テーブル未作成（setup-tables の apply 前） */
export function isMissingEventTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  return code === '42P01' || /relation .*rakuten_event.* does not exist/i.test(`${e?.message ?? ''} ${e?.cause?.message ?? ''}`);
}

const ms = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const str = (v: unknown): string | null => (v == null ? null : String(v));

const EVENT_COLS = `id, name, event_type, official_url, entry_required, entry_url, conditions, benefit, benefit_conditions,
  visibility, note, updated_by,
  (extract(epoch from starts_at) * 1000)::float8 AS starts_ms,
  (extract(epoch from ends_at) * 1000)::float8 AS ends_ms,
  (extract(epoch from last_checked_at) * 1000)::float8 AS last_checked_ms,
  (extract(epoch from created_at) * 1000)::float8 AS created_ms,
  (extract(epoch from updated_at) * 1000)::float8 AS updated_ms`;

function toEvent(r: Row): RakutenEvent {
  return {
    id: Number(r.id),
    name: String(r.name),
    eventType: r.event_type as RakutenEvent['eventType'],
    startsAt: ms(r.starts_ms) ?? 0,
    endsAt: ms(r.ends_ms) ?? 0,
    officialUrl: str(r.official_url),
    entryRequired: r.entry_required as RakutenEvent['entryRequired'],
    entryUrl: str(r.entry_url),
    conditions: str(r.conditions),
    benefit: str(r.benefit),
    benefitConditions: str(r.benefit_conditions),
    lastCheckedAt: ms(r.last_checked_ms),
    visibility: r.visibility as RakutenEvent['visibility'],
    note: str(r.note),
    updatedBy: str(r.updated_by),
    createdAt: ms(r.created_ms) ?? 0,
    updatedAt: ms(r.updated_ms) ?? 0,
  };
}

const LINK_COLS = `id, event_id, person_name, category, product_id, product_title, check_status, benefit_scope, benefit_note,
  source_url, checked_by, note,
  (extract(epoch from checked_at) * 1000)::float8 AS checked_ms,
  (extract(epoch from updated_at) * 1000)::float8 AS updated_ms`;

function toLink(r: Row): RakutenEventProduct {
  return {
    id: Number(r.id),
    eventId: Number(r.event_id),
    personName: String(r.person_name),
    category: String(r.category),
    productId: String(r.product_id),
    productTitle: str(r.product_title),
    checkStatus: r.check_status as RakutenEventProduct['checkStatus'],
    benefitScope: r.benefit_scope as RakutenEventProduct['benefitScope'],
    benefitNote: str(r.benefit_note),
    sourceUrl: str(r.source_url),
    checkedAt: ms(r.checked_ms),
    checkedBy: str(r.checked_by),
    note: str(r.note),
    updatedAt: ms(r.updated_ms) ?? 0,
  };
}

export interface EventWithCounts extends RakutenEvent {
  counts: Record<CheckStatus, number>;
}

/** イベント一覧（終了していないものを開始日時の順に、その後に終了したものを新しい順に） */
export async function listEvents(db: EventDb): Promise<EventWithCounts[]> {
  const rows = await db.query(`
    SELECT ${EVENT_COLS},
      (SELECT count(*)::int FROM rakuten_event_products p WHERE p.event_id = e.id AND p.check_status = 'confirmed') AS n_confirmed,
      (SELECT count(*)::int FROM rakuten_event_products p WHERE p.event_id = e.id AND p.check_status = 'needs_check') AS n_needs_check,
      (SELECT count(*)::int FROM rakuten_event_products p WHERE p.event_id = e.id AND p.check_status = 'excluded') AS n_excluded
    FROM rakuten_events e
    ORDER BY (e.ends_at <= now()), CASE WHEN e.ends_at > now() THEN e.starts_at END ASC, e.ends_at DESC, e.id DESC
    LIMIT 500`);
  return rows.map((r) => ({
    ...toEvent(r),
    counts: { confirmed: Number(r.n_confirmed ?? 0), needs_check: Number(r.n_needs_check ?? 0), excluded: Number(r.n_excluded ?? 0) },
  }));
}

export async function getEvent(db: EventDb, id: number): Promise<RakutenEvent | null> {
  const rows = await db.query(`SELECT ${EVENT_COLS} FROM rakuten_events WHERE id = $1`, [id]);
  return rows[0] ? toEvent(rows[0]) : null;
}

const eventParams = (v: EventInput) => [
  v.name, v.eventType, new Date(v.startsAt).toISOString(), new Date(v.endsAt).toISOString(), v.officialUrl, v.entryRequired, v.entryUrl,
  v.conditions, v.benefit, v.benefitConditions, v.lastCheckedAt == null ? null : new Date(v.lastCheckedAt).toISOString(), v.visibility, v.note,
];

export async function createEvent(db: EventDb, v: EventInput, operator: string): Promise<number> {
  const rows = await db.query(`
    INSERT INTO rakuten_events (name, event_type, starts_at, ends_at, official_url, entry_required, entry_url,
      conditions, benefit, benefit_conditions, last_checked_at, visibility, note, updated_by)
    VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12, $13, $14)
    RETURNING id`, [...eventParams(v), operator]);
  return Number(rows[0].id);
}

export type UpdateResult = 'updated' | 'not_found' | 'conflict';

/** 更新。expectedUpdatedAt（画面で読んだ時点の updated_at・ms）と一致するときだけ保存する */
export async function updateEvent(db: EventDb, id: number, v: EventInput, operator: string, expectedUpdatedAt: number): Promise<UpdateResult> {
  const rows = await db.query(`
    UPDATE rakuten_events SET name = $1, event_type = $2, starts_at = $3::timestamptz, ends_at = $4::timestamptz, official_url = $5,
      entry_required = $6, entry_url = $7, conditions = $8, benefit = $9, benefit_conditions = $10, last_checked_at = $11::timestamptz,
      visibility = $12, note = $13, updated_by = $14,
      -- 同じミリ秒の更新でも古い画面からの保存を見分けられるよう、少なくとも 2ms 進める（画面の値は ms に丸めるため比較は 0.6ms 未満）
      updated_at = greatest(now(), updated_at + interval '2 milliseconds')
    WHERE id = $15 AND abs((extract(epoch from updated_at) * 1000) - $16::float8) < 0.6
    RETURNING id`, [...eventParams(v), operator, id, expectedUpdatedAt]);
  if (rows.length) return 'updated';
  const exists = await db.query(`SELECT 1 FROM rakuten_events WHERE id = $1`, [id]);
  return exists.length ? 'conflict' : 'not_found';
}

/** イベントと、その紐付け（商品データ自体は消さない）を1つのトランザクションで削除する */
export async function deleteEvent(db: EventDb, id: number): Promise<boolean> {
  const [, deleted] = await db.transaction([
    { text: `DELETE FROM rakuten_event_products WHERE event_id = $1`, params: [id] },
    { text: `DELETE FROM rakuten_events WHERE id = $1 RETURNING id`, params: [id] },
  ]);
  return deleted.length > 0;
}

/** 紐付けた商品（商品データの itemCode・商品ページURL・判定も、表示用に products・verdicts から読む） */
export interface EventProductRow extends RakutenEventProduct {
  itemCode: string | null;
  itemUrl: string | null;
  verdict: string | null;
  /** products に商品が見つからない（削除・ID変更） */
  missing: boolean;
}

export async function listEventProducts(db: EventDb, eventId: number): Promise<EventProductRow[]> {
  const rows = await db.query(`
    SELECT l.id, l.event_id, l.person_name, l.category, l.product_id, l.product_title, l.check_status, l.benefit_scope, l.benefit_note,
      l.source_url, l.checked_by, l.note,
      (extract(epoch from l.checked_at) * 1000)::float8 AS checked_ms,
      (extract(epoch from l.updated_at) * 1000)::float8 AS updated_ms,
      it.item->>'itemCode' AS item_code, it.item->>'itemUrl' AS item_url, (it.item IS NULL) AS missing, v.verdict
    FROM rakuten_event_products l
    LEFT JOIN products p ON p.person_name = l.person_name AND p.category = l.category
    LEFT JOIN LATERAL (
      SELECT e.item FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.items) = 'array' THEN p.items ELSE '[]'::jsonb END) AS e(item)
      WHERE e.item->>'id' = l.product_id LIMIT 1
    ) it ON true
    LEFT JOIN verdicts v ON v.person_name = l.person_name AND v.product_id = l.product_id
    WHERE l.event_id = $1 ORDER BY l.person_name, l.category, l.id`, [eventId]);
  return rows.map((r) => ({ ...toLink(r), itemCode: str(r.item_code), itemUrl: str(r.item_url), verdict: str(r.verdict), missing: r.missing === true }));
}

export interface LinkTarget { personName: string; category: string; productId: string }
export const MAX_LINK_PER_REQUEST = 50;

/**
 * 既存の商品をイベントに紐付ける（確認状態は「要確認」で開始）。products に実在する商品だけを紐付け、
 * 既に紐付けてある商品はそのまま（確認状態を戻さない）。商品名は一覧の表示用に紐付け時点の値を保存する。
 */
export async function linkProducts(db: EventDb, eventId: number, targets: LinkTarget[]): Promise<{ linked: number; skipped: number }> {
  const stmts = targets.slice(0, MAX_LINK_PER_REQUEST).map((t) => ({
    text: `
      INSERT INTO rakuten_event_products (event_id, person_name, category, product_id, product_title)
      SELECT $1, p.person_name, p.category, e.item->>'id', left(e.item->>'title', 300)
      FROM rakuten_events ev
      JOIN products p ON p.person_name = $2 AND p.category = $3
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.items) = 'array' THEN p.items ELSE '[]'::jsonb END) AS e(item)
      WHERE ev.id = $1 AND e.item->>'id' = $4
      LIMIT 1
      ON CONFLICT (event_id, person_name, product_id) DO NOTHING
      RETURNING id`,
    params: [eventId, t.personName, t.category, t.productId],
  }));
  if (!stmts.length) return { linked: 0, skipped: 0 };
  const results = await db.transaction(stmts);
  const linked = results.filter((r) => r.length > 0).length;
  return { linked, skipped: stmts.length - linked };
}

/** 確認状態・特典の範囲・確認元URL・確認日時・メモを更新する（管理者の操作だけ） */
export async function updateEventProduct(db: EventDb, linkId: number, eventId: number, v: LinkUpdateInput, operator: string): Promise<boolean> {
  const rows = await db.query(`
    UPDATE rakuten_event_products SET check_status = $1, benefit_scope = $2, benefit_note = $3, source_url = $4,
      checked_at = $5::timestamptz, checked_by = $6, note = $7, updated_at = now()
    WHERE id = $8 AND event_id = $9 RETURNING id`,
  [v.checkStatus, v.benefitScope, v.benefitNote, v.sourceUrl, v.checkedAt == null ? null : new Date(v.checkedAt).toISOString(), operator, v.note, linkId, eventId]);
  return rows.length > 0;
}

export async function unlinkProduct(db: EventDb, linkId: number, eventId: number): Promise<boolean> {
  const rows = await db.query(`DELETE FROM rakuten_event_products WHERE id = $1 AND event_id = $2 RETURNING id`, [linkId, eventId]);
  return rows.length > 0;
}

// ── 商品の検索（既存の products を読むだけ） ──────────────────────────────────────

export interface ProductSearchInput {
  personNames: string[];
  categories: string[];
  keyword: string;
  /** false（既定）なら公開中（判定 related）の商品だけ */
  includeUnpublished: boolean;
  /** 紐付け済みかを表示するイベント */
  eventId?: number;
}
export interface ProductSearchRow {
  personName: string;
  category: string;
  productId: string;
  title: string;
  shopName: string | null;
  itemCode: string | null;
  itemUrl: string | null;
  verdict: string | null;
  isUsed: boolean;
  linkedStatus: CheckStatus | null;
  /** 紐付け済みの場合の特典の範囲・確認元URL・確認日時 */
  linkId: number | null;
  linkedScope: string | null;
  linkedSourceUrl: string | null;
  linkedCheckedAt: number | null;
}
export const MAX_SEARCH_PERSONS = 60;
export const MAX_SEARCH_RESULTS = 500;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function searchProducts(db: EventDb, q: ProductSearchInput): Promise<{ rows: ProductSearchRow[]; truncated: boolean }> {
  const persons = q.personNames.slice(0, MAX_SEARCH_PERSONS);
  if (!persons.length) return { rows: [], truncated: false };
  const rows = await db.query(`
    SELECT p.person_name, p.category, e.item->>'id' AS product_id, e.item->>'title' AS title, e.item->>'shopName' AS shop_name,
      e.item->>'itemCode' AS item_code, e.item->>'itemUrl' AS item_url, (e.item->>'isUsed') = 'true' AS is_used,
      v.verdict, l.check_status AS linked_status, l.id AS link_id, l.benefit_scope AS linked_scope, l.source_url AS linked_source_url,
      (extract(epoch from l.checked_at) * 1000)::float8 AS linked_checked_ms
    FROM products p
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.items) = 'array' THEN p.items ELSE '[]'::jsonb END) AS e(item)
    LEFT JOIN verdicts v ON v.person_name = p.person_name AND v.product_id = e.item->>'id'
    LEFT JOIN rakuten_event_products l ON l.event_id = $5 AND l.person_name = p.person_name AND l.product_id = e.item->>'id'
    WHERE p.person_name = ANY($1::text[])
      AND (cardinality($2::text[]) = 0 OR p.category = ANY($2::text[]))
      AND ($3 = '' OR e.item->>'title' ILIKE '%' || $3 || '%' ESCAPE '\\')
      AND ($4::boolean OR v.verdict = 'related')
      AND coalesce(e.item->>'id', '') <> ''
    ORDER BY array_position($1::text[], p.person_name), p.category, e.item->>'title'
    LIMIT ${MAX_SEARCH_RESULTS + 1}`,
  [persons, q.categories, escapeLike(q.keyword.trim()), q.includeUnpublished, q.eventId ?? 0]);
  const out = rows.slice(0, MAX_SEARCH_RESULTS).map((r) => ({
    personName: String(r.person_name),
    category: String(r.category),
    productId: String(r.product_id),
    title: String(r.title ?? ''),
    shopName: str(r.shop_name),
    itemCode: str(r.item_code),
    itemUrl: str(r.item_url),
    verdict: str(r.verdict),
    isUsed: r.is_used === true,
    linkedStatus: (r.linked_status as CheckStatus | null) ?? null,
    linkId: r.link_id == null ? null : Number(r.link_id),
    linkedScope: str(r.linked_scope),
    linkedSourceUrl: str(r.linked_source_url),
    linkedCheckedAt: ms(r.linked_checked_ms),
  }));
  return { rows: out, truncated: rows.length > MAX_SEARCH_RESULTS };
}

/** 紐付けた商品の itemCode（楽天市場の商品だけ。API で現在の情報を確認するため） */
export async function getLinkedItemCode(db: EventDb, linkId: number): Promise<{ itemCode: string | null; itemUrl: string | null } | null> {
  const rows = await db.query(`
    SELECT e.item->>'itemCode' AS item_code, e.item->>'itemUrl' AS item_url
    FROM rakuten_event_products l
    JOIN products p ON p.person_name = l.person_name AND p.category = l.category
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.items) = 'array' THEN p.items ELSE '[]'::jsonb END) AS e(item)
    WHERE l.id = $1 AND e.item->>'id' = l.product_id
    LIMIT 1`, [linkId]);
  if (!rows[0]) return null;
  return { itemCode: str(rows[0].item_code), itemUrl: str(rows[0].item_url) };
}

/** 選んだ商品の itemCode（API確認用。画面から送られた値は使わず、products から読む）。見つからない商品は含めない */
export async function getItemCodesFor(db: EventDb, targets: LinkTarget[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!targets.length) return out;
  const rows = await db.query(`
    SELECT t.person_name, t.category, t.product_id, e.item->>'itemCode' AS item_code
    FROM unnest($1::text[], $2::text[], $3::text[]) AS t(person_name, category, product_id)
    JOIN products p ON p.person_name = t.person_name AND p.category = t.category
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.items) = 'array' THEN p.items ELSE '[]'::jsonb END) AS e(item)
    WHERE e.item->>'id' = t.product_id`,
  [targets.map((t) => t.personName), targets.map((t) => t.category), targets.map((t) => t.productId)]);
  for (const r of rows) out.set(linkTargetKey({ personName: String(r.person_name), category: String(r.category), productId: String(r.product_id) }), str(r.item_code));
  return out;
}

export const linkTargetKey = (t: LinkTarget) => `${t.personName}\u0000${t.category}\u0000${t.productId}`;
