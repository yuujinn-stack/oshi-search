-- 廃止 workId → canonical workId のリダイレクト管理
CREATE TABLE IF NOT EXISTS "work_aliases" (
  "alias_work_id"     text PRIMARY KEY,
  "canonical_work_id" text NOT NULL,
  "merge_group_key"   text,
  "created_by"        text,
  "created_at"        timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_canonical_work_id_idx" ON "work_aliases" ("canonical_work_id");
--> statement-breakpoint

-- 統合実行ログ（監査ログ）
CREATE TABLE IF NOT EXISTS "work_merge_logs" (
  "id"                        serial PRIMARY KEY,
  "candidate_group_key"       text NOT NULL,
  "canonical_work_id"         text NOT NULL,
  "duplicate_work_ids"        jsonb NOT NULL,
  "person_links_moved"        integer NOT NULL DEFAULT 0,
  "person_links_removed"      integer NOT NULL DEFAULT 0,
  "vod_providers_merged"      integer NOT NULL DEFAULT 0,
  "aliases_created"           integer NOT NULL DEFAULT 0,
  "redis_click_moved"         integer NOT NULL DEFAULT 0,
  "redis_keys_deleted"        integer NOT NULL DEFAULT 0,
  "redis_error"               text,
  "success"                   boolean NOT NULL,
  "error_message"             text,
  "executed_by"               text,
  "executed_at"               timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wml_candidate_group_key_idx" ON "work_merge_logs" ("candidate_group_key");
CREATE INDEX IF NOT EXISTS "wml_executed_at_idx"         ON "work_merge_logs" ("executed_at");
--> statement-breakpoint

-- work_dedup_reviews にapply関連カラムを追加
ALTER TABLE "work_dedup_reviews"
  ADD COLUMN IF NOT EXISTS "applied_at"                timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "applied_by"                text,
  ADD COLUMN IF NOT EXISTS "applied_canonical_work_id" text,
  ADD COLUMN IF NOT EXISTS "apply_result"              jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wdr_applied_at_idx" ON "work_dedup_reviews" ("applied_at");
