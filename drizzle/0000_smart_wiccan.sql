CREATE TABLE "group_meta" (
	"group_name" text PRIMARY KEY NOT NULL,
	"slug" text DEFAULT '' NOT NULL,
	"activity_status" text DEFAULT 'unknown' NOT NULL,
	"formed_at" text,
	"ended_at" text,
	"renamed_from" text,
	"renamed_to" text,
	"former_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"official_site" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_meta" (
	"person_name" text PRIMARY KEY NOT NULL,
	"activity_status" text,
	"generation" text,
	"titles" jsonb,
	"current_group_name" text,
	"joined_at" text,
	"left_at" text,
	"former_group_names" jsonb,
	"membership_note" text,
	"primary_genre" text,
	"genres" jsonb,
	"public_roles" jsonb,
	"awards" jsonb,
	"career_status" text,
	"role_note" text,
	"memo" text,
	"priority" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"name" text PRIMARY KEY NOT NULL,
	"group_name" text DEFAULT '' NOT NULL,
	"genre" text DEFAULT '坂道' NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tmdb_person_id" integer,
	"description" text,
	"source" text DEFAULT 'static' NOT NULL,
	"data_fetch_status" text DEFAULT 'not_started' NOT NULL,
	"last_data_fetched_at" timestamp with time zone,
	"data_fetch_error" text,
	"imported_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"person_name" text NOT NULL,
	"category" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "products_person_name_category_pk" PRIMARY KEY("person_name","category")
);
--> statement-breakpoint
CREATE TABLE "verdicts" (
	"person_name" text NOT NULL,
	"product_id" text NOT NULL,
	"verdict" text NOT NULL,
	"score" numeric DEFAULT '0' NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"prompt_version" text,
	"judged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verdicts_person_name_product_id_pk" PRIMARY KEY("person_name","product_id")
);
--> statement-breakpoint
CREATE TABLE "vod_providers" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"logo_url" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" text PRIMARY KEY NOT NULL,
	"person_name" text NOT NULL,
	"title" text NOT NULL,
	"original_title" text,
	"normalized_title" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"tmdb_id" integer,
	"source" text NOT NULL,
	"release_year" integer,
	"role_name" text,
	"overview" text,
	"poster_url" text,
	"confidence_score" numeric DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'needs_review' NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"checked_at" timestamp with time zone,
	"ai_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"vod_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "products_person_name_idx" ON "products" USING btree ("person_name");--> statement-breakpoint
CREATE INDEX "verdicts_person_name_idx" ON "verdicts" USING btree ("person_name");--> statement-breakpoint
CREATE INDEX "works_person_name_idx" ON "works" USING btree ("person_name");--> statement-breakpoint
CREATE INDEX "works_status_idx" ON "works" USING btree ("status");