import { useState } from 'react';
import { puzzleImageInfo } from '../../board/images';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { DIFFICULTY_NAMES, difficultyOf } from '../../ui/difficulty';
import logoUrl from '../../assets/logo.webp';
import { CheckIcon, LinkIcon, LogOutIcon } from '../../ui/icons';
import type { VoiceChat } from '../../voice/useVoiceChat';
import { VoiceMenu } from '../../voice/VoiceMenu';
import { GameClock } from '../GameClock';

interface RoomHeaderProps {
  roomId: string;
  snapshot: RoomSnapshot;
  voice: VoiceChat;
  onLeave: () => void;
}

/** Barra da sala: foto e sala à esquerda, tempo e progresso no meio, convite/som/sair à direita. */
export function RoomHeader({ roomId, snapshot, voice, onLeave }: RoomHeaderProps) {
  const [copied, setCopied] = useState(false);
  const { imageId, pieceCount, pieces, placed, phase, elapsedMs, durationMs, maxPlayers } =
    snapshot;
  const solo = maxPlayers === 1;
  const title = puzzleImageInfo(imageId)?.title ?? 'Quebra-cabeça';
  const difficulty = DIFFICULTY_NAMES[difficultyOf(pieceCount) - 1];
  const percent = pieces > 0 ? Math.round((placed / pieces) * 100) : 0;

  async function copyInvite() {
    await navigator.clipboard.writeText(`${location.origin}/${roomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <header className="room-header">
      <div className="room-title">
        <img className="brand-logo" src={logoUrl} alt="" />
        <div>
          <h1>{title}</h1>
          <p>
            {solo ? (
              'Solo'
            ) : (
              <>
                Sala <span className="room-code">{roomId}</span>
              </>
            )}{' '}
            · {pieces} peças · {difficulty}
          </p>
        </div>
      </div>

      <div className="room-progress">
        <span className="clock-pill">
          <GameClock phase={phase} elapsedMs={elapsedMs} durationMs={durationMs} />
        </span>
        <div
          className="progress-bar"
          role="progressbar"
          aria-label="Peças encaixadas"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <strong className="progress-percent">{percent}%</strong>
        <span className="progress-count">
          {placed} de {pieces} peças
        </span>
      </div>

      <div className="room-actions">
        {/* Solo: sem convite nem chamada, só o "Sair". */}
        {!solo && (
          <>
            {/* Só o ícone; o nome aparece (o botão cresce) ao passar o mouse ou ao copiar. */}
            <button
              type="button"
              className={copied ? 'btn reveal-btn revealed' : 'btn reveal-btn'}
              onClick={() => void copyInvite()}
            >
              {copied ? <CheckIcon size={18} /> : <LinkIcon size={18} />}
              <span className="reveal-label">{copied ? 'Link copiado!' : 'Convidar'}</span>
            </button>
            <VoiceMenu voice={voice} />
            <span className="bar-divider" aria-hidden="true" />
          </>
        )}
        <button type="button" className="btn btn-ghost" onClick={onLeave}>
          <LogOutIcon size={18} />
          Sair
        </button>
      </div>
    </header>
  );
}
