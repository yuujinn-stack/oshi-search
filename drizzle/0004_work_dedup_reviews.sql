-- 作品重複候補レビューテーブル
-- 管理者が重複候補グループに対して行った判定結果を永続化する。
-- 作品統合・workId 変更・Redis 更新は行わない（レビュー記録のみ）。
-- reviewStatus: 'pending' | 'approved_duplicate' | 'rejected_distinct' | 'on_hold'
-- candidate_group_key: SHA-256(sorted workIds joined by '|') の 64文字 lowercase hex
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_dedup_reviews" (
  "id"                        serial PRIMARY KEY NOT NULL,
  "candidate_group_key"       text NOT NULL,
  "algorithm_version"         text NOT NULL,
  "candidate_work_ids"        jsonb NOT NULL,
  "normalized_title"          text DEFAULT '' NOT NULL,
  "detected_confidence"       text NOT NULL,
  "review_status"             text DEFAULT 'pending' NOT NULL,
  "selected_canonical_work_id" text,
  "reviewer_note"             text,
  "reviewed_by"               text,
  "reviewed_at"               timestamp with time zone,
  "created_at"                timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"                timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "work_dedup_reviews_candidate_group_key_unique" UNIQUE ("candidate_group_key"),
  CONSTRAINT "wdr_candidate_group_key_format"
    CHECK ("candidate_group_key" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "wdr_review_status_values"
    CHECK ("review_status" IN ('pending', 'approved_duplicate', 'rejected_distinct', 'on_hold')),
  CONSTRAINT "wdr_reviewer_note_length"
    CHECK ("reviewer_note" IS NULL OR char_length("reviewer_note") <= 500),
  CONSTRAINT "wdr_candidate_work_ids_is_array"
    CHECK (jsonb_typeof("candidate_work_ids") = 'array')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wdr_review_status_idx"      ON "work_dedup_reviews" ("review_status");
CREATE INDEX IF NOT EXISTS "wdr_algorithm_version_idx"  ON "work_dedup_reviews" ("algorithm_version");
CREATE INDEX IF NOT EXISTS "wdr_updated_at_idx"         ON "work_dedup_reviews" ("updated_at");
