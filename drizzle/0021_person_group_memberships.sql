-- 人物とグループの所属履歴（src/db/schema.ts personGroupMemberships）
-- 既存テーブルは変更しない。本番は /admin/db-init（POST）でも同じ文を実行する。
CREATE TABLE IF NOT EXISTS person_group_memberships (
  id              SERIAL PRIMARY KEY,
  person_name     TEXT NOT NULL,
  group_name      TEXT NOT NULL,
  activity_status TEXT NOT NULL,
  joined_at       TEXT,
  left_at         TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS pgm_person_group_idx ON person_group_memberships (person_name, group_name);
CREATE INDEX IF NOT EXISTS pgm_group_idx ON person_group_memberships (group_name);
