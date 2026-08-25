-- 写真集機能: photobook_settings テーブル新設 + gender カラム追加
-- 本番適用は /api/admin/db-init (POST) 経由で行う（このファイルは記録・ローカル db:push 用）

CREATE TABLE IF NOT EXISTS photobook_settings (
  person_name            TEXT NOT NULL,
  product_id             TEXT NOT NULL,
  source_category        TEXT,
  status                 TEXT NOT NULL DEFAULT 'auto',
  published              BOOLEAN NOT NULL DEFAULT TRUE,
  home_state             TEXT NOT NULL DEFAULT 'auto',
  home_pinned_position   INTEGER,
  sort_order             INTEGER,
  dedup_group_override   TEXT,
  force_representative   BOOLEAN NOT NULL DEFAULT FALSE,
  note                   TEXT,
  updated_by             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (person_name, product_id)
);

CREATE INDEX IF NOT EXISTS pbs_status_idx ON photobook_settings (status);
CREATE INDEX IF NOT EXISTS pbs_home_state_idx ON photobook_settings (home_state);

ALTER TABLE person_meta ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE group_meta ADD COLUMN IF NOT EXISTS gender TEXT;
