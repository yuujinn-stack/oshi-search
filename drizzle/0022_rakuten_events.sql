-- 楽天イベント管理（管理画面 /admin/rakuten-events。Task 157）。
-- 新規テーブル2つの追加のみ（CREATE TABLE / INDEX IF NOT EXISTS）。既存テーブル・既存行・制約・権限の変更なし。
-- 本番適用は scripts/rakuten-events/setup-tables.ts（check → apply → verify）で行う（/admin/db-init は使わない）。
--
-- rakuten_events：楽天のイベント（お買い物マラソン・5と0のつく日・スーパーSALE・期間限定クーポン等）。手動登録。
--   starts_at / ends_at は timestamptz（画面では日本時間で入力・表示）。終了状態は保存せず、表示時に ends_at と現在時刻で判定する。
--   entry_required: required（エントリー必要）／not_required（不要）／unknown（未確認）
--   visibility: published（SNS投稿に使ってよい）／hidden（非公開・下書き）。一般公開ページには使わない。
--
-- rakuten_event_products：イベントと既存の楽天商品（products.items の要素）の紐付け。商品データは複製せず、
--   人物名・保存カテゴリ・商品ID で参照する（商品名は一覧の表示用に紐付け時点の値だけ保存）。
--   check_status: confirmed（公式情報で確認済み）／needs_check（要確認）／excluded（対象外。手動でのみ設定）
--   benefit_scope: item（商品単体の割引・ポイント倍率・確定特典）／shop（ショップ単位）／
--                  buyer_condition（楽天カード・買いまわり等、購入者の条件で変わる）／event_general（イベント全体）／unknown
CREATE TABLE IF NOT EXISTS "rakuten_events" (
  "id"                 serial PRIMARY KEY,
  "name"               text NOT NULL,
  "event_type"         text NOT NULL,
  "starts_at"          timestamptz NOT NULL,
  "ends_at"            timestamptz NOT NULL,
  "official_url"       text,
  "entry_required"     text NOT NULL DEFAULT 'unknown',
  "entry_url"          text,
  "conditions"         text,
  "benefit"            text,
  "benefit_conditions" text,
  "last_checked_at"    timestamptz,
  "visibility"         text NOT NULL DEFAULT 'hidden',
  "note"               text,
  "updated_by"         text,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rakuten_events_ends_at_idx" ON "rakuten_events" ("ends_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rakuten_event_products" (
  "id"             serial PRIMARY KEY,
  "event_id"       integer NOT NULL,
  "person_name"    text NOT NULL,
  "category"       text NOT NULL,
  "product_id"     text NOT NULL,
  "product_title"  text,
  "check_status"   text NOT NULL DEFAULT 'needs_check',
  "benefit_scope"  text NOT NULL DEFAULT 'unknown',
  "benefit_note"   text,
  "source_url"     text,
  "checked_at"     timestamptz,
  "checked_by"     text,
  "note"           text,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rakuten_event_products_link_idx" ON "rakuten_event_products" ("event_id", "person_name", "product_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rakuten_event_products_event_idx" ON "rakuten_event_products" ("event_id");
