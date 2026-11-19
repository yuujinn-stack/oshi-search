-- サイト全体の表示設定（作品画像の表示方式など）。key ごとに1行。
-- 行が無い・テーブルが未作成のときはアプリ側の既定値（従来どおりの表示）で動く。
CREATE TABLE IF NOT EXISTS site_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
