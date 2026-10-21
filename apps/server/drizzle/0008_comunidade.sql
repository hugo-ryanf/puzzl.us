CREATE TABLE "community_puzzles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" text NOT NULL,
	"title" text NOT NULL,
	"author_user_id" uuid NOT NULL,
	"author_name" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"mini" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_puzzles_upload_id_unique" UNIQUE("upload_id")
);
--> statement-breakpoint
CREATE TABLE "puzzle_reports" (
	"puzzle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "puzzle_reports_puzzle_id_user_id_pk" PRIMARY KEY("puzzle_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "community_puzzles" ADD CONSTRAINT "community_puzzles_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_puzzles" ADD CONSTRAINT "community_puzzles_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzle_reports" ADD CONSTRAINT "puzzle_reports_puzzle_id_community_puzzles_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."community_puzzles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "puzzle_reports" ADD CONSTRAINT "puzzle_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_puzzles_status_idx" ON "community_puzzles" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;