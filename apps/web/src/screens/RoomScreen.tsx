import { useEffect, useState } from 'react';
import { CloseCode } from '@colyseus/sdk';
import type { RankingQuery } from '@puzzle/shared';
import { Board } from '../board/Board';
import { puzzleImageInfo } from '../board/images';
import { usePuzzleImage } from '../board/usePuzzleImage';
import { leaveRoom, type PuzzleRoom } from '../net/connection';
import { useRoomSnapshot, type RoomSnapshot } from '../net/useRoomSnapshot';
import { useVoiceChat } from '../voice/useVoiceChat';
import { CompletedModal } from './room/CompletedModal';
import { PlayerAvatars } from './room/PlayerAvatars';
import { RoomHeader } from './room/RoomHeader';

interface RoomScreenProps {
  room: PuzzleRoom;
  onLeave: (notice?: string) => void;
  onShowRanking: (query: RankingQuery) => void;
}

export function RoomScreen({ room, onLeave, onShowRanking }: RoomScreenProps) {
  const snapshot = useRoomSnapshot(room);
  const voice = useVoiceChat(room);
  const [reconnecting, setReconnecting] = useState(false);

  const image = usePuzzleImage(snapshot.imageId);

  useEffect(() => {
    const handleDrop = () => setReconnecting(true);
    const handleReconnect = () => setReconnecting(false);
    // Saída voluntária (botão "Sair") chega aqui como CONSENTED e já foi tratada.
    const handleLeave = (code: number) => {
      if (code !== CloseCode.CONSENTED) onLeave('Você foi desconectado da sala.');
    };
    room.onDrop(handleDrop);
    room.onReconnect(handleReconnect);
    room.onLeave(handleLeave);
    return () => {
      room.onDrop.remove(handleDrop);
      room.onReconnect.remove(handleReconnect);
      room.onLeave.remove(handleLeave);
    };
  }, [room, onLeave]);

  function leave() {
    leaveRoom(room);
    onLeave();
  }

  return (
    <div className="room">
      <RoomHeader roomId={room.roomId} snapshot={snapshot} voice={voice} onLeave={leave} />
      {reconnecting && <div className="banner">Conexão caiu — reconectando…</div>}
      <div className="board-area">
        {image?.image ? (
          <Board room={room} image={image.image} phase={snapshot.phase} />
        ) : (
          <p className="board-loading">{image?.error ?? 'Carregando imagem…'}</p>
        )}
        <PlayerAvatars
          players={snapshot.players}
          selfId={room.sessionId}
          hostId={snapshot.hostId}
          voice={voice}
        />
        {snapshot.phase === 'lobby' && (
          <LobbyPanel
            snapshot={snapshot}
            isHost={snapshot.hostId === room.sessionId}
            onStart={() => room.send('start')}
          />
        )}
        {snapshot.phase === 'completed' && (
          <CompletedModal snapshot={snapshot} onShowRanking={onShowRanking} onLeave={leave} />
        )}
      </div>
    </div>
  );
}

interface LobbyPanelProps {
  snapshot: RoomSnapshot;
  isHost: boolean;
  onStart: () => void;
}

function LobbyPanel({ snapshot, isHost, onStart }: LobbyPanelProps) {
  const hostName = snapshot.players.find((p) => p.sessionId === snapshot.hostId)?.name;
  return (
    <div className="overlay">
      <div className="panel">
        <h2>Sala de espera</h2>
        <ImageCaption imageId={snapshot.imageId} />
        <p>
          {snapshot.pieceCount} peças · {snapshot.players.length}{' '}
          {snapshot.players.length === 1 ? 'jogador' : 'jogadores'}
        </p>
        {isHost ? (
          <>
            <p>
              Mande o convite e comece quando todo mundo tiver chegado. O tempo conta a partir daí.
            </p>
            <button type="button" className="btn btn-primary btn-lg" onClick={onStart}>
              Começar
            </button>
          </>
        ) : (
          <p>Esperando {hostName ?? 'o anfitrião'} começar…</p>
        )}
      </div>
    </div>
  );
}

/** Título da foto e crédito (atribuição exigida por licenças como a do Unsplash). */
function ImageCaption({ imageId }: { imageId: string }) {
  const image = puzzleImageInfo(imageId);
  if (!image) return null;
  return (
    <p className="caption">
      <strong>{image.title}</strong>
      {image.credit && <span className="credit"> · {image.credit}</span>}
    </p>
  );
}
