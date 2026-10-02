-- 動画生成ジョブ（/admin/video-maker）とWorker生存情報。新規テーブルの追加のみ（既存テーブルは変更しない）。
-- 本番適用は既存運用どおり /admin/db-init（CREATE TABLE IF NOT EXISTS）から行う。
CREATE TABLE IF NOT EXISTS video_generation_jobs (
  id                 TEXT PRIMARY KEY,
  batch_id           TEXT,
  retry_of_job_id    TEXT,
  person_name        TEXT NOT NULL,
  person_slug        TEXT,
  template_id        TEXT NOT NULL,
  template_version   INTEGER,
  narration_mode     TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'queued',
  attempts           INTEGER NOT NULL DEFAULT 0,
  progress_step      INTEGER,
  progress_total     INTEGER,
  progress_label     TEXT,
  worker_id          TEXT,
  heartbeat_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_step         TEXT,
  error_message      TEXT,
  video_url          TEXT,
  video_pathname     TEXT,
  video_size_bytes   INTEGER,
  duration_sec       DOUBLE PRECISION,
  qa_status          TEXT,
  qa_warnings        JSONB,
  qa_report          JSONB,
  post_texts         JSONB,
  narration_script   TEXT,
  result             JSONB,
  worker_export_dir  TEXT
);
CREATE INDEX IF NOT EXISTS vgj_status_created_at_idx ON video_generation_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS vgj_batch_id_idx ON video_generation_jobs (batch_id);
CREATE INDEX IF NOT EXISTS vgj_person_name_idx ON video_generation_jobs (person_name);
CREATE TABLE IF NOT EXISTS video_workers (
  worker_id     TEXT PRIMARY KEY,
  last_seen_at  TIMESTAMPTZ NOT NULL,
  version       TEXT,
  templates     JSONB NOT NULL DEFAULT '[]',
  persons       JSONB NOT NULL DEFAULT '[]',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
