-- VOD自動調査ジョブ管理（/admin/vod-recheck の調査対象CSVアップロード機能用）
CREATE TABLE IF NOT EXISTS "vod_investigation_jobs" (
  "id"         text PRIMARY KEY,
  "status"     text NOT NULL DEFAULT 'pending',
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vij_status_idx" ON "vod_investigation_jobs" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vij_created_at_idx" ON "vod_investigation_jobs" ("created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "vod_investigation_job_items" (
  "id"                         serial PRIMARY KEY,
  "job_id"                     text NOT NULL,
  "work_id"                    text NOT NULL,
  "person_name"                text NOT NULL,
  "title"                      text NOT NULL,
  "work_type"                  text NOT NULL,
  "release_year"               integer,
  "status"                     text NOT NULL DEFAULT 'pending',
  "decision"                   text NOT NULL DEFAULT 'pending',
  "retry_count"                integer NOT NULL DEFAULT 0,
  "candidate_providers"        jsonb,
  "current_providers_snapshot" jsonb,
  "manual_providers"           jsonb,
  "error_message"              text,
  "investigated_at"            timestamp with time zone,
  "decided_at"                 timestamp with time zone,
  "decided_by"                 text,
  "created_at"                 timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"                 timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "viji_job_id_idx" ON "vod_investigation_job_items" ("job_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "viji_job_status_idx" ON "vod_investigation_job_items" ("job_id", "status");
