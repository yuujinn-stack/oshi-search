CREATE TABLE IF NOT EXISTS "batch_lock" (
	"lock_key"     text PRIMARY KEY NOT NULL,
	"owner_id"     text NOT NULL,
	"status"       text DEFAULT 'running' NOT NULL,
	"acquired_at"  timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"expires_at"   timestamp with time zone NOT NULL
);
