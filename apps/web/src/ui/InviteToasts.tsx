import { useState } from 'react';
import type { InviteMessage } from '@puzzle/shared';
import { puzzleImageInfo, puzzleThumbUrl } from '../board/images';
import { CloseIcon } from './icons';
import { t, tRich } from '../i18n';

interface InviteToastsProps {
  invites: InviteMessage[];
  onAccept: (invite: InviteMessage) => Promise<void>;
  onDismiss: (invite: InviteMessage) => void;
}

/** Avisos de convite no canto da tela, por cima de tudo (no Explorar ou dentro de outra sala). */
export function InviteToasts({ invites, onAccept, onDismiss }: InviteToastsProps) {
  const [joining, setJoining] = useState<InviteMessage>();
  if (invites.length === 0) return null;

  return (
    <div className="toasts" role="region" aria-label={t('Convites')}>
      {invites.map((invite) => {
        const title = puzzleImageInfo(invite.imageId)?.title ?? t('um quebra-cabeça');
        return (
          <div key={`${invite.fromId}:${invite.roomCode}`} className="toast" role="alert">
            <img src={puzzleThumbUrl(invite.imageId)} alt="" />
            <div className="toast-body">
              <p>
                {tRich('{name} te chamou para montar {title}', {
                  name: <strong>{invite.fromName}</strong>,
                  title: <strong>{title}</strong>,
                })}
              </p>
              <div className="toast-actions">
                <button type="button" className="btn" onClick={() => onDismiss(invite)}>
                  {t('Agora não')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={joining !== undefined}
                  onClick={() => {
                    setJoining(invite);
                    void onAccept(invite).finally(() => setJoining(undefined));
                  }}
                >
                  {joining === invite ? t('Entrando…') : t('Entrar')}
                </button>
              </div>
            </div>
            <button
              type="button"
              className="tool icon-only toast-close"
              aria-label={t('Fechar convite')}
              onClick={() => onDismiss(invite)}
            >
              <CloseIcon size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
