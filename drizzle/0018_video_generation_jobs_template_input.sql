-- 動画生成ジョブ（video_generation_jobs）に、テンプレート固有の入力を保存する列を追加。
-- 複数人物を1本の動画にするテンプレート（推しでサブスク比較 ショートV1: 人物3人のslug）だけが使い、
-- 既存のテンプレート・既存のジョブは NULL のまま（既存行の書き換え・backfill・index・制約の変更なし）。
-- 例: {"version":1,"personSlugs":["p-0123456789ab","p-...","p-..."]}
-- 本番適用は既存運用どおり /admin/db-init（CREATE_STATEMENTS）から行う。
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS template_input JSONB;
