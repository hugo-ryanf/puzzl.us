import { useState } from 'react';
import type { DevAction } from '@puzzle/shared';
import type { PuzzleRoom } from '../../net/connection';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';

/**
 * Atalhos de teste dentro da sala (só no `pnpm dev`; o build de produção nem inclui). O servidor
 * só obedece quando sobe com `pnpm dev:local` (--dev-tools).
 */
export function DevPanel({ room, snapshot }: { room: PuzzleRoom; snapshot: RoomSnapshot }) {
  const [open, setOpen] = useState(false);
  const { mode, timeLimitMs } = snapshot;
  const send = (action: DevAction, value?: number) => room.send('dev', { action, value });
  const timed = timeLimitMs > 0;

  const buttons: Array<[string, () => void, boolean]> = [
    ['Pular contagem', () => send('skipCountdown'), mode !== 'classic'],
    ['Montar este', () => send('solve'), true],
    ['Peças de pé', () => send('straighten'), true],
    ['Faltam 15 s', () => send('time', 15), timed],
    ['Faltam 5 s', () => send('time', 5), timed],
    ['Relâmpago agora', () => send('lightning'), mode !== 'classic'],
    ['Energia cheia', () => send('energy'), mode === 'battle'],
    ['Neblina em mim', () => send('fogMe'), mode === 'battle'],
    ['Congelar em mim', () => send('freezeMe'), mode === 'battle'],
  ];

  return (
    <div className="dev-panel">
      <button type="button" className="dev-panel-toggle" onClick={() => setOpen(!open)}>
        {open ? 'Fechar testes' : 'Testes'}
      </button>
      {open && (
        <div className="dev-panel-body">
          {buttons
            .filter(([, , shown]) => shown)
            .map(([label, onClick]) => (
              <button key={label} type="button" className="btn" onClick={onClick}>
                {label}
              </button>
            ))}
          <small>Só funciona com o servidor de `pnpm dev:local`.</small>
        </div>
      )}
    </div>
  );
}
