/** Tamanhos oferecidos na criação da sala (nº aproximado de peças). */
export const PIECE_COUNT_PRESETS = [24, 48, 100, 300, 500, 1000] as const;

export type PieceCountPreset = (typeof PIECE_COUNT_PRESETS)[number];

/** Quanto uma peça pode fugir do quadrado (largura / altura) para acertar melhor o total. */
const MAX_PIECE_ASPECT_DEVIATION = 1.25;

export interface Grid {
  rows: number;
  cols: number;
}

/**
 * Escolhe linhas×colunas com total próximo de `targetPieces` mantendo as peças
 * quase quadradas para uma imagem de proporção `aspectRatio` (largura / altura).
 */
export function gridForPieceCount(targetPieces: number, aspectRatio: number): Grid {
  if (!Number.isFinite(targetPieces) || targetPieces < 4) {
    throw new RangeError(`targetPieces deve ser >= 4 (recebido ${targetPieces})`);
  }
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new RangeError(`aspectRatio deve ser > 0 (recebido ${aspectRatio})`);
  }

  // Com peças quadradas, cols / rows ≈ aspectRatio ⇒ rows ≈ sqrt(target / aspect).
  const idealRows = Math.sqrt(targetPieces / aspectRatio);
  let best: Grid | undefined;
  let bestScore = { countDiff: Infinity, squareness: Infinity };

  // Testamos uma vizinhança pequena em volta do ideal: ±1 linha e ±1 coluna.
  const minRows = Math.max(2, Math.floor(idealRows) - 1);
  const maxRows = Math.ceil(idealRows) + 1;

  for (let rows = minRows; rows <= maxRows; rows++) {
    const idealCols = rows * aspectRatio;
    const minCols = Math.max(2, Math.floor(idealCols) - 1);
    const maxCols = Math.ceil(idealCols) + 1;

    for (let cols = minCols; cols <= maxCols; cols++) {
      const pieceAspect = (aspectRatio * rows) / cols;
      // 1 = peça quadrada; 1.25 = 25% mais larga (ou alta) do que deveria.
      const squareness = Math.max(pieceAspect, 1 / pieceAspect);
      if (squareness > MAX_PIECE_ASPECT_DEVIATION) continue;

      const countDiff = Math.abs(rows * cols - targetPieces);
      const isBetter =
        countDiff < bestScore.countDiff ||
        (countDiff === bestScore.countDiff && squareness < bestScore.squareness);
      if (isBetter) {
        best = { rows, cols };
        bestScore = { countDiff, squareness };
      }
    }
  }

  // Só acontece com proporções extremas (panorâmicas); aí aceitamos peças esticadas.
  return (
    best ?? {
      rows: Math.max(2, Math.round(idealRows)),
      cols: Math.max(2, Math.round(idealRows * aspectRatio)),
    }
  );
}
