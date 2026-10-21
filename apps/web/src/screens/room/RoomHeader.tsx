import { useState } from 'react';
import { puzzleImageInfo } from '../../board/images';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import type { FriendView } from '@puzzle/shared';
import { DIFFICULTY_NAMES, difficultyOf } from '../../ui/difficulty';
import logoUrl from '../../assets/logo.webp';
import { CheckIcon, HourglassIcon, LinkIcon, LogOutIcon } from '../../ui/icons';
import type { VoiceChat } from '../../voice/useVoiceChat';
import { VoiceMenu } from '../../voice/VoiceMenu';
import { GameClock } from '../GameClock';
import { InviteMenu } from './InviteMenu';

interface RoomHeaderProps {
  roomId: string;
  snapshot: RoomSnapshot;
  voice: VoiceChat;
  onLeave: () => void;
  /** Só para o dono da sala, durante a partida: grava no "Em andamento" e fecha a sala. */
  onSaveAndLeave?: () => void;
  /** Esperando o servidor gravar. */
  saving?: boolean;
  /** Logado: o "Convidar" também chama amigos online. */
  friends?: { list: FriendView[]; invite: (friendId: string) => Promise<void> };
}

/** Barra da sala: foto e sala à esquerda, tempo e progresso no meio, convite/som/sair à direita. */
export function RoomHeader({
  roomId,
  snapshot,
  voice,
  onLeave,
  onSaveAndLeave,
  saving = false,
  friends,
}: RoomHeaderProps) {
  const [copied, setCopied] = useState(false);
  const { imageId, pieceCount, pieces, placed, phase, elapsedMs, durationMs, maxPlayers, mode } =
    snapshot;
  const bullet = mode === 'bullet';
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
            {bullet ? (
              <>
                · Bullet · {snapshot.timeLimitMs / 60_000} min · {pieceCount} peças
              </>
            ) : mode === 'battle' ? (
              <>
                · Batalha {maxPlayers / 2}v{maxPlayers / 2} · {pieces} peças
              </>
            ) : (
              <>
                · {pieces} peças · {difficulty}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="room-progress">
        <span className="clock-pill">
          <GameClock
            phase={phase}
            elapsedMs={elapsedMs}
            durationMs={durationMs}
            limitMs={bullet ? snapshot.timeLimitMs : undefined}
          />
        </span>
        {bullet && (
          <span className="solved-pill" aria-label={`${snapshot.solved} montados`}>
            <strong>{snapshot.solved}</strong> {snapshot.solved === 1 ? 'montado' : 'montados'}
          </span>
        )}
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
            {friends ? (
              <InviteMenu roomId={roomId} friends={friends.list} onInvite={friends.invite} />
            ) : (
              <button
                type="button"
                className={copied ? 'btn reveal-btn revealed' : 'btn reveal-btn'}
                onClick={() => void copyInvite()}
              >
                {copied ? <CheckIcon size={18} /> : <LinkIcon size={18} />}
                <span className="reveal-label">{copied ? 'Link copiado!' : 'Convidar'}</span>
              </button>
            )}
            <VoiceMenu voice={voice} />
            <span className="bar-divider" aria-hidden="true" />
          </>
        )}
        {onSaveAndLeave && (
          <button
            type="button"
            className="btn"
            onClick={onSaveAndLeave}
            disabled={saving}
            title="Guarda a partida em Em andamento e encerra a sala para todos"
          >
            <HourglassIcon size={18} />
            {saving ? 'Salvando…' : 'Salvar e sair'}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onLeave}>
          <LogOutIcon size={18} />
          Sair
        </button>
      </div>
    </header>
  );
}
