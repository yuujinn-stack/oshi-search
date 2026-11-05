-- 推し活サービス（グッズ制作・グッズ買取・ファッションレンタル）のアフィリエイト管理:
-- oshikatsu_affiliate_services / oshikatsu_affiliate_creatives テーブル新設。
-- 既存テーブル（VODアフィリエイトの affiliate_* を含む）への変更は一切なし（新規テーブル追加のみ）。
-- 本番適用は /admin/db-init（POST /api/admin/db-init）経由で行う（このファイルは記録用）。

CREATE TABLE IF NOT EXISTS oshikatsu_affiliate_services (
  id                  SERIAL PRIMARY KEY,
  service_key         TEXT NOT NULL,
  service_name        TEXT NOT NULL,
  category            TEXT NOT NULL,
  asp_id              TEXT NOT NULL,
  program_id          TEXT,
  official_url        TEXT NOT NULL,
  partnership_status  TEXT NOT NULL DEFAULT 'pending',
  is_ad_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS oas_service_key_idx ON oshikatsu_affiliate_services (service_key);
CREATE INDEX IF NOT EXISTS oas_category_idx ON oshikatsu_affiliate_services (category);

CREATE TABLE IF NOT EXISTS oshikatsu_affiliate_creatives (
  id          SERIAL PRIMARY KEY,
  service_id  INTEGER NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  ad_html     TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS oac_service_id_idx ON oshikatsu_affiliate_creatives (service_id);
