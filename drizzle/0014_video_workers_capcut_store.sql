-- 動画生成Worker（video_workers）に、CapCut保存済み音声の状態（人物×テンプレート）を保存する列を追加。
-- NULL許可の列追加のみ（既存行・既存テーブルは変更しない）。本番適用は既存運用どおり /admin/db-init の ALTER_STATEMENTS から行う。
ALTER TABLE video_workers ADD COLUMN IF NOT EXISTS capcut_store JSONB;
