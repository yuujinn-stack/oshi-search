-- 推し活サービスのアフィリエイト案件に「最終確認日時」（提携状況・広告素材を最後に確認した日時）を追加。
-- NULL 許可の列追加のみ（既存行・既存データは変更しない）。
-- 本番適用は /admin/db-init（POST /api/admin/db-init）経由で行う（このファイルは記録用）。
-- 公開ページの広告判定（getPublicOshikatsuAds）はこの列を読まないため、適用前でも公開ページは動く。

ALTER TABLE oshikatsu_affiliate_services ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;
