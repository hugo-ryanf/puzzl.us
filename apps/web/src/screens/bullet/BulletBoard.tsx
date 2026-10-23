import { useEffect, useRef, useState } from 'react';
import { Board } from '../../board/Board';
import { usePuzzleImage } from '../../board/usePuzzleImage';
import type { PuzzleRoom } from '../../net/connection';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { ComboBurst } from '../room/ComboBurst';
import { FinalSeconds } from '../room/FinalSeconds';
import { BonusBurst, LightningBanner, MagnetButton } from './BulletExtras';

/** Quanto tempo o "+1" fica na tela depois de cada quebra-cabeça montado. */
const CHEER_MS = 1200;

/**
 * Mesa do Bullet: o tabuleiro da vez. A cada quebra-cabeça novo (`round`) a mesa é montada do
 * zero, com a foto nova (carrega enquanto a anterior ainda mostra a foto montada).
 */
export function BulletBoard({ room, snapshot }: { room: PuzzleRoom; snapshot: RoomSnapshot }) {
  const image = usePuzzleImage(snapshot.imageId);
  const board = room.state.boards.get('main');
  const [cheer, setCheer] = useState(0);
  const lastSolved = useRef(snapshot.solved);

  // Montou mais um: um "+1" rápido no meio da mesa.
  useEffect(() => {
    if (snapshot.solved <= lastSolved.current) return;
    lastSolved.current = snapshot.solved;
    setCheer(snapshot.solved);
    const timer = setTimeout(() => setCheer(0), CHEER_MS);
    return () => clearTimeout(timer);
  }, [snapshot.solved]);

  return (
    <>
      {image?.image && board ? (
        <Board
          // Quebra-cabeça novo = cena nova (peças, textura e câmera do zero).
          key={snapshot.round}
          room={room}
          image={image.image}
          phase={snapshot.phase}
          source={board}
          boardKey="main"
        />
      ) : (
        <p className="board-loading">{image?.error ?? 'Carregando o próximo…'}</p>
      )}
      {cheer > 0 && (
        <div className="bullet-cheer" aria-live="polite">
          +1 <small>{cheer === 1 ? '1 montado' : `${cheer} montados`}</small>
        </div>
      )}
      <ComboBurst
        combo={snapshot.players.find((p) => p.sessionId === room.sessionId)?.combo ?? 0}
      />
      <BonusBurst bonusMs={snapshot.bonusMs} />
      {snapshot.phase === 'playing' && snapshot.boards.main?.lightning && <LightningBanner />}
      {snapshot.phase === 'playing' && <MagnetButton room={room} snapshot={snapshot} />}
      <FinalSeconds snapshot={snapshot} />
    </>
  );
}
