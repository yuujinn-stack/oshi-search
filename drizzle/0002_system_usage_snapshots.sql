CREATE TABLE IF NOT EXISTS "system_usage_snapshots" (
  "id"           serial PRIMARY KEY,
  "service"      text NOT NULL,
  "metric"       text NOT NULL,
  "value"        numeric NOT NULL,
  "unit"         text NOT NULL,
  "source"       text NOT NULL,
  "is_estimated" boolean NOT NULL DEFAULT false,
  "metadata"     jsonb,
  "recorded_at"  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "sus_service_metric_recorded_idx"
  ON "system_usage_snapshots" ("service", "metric", "recorded_at");

CREATE INDEX IF NOT EXISTS "sus_recorded_at_idx"
  ON "system_usage_snapshots" ("recorded_at");

-- Unique index to prevent duplicate hourly snapshots per (service, metric)
CREATE UNIQUE INDEX IF NOT EXISTS "sus_hourly_dedup_idx"
  ON "system_usage_snapshots" ("service", "metric", date_trunc('hour', "recorded_at" AT TIME ZONE 'UTC'));
