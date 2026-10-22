ALTER TABLE "users" ADD COLUMN "nickname" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_style" text DEFAULT 'google' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_color" text;