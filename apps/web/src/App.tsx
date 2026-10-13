import { useEffect, useState } from 'react';
import { PIECE_COUNT_PRESETS, gridForPieceCount } from '@puzzle/shared';

type ServerStatus = 'checando' | 'online' | 'offline';

export function App() {
  const [status, setStatus] = useState<ServerStatus>('checando');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setStatus(res.ok ? 'online' : 'offline'))
      .catch(() => setStatus('offline'));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Quebra-cabeça</h1>
      <p>Servidor: {status}</p>
      <h2>Tamanhos (imagem 16:9)</h2>
      <ul>
        {PIECE_COUNT_PRESETS.map((pieces) => {
          const { rows, cols } = gridForPieceCount(pieces, 16 / 9);
          return (
            <li key={pieces}>
              {pieces} peças → {rows} × {cols} = {rows * cols}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
