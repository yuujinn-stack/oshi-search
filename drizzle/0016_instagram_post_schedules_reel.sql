-- Instagram予約投稿（instagram_post_schedules）をReel（動画生成ジョブのig-reel.mp4）にも使えるよう列を追加（Phase R1b）。
-- 列の追加のみ（DROP・RENAME・既存データの変更なし）。既存行は media_type='CAROUSEL' になり、他の追加列はNULLのまま。
-- 同じ動画生成ジョブのReelはキャンセル以外で1件まで（二重予約防止の部分ユニークインデックス。既存行はすべてNULLのため対象外）。
ALTER TABLE instagram_post_schedules ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'CAROUSEL';
ALTER TABLE instagram_post_schedules ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE instagram_post_schedules ADD COLUMN IF NOT EXISTS video_generation_job_id TEXT;
ALTER TABLE instagram_post_schedules ADD COLUMN IF NOT EXISTS ig_container_id TEXT;
ALTER TABLE instagram_post_schedules ADD COLUMN IF NOT EXISTS container_created_at TIMESTAMPTZ;
ALTER TABLE instagram_post_schedules ADD COLUMN IF NOT EXISTS permalink TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ips_video_job_active_idx ON instagram_post_schedules (video_generation_job_id) WHERE video_generation_job_id IS NOT NULL AND status <> 'cancelled';
