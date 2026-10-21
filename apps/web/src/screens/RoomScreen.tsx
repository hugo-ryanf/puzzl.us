import { useEffect, useState } from 'react';
import { CloseCode } from '@colyseus/sdk';
import { uploadIdOf, type RankingQuery } from '@puzzle/shared';
import { Board } from '../board/Board';
import { puzzleImageInfo } from '../board/images';
import { usePuzzleImage } from '../board/usePuzzleImage';
import { formatDuration } from '../format';
import type { Community } from '../net/community';
import { leaveRoom, rejoinRoom, type PuzzleRoom } from '../net/connection';
import { loadPlayerName } from '../net/playerName';
import { useRoomSnapshot, type RoomSnapshot } from '../net/useRoomSnapshot';
import { useVoiceChat } from '../voice/useVoiceChat';
import { CompletedModal } from './room/CompletedModal';
import { PlayerAvatars } from './room/PlayerAvatars';
import { RoomHeader } from './room/RoomHeader';

interface RoomScreenProps {
  room: PuzzleRoom;
  onLeave: (notice?: string) => void;
  /** Voltou para a mesma sala por uma conexão nova (o servidor reiniciou no meio do jogo). */
  onRejoin: (room: PuzzleRoom) => void;
  onShowRanking: (query: RankingQuery) => void;
  /** Logado: nome da conta e como publicar (a foto própria, no fim da partida). */
  account?: { name: string; publish: Community['publish'] };
}

export function RoomScreen({ room, onLeave, onRejoin, onShowRanking, account }: RoomScreenProps) {
  const snapshot = useRoomSnapshot(room);
  const solo = snapshot.maxPlayers === 1;
  // Solo não entra na chamada: não há com quem falar (e poupa a cota do LiveKit).
  const voice = useVoiceChat(room, !solo);
  const [reconnecting, setReconnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const isOwner = snapshot.ownerId !== '' && snapshot.ownerId === room.sessionId;

  const image = usePuzzleImage(snapshot.imageId);

  useEffect(() => {
    let unmounted = false;
    const handleDrop = () => setReconnecting(true);
    const handleReconnect = () => setReconnecting(false);
    // Saída voluntária (botão "Sair") chega aqui como CONSENTED e já foi tratada.
    const handleLeave = (code: number) => {
      if (code === CloseCode.CONSENTED) return;
      // Servidor reiniciou (deploy, queda) ou a reconexão automática desistiu: tenta voltar
      // pelo código, que restaura a sala do snapshot se for preciso.
      const name = room.state.players?.get(room.sessionId)?.name ?? loadPlayerName();
      setReconnecting(true);
      void rejoinRoom(room.roomId, name).then((rejoined) => {
        if (unmounted) {
          if (rejoined) leaveRoom(rejoined); // a pessoa clicou em "Sair" enquanto isso
        } else if (rejoined) {
          onRejoin(rejoined);
        } else {
          onLeave('Você foi desconectado da sala.');
        }
      });
    };
    room.onDrop(handleDrop);
    room.onReconnect(handleReconnect);
    room.onLeave(handleLeave);
    // O dono salvou: a sala fecha para todos (com CONSENTED, então o handleLeave não reage).
    const removeSaved = room.onMessage('saved', () => {
      const owner = room.state.ownerId === room.sessionId;
      leaveRoom(room);
      onLeave(
        owner
          ? 'Partida salva. Continue quando quiser em "Em andamento".'
          : 'Quem criou a sala salvou a partida para continuar depois.',
      );
    });
    const removeSaveFailed = room.onMessage('saveFailed', () => {
      setSaving(false);
      setSaveError(true);
    });
    return () => {
      unmounted = true;
      room.onDrop.remove(handleDrop);
      room.onReconnect.remove(handleReconnect);
      room.onLeave.remove(handleLeave);
      removeSaved();
      removeSaveFailed();
    };
  }, [room, onLeave, onRejoin]);

  function saveAndLeave() {
    setSaving(true);
    setSaveError(false);
    room.send('saveAndLeave');
  }

  function leave() {
    leaveRoom(room);
    onLeave();
  }

  return (
    <div className="room">
      <RoomHeader
        roomId={room.roomId}
        snapshot={snapshot}
        voice={voice}
        onLeave={leave}
        onSaveAndLeave={isOwner && snapshot.phase === 'playing' ? saveAndLeave : undefined}
        saving={saving}
      />
      {reconnecting && <div className="banner">Conexão caiu — reconectando…</div>}
      {saveError && <div className="banner">Não deu para salvar agora. Tente de novo.</div>}
      <div className="board-area">
        {image?.image ? (
          <Board room={room} image={image.image} phase={snapshot.phase} />
        ) : (
          <p className="board-loading">{image?.error ?? 'Carregando imagem…'}</p>
        )}
        {!solo && (
          <PlayerAvatars
            players={snapshot.players}
            selfId={room.sessionId}
            hostId={snapshot.hostId}
            voice={voice}
          />
        )}
        {snapshot.phase === 'lobby' && (
          <LobbyPanel
            snapshot={snapshot}
            isHost={snapshot.hostId === room.sessionId}
            onStart={() => room.send('start')}
          />
        )}
        {snapshot.phase === 'completed' && (
          <CompletedModal
            snapshot={snapshot}
            onShowRanking={onShowRanking}
            onLeave={leave}
            publisher={
              // Quem criou a sala (logado) é quem enviou a foto; o servidor confere de novo.
              // Já publicada, a partida entra no ranking e esta seção nem aparece.
              account && isOwner && uploadIdOf(snapshot.imageId)
                ? {
                    defaultAuthor: account.name,
                    publish: async (title, authorName) => {
                      await account.publish({
                        imageId: snapshot.imageId,
                        title,
                        authorName,
                        rights: true,
                      });
                    },
                  }
                : undefined
            }
          />
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
          {snapshot.pieceCount} peças · {snapshot.players.length} de {snapshot.maxPlayers} jogadores
        </p>
        {isHost ? (
          <>
            {snapshot.elapsedMs > 0 ? (
              <p>
                Partida retomada com {formatDuration(snapshot.elapsedMs)} de jogo. Chame quem estava
                e comece: o tempo continua de onde parou.
              </p>
            ) : (
              <p>
                Mande o convite e comece quando todo mundo tiver chegado. O tempo conta a partir
                daí.
              </p>
            )}
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
