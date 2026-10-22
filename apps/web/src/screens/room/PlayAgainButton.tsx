import type { PuzzleRoom } from '../../net/connection';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { ReplayIcon } from '../../ui/icons';

/**
 * "Jogar novamente": o anfitrião começa outra partida na mesma sala (todos continuam nela, e a
 * chamada também). Quem não é o anfitrião vê que é ele quem decide.
 */
export function PlayAgainButton({ room, snapshot }: { room: PuzzleRoom; snapshot: RoomSnapshot }) {
  if (snapshot.hostId !== room.sessionId) {
    return <span className="result-note">O anfitrião pode começar outra partida.</span>;
  }
  // Enquanto o resultado é gravado, ele ainda pertence a esta partida.
  const saving = snapshot.rankStatus === 'saving';
  return (
    <button type="button" className="btn" disabled={saving} onClick={() => room.send('playAgain')}>
      <ReplayIcon size={18} />
      Jogar novamente
    </button>
  );
}
