-- VODアフィリエイト広告管理機能: affiliate_programs / affiliate_creatives / affiliate_placements テーブル新設
-- 既存テーブルへの変更は一切なし（新規テーブル追加のみ）。
-- 本番適用は /api/admin/db-init (POST) 経由で行う（このファイルは記録・ローカル db:push 用）。

CREATE TABLE IF NOT EXISTS affiliate_programs (
  id                       SERIAL PRIMARY KEY,
  vod_service              TEXT NOT NULL,
  asp_name                 TEXT NOT NULL,
  program_name             TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'active',
  rules_note               TEXT,
  direct_url_allowed       BOOLEAN NOT NULL DEFAULT TRUE,
  custom_creative_allowed  BOOLEAN NOT NULL DEFAULT TRUE,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ap_vod_service_idx ON affiliate_programs (vod_service);
CREATE INDEX IF NOT EXISTS ap_is_active_idx ON affiliate_programs (is_active);

CREATE TABLE IF NOT EXISTS affiliate_creatives (
  id               SERIAL PRIMARY KEY,
  program_id       INTEGER NOT NULL,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL,
  raw_code         TEXT,
  destination_url  TEXT,
  image_url        TEXT,
  alt_text         TEXT,
  width            INTEGER,
  height           INTEGER,
  device           TEXT NOT NULL DEFAULT 'all',
  priority         INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ac_program_id_idx ON affiliate_creatives (program_id);
CREATE INDEX IF NOT EXISTS ac_is_active_idx ON affiliate_creatives (is_active);

CREATE TABLE IF NOT EXISTS affiliate_placements (
  id           SERIAL PRIMARY KEY,
  creative_id  INTEGER NOT NULL,
  slot_key     TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS apl_creative_id_idx ON affiliate_placements (creative_id);
CREATE INDEX IF NOT EXISTS apl_slot_key_idx ON affiliate_placements (slot_key);
