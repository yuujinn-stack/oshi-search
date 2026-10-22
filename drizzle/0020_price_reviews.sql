-- 価格の確認待ち（前回の価格から30%以上の変動などで自動更新しなかった商品）の承認・却下（Task 127）。
-- 新規テーブル2つの追加のみ（CREATE TABLE / INDEX IF NOT EXISTS）。既存テーブル・既存行・制約・権限の変更なし。
-- 価格更新専用ユーザー（price_refresher）には権限を付けない（書き込むのは管理画面〔既存サイトの接続〕だけ）。
-- 本番適用は既存運用どおり /admin/db-init（CREATE_STATEMENTS）から行う。
--
-- price_reviews：価格の変更案（人物・カテゴリ・商品ID・変更前の価格・取得した価格の組で1行）。
--   status: pending（確認待ち）／approved（承認・反映済み）／rejected（却下。同じ組は再表示しない）／
--           superseded（同じ商品の新しい変更案が出た）／stale（承認しようとしたら保存済みの価格・商品が変わっていた）
--   item_identity：検出時の商品ページURL・アフィリエイトURL・itemCode（承認直前に一致を確認する）
CREATE TABLE IF NOT EXISTS "price_reviews" (
  "id"             serial PRIMARY KEY,
  "person_name"    text NOT NULL,
  "category"       text NOT NULL,
  "item_id"        text NOT NULL,
  "previous_price" integer NOT NULL,
  "fetched_price"  integer NOT NULL,
  "change_rate"    double precision,
  "reason"         text NOT NULL,
  "fetched_at_ms"  bigint NOT NULL,
  "item_identity"  jsonb NOT NULL,
  "item_title"     text,
  "status"         text DEFAULT 'pending' NOT NULL,
  "first_seen_at"  timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"     timestamp with time zone DEFAULT now() NOT NULL,
  "decided_by"     text,
  "decided_at"     timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "price_reviews_proposal_idx" ON "price_reviews" ("person_name", "category", "item_id", "previous_price", "fetched_price");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_reviews_status_idx" ON "price_reviews" ("status", "fetched_at_ms");
--> statement-breakpoint
-- price_review_logs：承認・却下の履歴（追記のみ）。action: approved／rejected／stale（承認しようとしたが反映しなかった）
CREATE TABLE IF NOT EXISTS "price_review_logs" (
  "id"             serial PRIMARY KEY,
  "review_id"      integer NOT NULL,
  "person_name"    text NOT NULL,
  "category"       text NOT NULL,
  "item_id"        text NOT NULL,
  "item_title"     text,
  "previous_price" integer NOT NULL,
  "fetched_price"  integer NOT NULL,
  "action"         text NOT NULL,
  "performed_by"   text NOT NULL,
  "note"           text,
  "created_at"     timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_review_logs_created_at_idx" ON "price_review_logs" ("created_at");
