import { useEffect, useRef, type CSSProperties } from 'react';
import type { VideoTrack } from 'livekit-client';
import type { PlayerView } from '../../net/useRoomSnapshot';
import {
  CrownIcon,
  MicIcon,
  MicOffIcon,
  VideoOffIcon,
  VolumeIcon,
  VolumeXIcon,
} from '../../ui/icons';
import { Popover } from '../../ui/Popover';
import type { VoiceChat } from '../../voice/useVoiceChat';

interface PlayerAvatarsProps {
  players: PlayerView[];
  selfId: string;
  hostId: string;
  voice: VoiceChat;
}

/** Tudo que o círculo e o quadro de vídeo precisam saber de um jogador. */
interface PlayerInfo {
  player: PlayerView;
  isSelf: boolean;
  isHost: boolean;
  isInCall: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
  /** Volume com que EU ouço essa pessoa (0–1). */
  volume: number;
  silencedForMe: boolean;
  video?: VideoTrack;
  status: string;
}

/** "Ana Clara" → "AC"; "bia" → "B". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return (
    (words[0]?.[0] ?? '') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

/** Texto escuro em cores claras (amarelo, verde-claro), branco nas escuras: contraste legível. */
function textColorFor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  return luminance > 0.4 ? '#15171c' : '#ffffff';
}

/**
 * Jogadores no canto direito da mesa. Sem câmera, cada um é só um círculo (iniciais na cor
 * dele) com as opções num painel ao passar o mouse; com câmera, vira um quadro de vídeo
 * empilhado logo abaixo, com as opções de som por cima do vídeo ao passar o mouse.
 */
