ALTER TABLE "works" ADD COLUMN IF NOT EXISTS "og_image_url" text;
ALTER TABLE "works" ADD COLUMN IF NOT EXISTS "og_source_url" text;
ALTER TABLE "works" ADD COLUMN IF NOT EXISTS "og_image_fetched_at" timestamptz;
ALTER TABLE "works" ADD COLUMN IF NOT EXISTS "og_image_status" text;
ALTER TABLE "works" ADD COLUMN IF NOT EXISTS "og_image_error" text;
