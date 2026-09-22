-- Instagram投稿失敗・要確認通知機能（管理画面内通知）用の instagram_admin_notifications テーブル新設
-- 既存テーブル（instagram_post_schedules等）への変更は一切なし（新規テーブル追加のみ）。
-- 既読状態とInstagram投稿statusは完全に分離しており、このテーブルへの書き込みが
-- instagram_post_schedules側を変更することは一切ない。
-- 本番適用は /api/admin/db-init (POST) 経由で行う（このファイルは記録・ローカル db:push 用）。

CREATE TABLE IF NOT EXISTS instagram_admin_notifications (
  id           SERIAL PRIMARY KEY,
  schedule_id  INTEGER NOT NULL,
  event_key    TEXT NOT NULL,
  status       TEXT NOT NULL,
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ian_event_key_idx ON instagram_admin_notifications (event_key);
CREATE INDEX IF NOT EXISTS ian_schedule_id_idx ON instagram_admin_notifications (schedule_id);
CREATE INDEX IF NOT EXISTS ian_is_read_idx ON instagram_admin_notifications (is_read);
