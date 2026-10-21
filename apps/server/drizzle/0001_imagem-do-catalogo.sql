DROP INDEX "games_ranking_idx";--> statement-breakpoint
-- Editado à mão: partidas da fase 3 (imagem gerada por código) ficam com 'gerada'; depois o
-- padrão é removido para toda partida nova ter que informar a imagem (igual ao schema).
ALTER TABLE "games" ADD COLUMN "image_id" text DEFAULT 'gerada' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "image_id" DROP DEFAULT;--> statement-breakpoint
CREATE INDEX "games_ranking_idx" ON "games" USING btree ("image_id","piece_count","team_size","duration_ms");
