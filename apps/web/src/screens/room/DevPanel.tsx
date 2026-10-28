import { useState } from 'react';
import type { DevAction } from '@puzzle/shared';
import type { PuzzleRoom } from '../../net/connection';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';

type Button = { label: string; action: DevAction; value?: number; shown?: boolean };

/**
 * Atalhos de teste dentro da sala (só no `pnpm dev`; o build de produção nem inclui). O servidor
 * só obedece quando sobe com `pnpm dev:local` (--dev-tools). Agrupados pelo que manipulam.
 */
export function DevPanel({ room, snapshot }: { room: PuzzleRoom; snapshot: RoomSnapshot }) {
  const [open, setOpen] = useState(false);
  const [seconds, setSeconds] = useState(15);
  const [slideSeconds, setSlideSeconds] = useState(5);
  const { mode, timeLimitMs } = snapshot;
  const send = (action: DevAction, value?: number) => room.send('dev', { action, value });
  const timed = timeLimitMs > 0;
  const bullet = mode === 'bullet';
  const battle = mode === 'battle';
  const classic = mode === 'classic';

  const groups: Array<{ title: string; shown: boolean; buttons: Button[] }> = [
    {
      title: 'Contagem',
      shown: !classic,
      buttons: [
        { label: 'Recomeçar 3, 2, 1', action: 'restartCountdown' },
        { label: 'Pular contagem', action: 'skipCountdown' },
      ],
    },
    {
      title: 'Tempo',
      shown: timed,
      buttons: [
        { label: 'Faltam 30 s', action: 'time', value: 30 },
        { label: 'Faltam 10 s', action: 'time', value: 10 },
        { label: 'Faltam 3 s', action: 'time', value: 3 },
        { label: '+5 s (bônus)', action: 'bonus', shown: bullet },
        { label: 'Morte súbita agora', action: 'suddenDeath', shown: battle },
        { label: 'Acabar agora', action: 'endNow' },
      ],
    },
    {
      title: 'Mesa',
      shown: true,
      buttons: [
        { label: 'Montar a minha', action: 'solve' },
        { label: 'Adversário monta', action: 'solveThem', shown: battle },
        { label: 'Peças de pé', action: 'straighten' },
        { label: 'Combo +1', action: 'combo', shown: !classic },
        { label: '+1 Ímã', action: 'helper', shown: bullet },
        { label: 'Acabar (meu lado ganha)', action: 'endNow', shown: battle && !timed },
      ],
    },
    {
      title: 'Relâmpago',
      shown: !classic,
      buttons: [
        { label: 'Relâmpago agora', action: 'lightning' },
        { label: 'Montar o relâmpago', action: 'slideSolve' },
      ],
    },
    {
      title: 'Poderes (batalha)',
      shown: battle,
      buttons: [
        { label: 'Energia cheia', action: 'energy' },
        { label: 'Escudo em mim', action: 'shieldMe' },
        { label: 'Neblina em mim', action: 'fogMe' },
        { label: 'Congelar em mim', action: 'freezeMe' },
        { label: 'Neblina neles', action: 'fogThem' },
        { label: 'Congelar neles', action: 'freezeThem' },
      ],
    },
  ];

  return (
    <div className="dev-panel">
      <button type="button" className="dev-panel-toggle" onClick={() => setOpen(!open)}>
        {open ? 'Fechar testes' : 'Testes'}
      </button>
      {open && (
        <div className="dev-panel-body">
          <p className="dev-panel-state">
            {snapshot.phase}
            {snapshot.countdown > 0 && ` · contagem ${snapshot.countdown}`}
            {timed && ` · faltam ${Math.ceil(snapshot.remainingMs / 1000)} s`}
            {snapshot.paused && ' · pausado (relâmpago)'}
          </p>
          {groups
            .filter((group) => group.shown)
            .map((group) => (
              <fieldset key={group.title} className="dev-panel-group">
                <legend>{group.title}</legend>
                {group.buttons
                  .filter((button) => button.shown !== false)
                  .map((button) => (
                    <button
                      key={button.label}
                      type="button"
                      className="btn"
                      onClick={() => send(button.action, button.value)}
                    >
                      {button.label}
                    </button>
                  ))}
                {group.title === 'Tempo' && (
                  <label className="dev-panel-input">
                    Faltam
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      value={seconds}
                      onChange={(event) => setSeconds(Number(event.target.value))}
                    />
                    s
                    <button type="button" className="btn" onClick={() => send('time', seconds)}>
                      Aplicar
                    </button>
                  </label>
                )}
                {group.title === 'Relâmpago' && battle && (
                  <label className="dev-panel-input">
                    Prazo
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={slideSeconds}
                      onChange={(event) => setSlideSeconds(Number(event.target.value))}
                    />
                    s
                    <button
                      type="button"
                      className="btn"
                      onClick={() => send('slideTime', slideSeconds)}
                    >
                      Aplicar
                    </button>
                  </label>
                )}
              </fieldset>
            ))}
          <small>Só funciona com o servidor de `pnpm dev:local`.</small>
        </div>
      )}
    </div>
  );
}
