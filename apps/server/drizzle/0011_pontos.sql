ALTER TABLE "games" ADD COLUMN "points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Partidas de antes dos pontos: valem as peças (fator 1x).
UPDATE "games" SET "points" = "piece_count";
