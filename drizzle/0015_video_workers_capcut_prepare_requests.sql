-- 動画生成Worker（video_workers）に、管理画面から依頼したCapCut台本の準備（PERSON_REGISTRY未登録人物の
-- 人物ページ取得）を保存する列を追加。NULL許可の列追加のみ（既存行・既存テーブルは変更しない）。
ALTER TABLE video_workers ADD COLUMN IF NOT EXISTS capcut_prepare_requests JSONB;
