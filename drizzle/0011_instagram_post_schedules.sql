-- Instagram予約投稿（/admin/instagram-schedule）用の instagram_post_schedules テーブル新設
-- 既存テーブルへの変更は一切なし（新規テーブル追加のみ）。
-- 本番適用は /api/admin/db-init (POST) 経由で行う（このファイルは記録・ローカル db:push 用）。

CREATE TABLE IF NOT EXISTS instagram_post_schedules (
  id                     SERIAL PRIMARY KEY,
  person_id              TEXT NOT NULL,
  person_name            TEXT NOT NULL,
  template_id            TEXT NOT NULL DEFAULT 'default-person',
  scheduled_at           TIMESTAMPTZ NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'draft',
  caption                TEXT NOT NULL DEFAULT '',
  hashtags               TEXT NOT NULL DEFAULT '',
  image_urls             JSONB NOT NULL DEFAULT '[]',
  media_id               TEXT,
  published_at           TIMESTAMPTZ,
  error_message          TEXT,
  attempts               INTEGER NOT NULL DEFAULT 0,
  processing_started_at  TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ips_status_scheduled_at_idx ON instagram_post_schedules (status, scheduled_at);
CREATE INDEX IF NOT EXISTS ips_person_id_idx ON instagram_post_schedules (person_id);
