CREATE TABLE "room_snapshots" (
	"room_code" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "room_snapshots_updated_idx" ON "room_snapshots" USING btree ("updated_at");