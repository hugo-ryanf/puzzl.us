CREATE TABLE "saved_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"image_id" text NOT NULL,
	"piece_count" integer NOT NULL,
	"max_players" integer NOT NULL,
	"pieces" integer NOT NULL,
	"placed" integer NOT NULL,
	"elapsed_ms" integer NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_games" ADD CONSTRAINT "saved_games_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_games_owner_idx" ON "saved_games" USING btree ("owner_user_id","updated_at");