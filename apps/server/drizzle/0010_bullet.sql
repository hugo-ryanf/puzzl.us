CREATE TABLE "bullet_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_code" text NOT NULL,
	"minutes" integer NOT NULL,
	"piece_count" integer NOT NULL,
	"team_size" integer NOT NULL,
	"team_key" text NOT NULL,
	"solved" integer NOT NULL,
	"partial" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bullet_runs_category_idx" ON "bullet_runs" USING btree ("minutes","piece_count","team_size","finished_at");