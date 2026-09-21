-- 管理画面 /admin/instagram-post のInstagram投稿履歴を記録する instagram_posts テーブル新設
-- 既存テーブルへの変更は一切なし（新規テーブル追加のみ）。
-- 本番適用は /api/admin/db-init (POST) 経由で行う（このファイルは記録・ローカル db:push 用）。

CREATE TABLE IF NOT EXISTS instagram_posts (
  id             SERIAL PRIMARY KEY,
  person_name    TEXT NOT NULL,
  media_id       TEXT NOT NULL,
  image_urls     JSONB NOT NULL DEFAULT '[]',
  caption        TEXT NOT NULL DEFAULT '',
  published_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ip_person_name_idx ON instagram_posts (person_name);
CREATE INDEX IF NOT EXISTS ip_published_at_idx ON instagram_posts (published_at);
