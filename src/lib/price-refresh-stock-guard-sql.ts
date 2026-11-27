// 価格更新専用ユーザー（price_refresher）の保護トリガーの関数を、販売状況の項目（stockStatus・stockCheckedAt）も変更できるように更新する SQL。
// 適用は scripts/price-refresh/stock-guard.ts（オーナーの接続で。確認の入力が必要）。テストは src/lib/__tests__/price-refresh-stock-guard.test.ts（PGlite）。
//
// 変えるのは関数 products_price_refresher_guard() の中身だけ（CREATE OR REPLACE FUNCTION）。テーブル・列・トリガー・権限・ロールは変えない。
// サイト・既存の自動更新・管理画面（neondb_owner）では従来どおり冒頭で抜ける（影響なし）。
// price_refresher に許す変更：
//   - price（正の数値）・priceFetchedAt（数値）… 従来どおり
//   - stockStatus（'available'・'backorder'・'preorder'・'unavailable'・'unknown'・'not_found'・'mismatched' のどれか）・stockCheckedAt（正の数値） … 追加
//   - 販売状況の2項目を消すことはできない（一度記録した結果は新しい結果で上書きするだけ）
// 商品の件数・並び・他の項目（商品名・URL・アフィリエイトURL・ID・レビュー数 等）の変更は従来どおり拒否する。

export const STOCK_GUARD_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION products_price_refresher_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  -- 変更してよいのは価格の2項目と販売状況の2項目だけ（レビュー数・平均も変更不可）
  price_keys text[] := ARRAY['price', 'priceFetchedAt', 'stockStatus', 'stockCheckedAt'];
BEGIN
  IF current_user <> 'price_refresher' THEN
    RETURN NEW;   -- サイト・既存の自動更新・管理画面（neondb_owner）には影響しない
  END IF;
  IF jsonb_typeof(NEW.items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.items) <> jsonb_array_length(OLD.items) THEN
    RAISE EXCEPTION 'price_refresher: 商品の件数は変更できません';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(OLD.items) WITH ORDINALITY AS o(e, i)
    JOIN jsonb_array_elements(NEW.items) WITH ORDINALITY AS n(e, i) ON o.i = n.i
    WHERE (o.e - price_keys) IS DISTINCT FROM (n.e - price_keys)
  ) THEN
    RAISE EXCEPTION 'price_refresher: 価格の項目以外は変更できません';
  END IF;
  -- 変更する場合、price は正の数値、priceFetchedAt は数値だけ（消す・文字列・0以下にはできない）
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(OLD.items) WITH ORDINALITY AS o(e, i)
    JOIN jsonb_array_elements(NEW.items) WITH ORDINALITY AS n(e, i) ON o.i = n.i
    WHERE ((n.e -> 'price') IS DISTINCT FROM (o.e -> 'price')
           AND NOT COALESCE(CASE WHEN jsonb_typeof(n.e -> 'price') = 'number' THEN (n.e ->> 'price')::numeric > 0 END, false))
       OR ((n.e -> 'priceFetchedAt') IS DISTINCT FROM (o.e -> 'priceFetchedAt')
           AND jsonb_typeof(n.e -> 'priceFetchedAt') IS DISTINCT FROM 'number')
  ) THEN
    RAISE EXCEPTION 'price_refresher: 価格は正の数値、取得日時は数値でのみ更新できます';
  END IF;
  -- 販売状況：stockStatus は決まった7つの値だけ、stockCheckedAt は正の数値だけ（消す・文字列・0以下にはできない）
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(OLD.items) WITH ORDINALITY AS o(e, i)
    JOIN jsonb_array_elements(NEW.items) WITH ORDINALITY AS n(e, i) ON o.i = n.i
    WHERE ((n.e -> 'stockStatus') IS DISTINCT FROM (o.e -> 'stockStatus')
           AND NOT COALESCE((n.e ->> 'stockStatus') IN ('available', 'backorder', 'preorder', 'unavailable', 'unknown', 'not_found', 'mismatched')
                            AND jsonb_typeof(n.e -> 'stockStatus') = 'string', false))
       OR ((n.e -> 'stockCheckedAt') IS DISTINCT FROM (o.e -> 'stockCheckedAt')
           AND NOT COALESCE(CASE WHEN jsonb_typeof(n.e -> 'stockCheckedAt') = 'number' THEN (n.e ->> 'stockCheckedAt')::numeric > 0 END, false))
  ) THEN
    RAISE EXCEPTION 'price_refresher: 販売状況は決まった値、確認日時は正の数値でのみ更新できます';
  END IF;
  RETURN NEW;
END
$$;`;

/** 取り消し用：販売状況の項目を許可する前の関数（2026-11-27 に本番の定義を読み取りで確認したものと同じ内容） */
export const STOCK_GUARD_UNDO_SQL = `
CREATE OR REPLACE FUNCTION products_price_refresher_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  price_keys text[] := ARRAY['price', 'priceFetchedAt'];   -- 変更してよいのはこの2項目だけ（レビュー数・平均も変更不可）
BEGIN
  IF current_user <> 'price_refresher' THEN
    RETURN NEW;   -- サイト・既存の自動更新・管理画面（neondb_owner）には影響しない
  END IF;
  IF jsonb_typeof(NEW.items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.items) <> jsonb_array_length(OLD.items) THEN
    RAISE EXCEPTION 'price_refresher: 商品の件数は変更できません';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(OLD.items) WITH ORDINALITY AS o(e, i)
    JOIN jsonb_array_elements(NEW.items) WITH ORDINALITY AS n(e, i) ON o.i = n.i
    WHERE (o.e - price_keys) IS DISTINCT FROM (n.e - price_keys)
  ) THEN
    RAISE EXCEPTION 'price_refresher: 価格の項目以外は変更できません';
  END IF;
  -- 変更する場合、price は正の数値、priceFetchedAt は数値だけ（消す・文字列・0以下にはできない）
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(OLD.items) WITH ORDINALITY AS o(e, i)
    JOIN jsonb_array_elements(NEW.items) WITH ORDINALITY AS n(e, i) ON o.i = n.i
    WHERE ((n.e -> 'price') IS DISTINCT FROM (o.e -> 'price')
           AND NOT COALESCE(CASE WHEN jsonb_typeof(n.e -> 'price') = 'number' THEN (n.e ->> 'price')::numeric > 0 END, false))
       OR ((n.e -> 'priceFetchedAt') IS DISTINCT FROM (o.e -> 'priceFetchedAt')
           AND jsonb_typeof(n.e -> 'priceFetchedAt') IS DISTINCT FROM 'number')
  ) THEN
    RAISE EXCEPTION 'price_refresher: 価格は正の数値、取得日時は数値でのみ更新できます';
  END IF;
  RETURN NEW;
END
$$;`;

/** 適用済みかの判定（関数の定義に販売状況の項目が含まれるか） */
export function stockGuardApplied(functionDef: string): boolean {
  return /'stockStatus'/.test(functionDef) && /'stockCheckedAt'/.test(functionDef);
}
