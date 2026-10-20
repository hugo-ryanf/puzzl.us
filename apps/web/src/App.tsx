import { useState, type ChangeEvent } from 'react';
import { PIECE_COUNT_PRESETS } from '@puzzle/shared';
import { Board } from './board/Board';
import type { Progress } from './board/BoardScene';
import { createSampleImage, loadImageFile } from './board/images';

const newSeed = () => Math.random().toString(36).slice(2, 10);

export function App() {
  const [image, setImage] = useState(() => createSampleImage());
  const [pieceCount, setPieceCount] = useState<number>(48);
  const [seed, setSeed] = useState(newSeed);
  const [progress, setProgress] = useState<Progress | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImage(await loadImageFile(file));
    setSeed(newSeed());
  }

  // Encaixes feitos = peças - grupos; o puzzle completo tem (peças - 1) encaixes.
  const percent = progress
    ? Math.round(((progress.pieces - progress.groups) / Math.max(1, progress.pieces - 1)) * 100)
    : 0;

  return (
    <div className="app">
      <header className="toolbar">
        <strong>Quebra-cabeça</strong>
        <label>
          Peças{' '}
          <select value={pieceCount} onChange={(e) => setPieceCount(Number(e.target.value))}>
            {PIECE_COUNT_PRESETS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <label className="file">
          Usar minha foto
          <input type="file" accept="image/*" onChange={handleFile} />
        </label>
        <button onClick={() => setSeed(newSeed())}>Embaralhar de novo</button>
        <span className="progress">
          {progress?.completed ? '🎉 Completo!' : `${percent}% montado`}
        </span>
        <span className="hint">
          arraste as peças · roda do mouse = zoom · arraste o fundo = mover
        </span>
      </header>
      <Board image={image} pieceCount={pieceCount} seed={seed} onProgress={setProgress} />
    </div>
  );
}
