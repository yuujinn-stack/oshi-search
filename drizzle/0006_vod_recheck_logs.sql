-- VOD再確認 監査ログ（/admin/vod-recheck からの手動操作を記録）
CREATE TABLE IF NOT EXISTS "vod_recheck_logs" (
  "id"                     serial PRIMARY KEY,
  "person_name"            text NOT NULL,
  "work_id"                text NOT NULL,
  "action"                 text NOT NULL,
  "performed_by"           text NOT NULL,
  "note"                   text,
  "updated_provider_count" integer,
  "active_count_before"    integer,
  "active_count_after"     integer,
  "unknown_count_before"   integer,
  "unknown_count_after"    integer,
  "vod_check_status_after" text,
  "created_at"             timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vrl_person_work_idx" ON "vod_recheck_logs" ("person_name", "work_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vrl_created_at_idx" ON "vod_recheck_logs" ("created_at");