export function PlayerAvatars({ players, selfId, hostId, voice }: PlayerAvatarsProps) {
  const { inCall, muted, speaking, video } = voice.peers;

  const infos = players.map((player): PlayerInfo => {
    const id = player.sessionId;
    const isSelf = id === selfId;
    const isInCall = inCall.has(id);
    const isMuted = muted.has(id);
    const isSpeaking = isInCall && !isMuted && speaking.has(id);
    const volume = voice.peerVolume(id);
    return {
      player,
      isSelf,
      isHost: id === hostId,
      isInCall,
      isMuted,
      isSpeaking,
      volume,
      silencedForMe: !isSelf && volume === 0,
      video: video.get(id),
      status: !player.connected
        ? 'Reconectando…'
        : !isInCall
          ? 'Fora da chamada'
          : isMuted
            ? 'Microfone desligado'
            : isSpeaking
              ? 'Falando'
              : 'Na chamada',
    };
  });
  const circles = infos.filter((info) => !info.video);
  const tiles = infos.filter((info) => info.video);

  return (
    <div className="people" role="group" aria-label="Jogadores na sala">
      {circles.length > 0 && (
        <ul className="avatars">
          {circles.map((info) => (
            <li key={info.player.sessionId}>
              <AvatarCircle info={info} voice={voice} />
            </li>
          ))}
        </ul>
      )}
      {tiles.length > 0 && (
        <ul className="video-tiles">
          {tiles.map((info) => (
            <li key={info.player.sessionId}>
              <VideoTile info={info} voice={voice} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AvatarCircle({ info, voice }: { info: PlayerInfo; voice: VoiceChat }) {
  const { player, isSelf, isHost, isInCall, isMuted, isSpeaking, volume, silencedForMe } = info;
  const classes = ['avatar', isSpeaking && 'speaking', !player.connected && 'offline']
    .filter(Boolean)
    .join(' ');

  return (
    <Popover
      label={`Opções de ${player.name}`}
      triggerLabel={`${player.name}${isSelf ? ' (você)' : ''}${isHost ? ', anfitrião' : ''}: ${info.status}`}
      triggerClassName={classes}
      openOnHover
      trigger={
        <>
          <span
            className="avatar-face"
            style={{ background: player.color, color: textColorFor(player.color) }}
          >
            {initials(player.name)}
          </span>
          {isHost && (
            <span className="avatar-badge top">
              <CrownIcon size={11} />
            </span>
          )}
          {(isInCall && isMuted) || silencedForMe ? (
            <span className="avatar-badge bottom">
              {silencedForMe ? <VolumeXIcon size={11} /> : <MicOffIcon size={11} />}
            </span>
          ) : null}
        </>
      }
    >
      <div className="player-card">
        <strong>
          {player.name}
          {isSelf && ' (você)'}
        </strong>
        <span className="player-status">
          {isHost && 'Anfitrião · '}
          {info.status}
        </span>
      </div>

      {isSelf && isInCall && (
        <button type="button" className="btn btn-block" onClick={voice.toggleMute}>
          {isMuted ? 'Ligar meu microfone' : 'Desligar meu microfone'}
        </button>
      )}

      {!isSelf && isInCall && (
        <>
          <button
            type="button"
            className="btn btn-block"
            onClick={() => voice.togglePeerMuted(player.sessionId)}
          >
            {silencedForMe ? 'Voltar a ouvir' : 'Silenciar para mim'}
          </button>
          <div className="volume-row">
            <button
              type="button"
              className="btn icon-btn"
              aria-label="Abaixar volume"
              onClick={() => voice.setPeerVolume(player.sessionId, volume - 0.1)}
            >
              −
            </button>
            <VolumeSlider info={info} voice={voice} />
            <button
              type="button"
              className="btn icon-btn"
              aria-label="Aumentar volume"
              onClick={() => voice.setPeerVolume(player.sessionId, volume + 0.1)}
            >
              +
            </button>
            <span className="volume-value">{Math.round(volume * 100)}%</span>
          </div>
          <p className="popover-note">O volume só muda para você.</p>
        </>
      )}
      {!isSelf && !isInCall && (
        <p className="popover-note">
          Volume e silenciar aparecem quando {player.name} entrar na chamada.
        </p>
      )}
    </Popover>
  );
}

/**
 * Quadro de vídeo de quem está com a câmera ligada. Nome sempre à vista; ao passar o mouse (ou
 * com o foco do teclado) aparecem as opções: dos outros, silenciar e volume (só para mim); no
 * meu, microfone e desligar a câmera.
 */
function VideoTile({ info, voice }: { info: PlayerInfo; voice: VoiceChat }) {
  const { player, isSelf, isHost, isMuted, isSpeaking, volume, silencedForMe } = info;
  const classes = ['video-tile', isSpeaking && 'speaking', !player.connected && 'offline']
    .filter(Boolean)
    .join(' ');

  return (
    <figure className={classes} style={{ '--player-color': player.color } as CSSProperties}>
      <CameraVideo track={info.video!} mirrored={isSelf} />
      <figcaption className="tile-name">
        {isHost && <CrownIcon size={12} />}
        <span>
          {player.name}
          {isSelf && ' (você)'}
        </span>
        {isMuted && <MicOffIcon size={12} />}
        {silencedForMe && <VolumeXIcon size={12} />}
      </figcaption>

      <div className="tile-controls">
        {isSelf ? (
          <>
            <button
              type="button"
              className="tile-btn"
              aria-label={isMuted ? 'Ligar o microfone' : 'Desligar o microfone'}
              title={isMuted ? 'Ligar o microfone' : 'Desligar o microfone'}
              onClick={voice.toggleMute}
            >
              {isMuted ? <MicOffIcon size={16} /> : <MicIcon size={16} />}
            </button>
            <button
              type="button"
              className="tile-btn"
              aria-label="Desligar a câmera"
              title="Desligar a câmera"
              onClick={voice.toggleCamera}
            >
              <VideoOffIcon size={16} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="tile-btn"
              aria-label={
                silencedForMe
                  ? `Voltar a ouvir ${player.name}`
                  : `Silenciar ${player.name} para mim`
              }
              title={silencedForMe ? 'Voltar a ouvir' : 'Silenciar para mim'}
              onClick={() => voice.togglePeerMuted(player.sessionId)}
            >
              {silencedForMe ? <VolumeXIcon size={16} /> : <VolumeIcon size={16} />}
            </button>
            <VolumeSlider info={info} voice={voice} />
            <span className="tile-volume">{Math.round(volume * 100)}%</span>
          </>
        )}
      </div>
    </figure>
  );
}

function VolumeSlider({ info, voice }: { info: PlayerInfo; voice: VoiceChat }) {
  const { player, volume } = info;
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={5}
      value={Math.round(volume * 100)}
      aria-label={`Volume de ${player.name} (só para você)`}
      onChange={(e) => voice.setPeerVolume(player.sessionId, Number(e.target.value) / 100)}
    />
  );
}

/** Vídeo da câmera. O meu aparece espelhado, como num espelho de verdade. */
function CameraVideo({ track, mirrored }: { track: VideoTrack; mirrored: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current!;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);
  return (
    <video
      ref={ref}
      className={mirrored ? 'tile-video mirrored' : 'tile-video'}
      muted // o som vem pela faixa de áudio (com volume e "silenciar"), não pelo vídeo
      playsInline
      autoPlay
    />
  );
}
