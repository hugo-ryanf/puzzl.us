CREATE TABLE "battle_result_players" (
	"result_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"team" text NOT NULL,
	CONSTRAINT "battle_result_players_result_id_player_id_pk" PRIMARY KEY("result_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "battle_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_code" text NOT NULL,
	"format" text NOT NULL,
	"timed" boolean NOT NULL,
	"winner" text NOT NULL,
	"walkover" boolean DEFAULT false NOT NULL,
	"comeback" boolean DEFAULT false NOT NULL,
	"finished_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "battle_result_players" ADD CONSTRAINT "battle_result_players_result_id_battle_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."battle_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battle_result_players" ADD CONSTRAINT "battle_result_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "battle_result_players_player_idx" ON "battle_result_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "battle_results_finished_idx" ON "battle_results" USING btree ("finished_at");