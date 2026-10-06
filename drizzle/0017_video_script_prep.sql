-- 動画生成「まず見る3作 ショートV1」の台本準備（管理画面から運用するためのテーブル2つ）。
-- 新しいテーブルの追加のみ（既存テーブル・既存行は変更しない）。本番適用は既存運用どおり /admin/db-init の CREATE_STATEMENTS から行う。
--
-- pronunciation_readings: 管理画面から登録した読み（CapCut音声生成用の読み台本で使う）。正本はこのテーブル。
--   oshi-video-makerの固定辞書（src/config/pronunciationDictionary.ts）が優先され、ここは固定辞書に無い語にだけ使われる。
--   source_text は台本に出てくる表記（作品名・人物名など）そのまま。reading はひらがな・カタカナ（空白・記号可）。
CREATE TABLE IF NOT EXISTS pronunciation_readings (
  id           SERIAL PRIMARY KEY,
  source_text  TEXT NOT NULL,
  reading      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS pronunciation_readings_source_text_idx ON pronunciation_readings (source_text);

-- video_script_requests: 管理画面からWorkerへの台本準備の依頼（全人物の台本準備・停止・人物ごとの再選定）。
--   Workerが生存報告で受け取り、処理したら handled_at を入れる（動画生成のジョブ video_generation_jobs とは別）。
CREATE TABLE IF NOT EXISTS video_script_requests (
  id            SERIAL PRIMARY KEY,
  template_id   TEXT NOT NULL,
  action        TEXT NOT NULL,
  person_name   TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handled_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS video_script_requests_pending_idx ON video_script_requests (handled_at, requested_at);
