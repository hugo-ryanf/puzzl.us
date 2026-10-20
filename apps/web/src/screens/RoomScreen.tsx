import { useEffect, useState } from 'react';
import { CloseCode } from '@colyseus/sdk';
import type { RankingQuery } from '@puzzle/shared';
import { Board } from '../board/Board';
import { puzzleImageInfo } from '../board/images';
import { usePuzzleImage } from '../board/usePuzzleImage';
import { formatDuration } from '../format';
import { leaveRoom, type PuzzleRoom } from '../net/connection';
import { useRoomSnapshot, type RoomSnapshot } from '../net/useRoomSnapshot';
import { useVoiceChat } from '../voice/useVoiceChat';
import { VoiceControls } from '../voice/VoiceControls';
import { GameClock } from './GameClock';

interface RoomScreenProps {
  room: PuzzleRoom;
  onLeave: (notice?: string) => void;
  onShowRanking: (query: RankingQuery) => void;
}

export function RoomScreen({ room, onLeave, onShowRanking }: RoomScreenProps) {
  const snapshot = useRoomSnapshot(room);
  const voice = useVoiceChat(room);
  const [reconnecting, setReconnecting] = useState(false);
  const [copied, setCopied] = useState(false);

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

  async function copyInvite() {
    await navigator.clipboard.writeText(`${location.origin}/${room.roomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function leave() {
    leaveRoom(room);
    onLeave();
  }

  // Encaixes feitos = peças - grupos; o puzzle completo tem (peças - 1) encaixes.
  const percent = Math.round(
    ((snapshot.pieces - snapshot.groups) / Math.max(1, snapshot.pieces - 1)) * 100,
  );

  return (
    <div className="app">
      <header className="toolbar">
        <strong>Quebra-cabeça</strong>
        <span className="room-code" title="Código da sala">
          {room.roomId}
        </span>
        <button onClick={copyInvite}>{copied ? 'Link copiado!' : 'Copiar convite'}</button>
        <ul className="players">
          {snapshot.players.map((player) => {
            const { inCall, muted, speaking } = voice.peers;
            const isSpeaking = speaking.has(player.sessionId) && !muted.has(player.sessionId);
            return (
              <li key={player.sessionId} className={player.connected ? '' : 'offline'}>
                {/* currentColor = cor do jogador, usada no anel de "está falando". */}
                <span
                  className={isSpeaking ? 'dot speaking' : 'dot'}
                  style={{ background: player.color, color: player.color }}
                />
                {player.name}
                {player.sessionId === snapshot.hostId && ' 👑'}
                {player.sessionId === room.sessionId && ' (você)'}
                {inCall.has(player.sessionId) && (
                  <span title={muted.has(player.sessionId) ? 'Mudo' : 'Na chamada'}>
                    {muted.has(player.sessionId) ? ' 🔇' : ' 🎤'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <VoiceControls voice={voice} />
        <GameClock
          phase={snapshot.phase}
          elapsedMs={snapshot.elapsedMs}
          durationMs={snapshot.durationMs}
        />
        <span className="progress">{percent}% montado</span>
        <button className="leave" onClick={leave}>
          Sair
        </button>
      </header>
      {reconnecting && <div className="banner">Conexão caiu — reconectando…</div>}
      <div className="board-area">
        {image?.image ? (
          <Board room={room} image={image.image} />
        ) : (
          <p className="board-loading">{image?.error ?? 'Carregando imagem…'}</p>
        )}
        {snapshot.phase === 'lobby' && (
          <LobbyPanel
            snapshot={snapshot}
            isHost={snapshot.hostId === room.sessionId}
            onStart={() => room.send('start')}
          />
        )}
        {snapshot.phase === 'completed' && (
          <CompletedPanel snapshot={snapshot} onShowRanking={onShowRanking} onLeave={leave} />
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
            <button className="primary" onClick={onStart}>
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

interface CompletedPanelProps {
  snapshot: RoomSnapshot;
  onShowRanking: (query: RankingQuery) => void;
  onLeave: () => void;
}

function CompletedPanel({ snapshot, onShowRanking, onLeave }: CompletedPanelProps) {
  const { imageId, teamSize, pieceCount, rankStatus, rank } = snapshot;
  const category = `${pieceCount} peças · ${teamSize === 1 ? 'solo' : `${teamSize} jogadores`}`;
  return (
    <div className="overlay completed">
      <div className="panel">
        <h2>🎉 Montado em {formatDuration(snapshot.durationMs)}</h2>
        <ImageCaption imageId={imageId} />
        <p>{category}</p>
        {rankStatus === 'saving' && <p>Registrando no ranking…</p>}
        {rankStatus === 'saved' && (
          <p className="rank">
            <strong>{rank}º lugar</strong> no ranking da categoria
          </p>
        )}
        {rankStatus === 'unavailable' && <p>O ranking está indisponível neste servidor.</p>}
        {rankStatus === 'unranked' && (
          <p>Foto própria: fica fora do ranking (cada foto é única).</p>
        )}
        <div className="actions">
          {rankStatus === 'saved' && (
            <button
              className="primary"
              onClick={() =>
                onShowRanking({ image: imageId, pieces: pieceCount, players: teamSize })
              }
            >
              Ver ranking
            </button>
          )}
          <button onClick={onLeave}>Voltar ao início</button>
        </div>
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
