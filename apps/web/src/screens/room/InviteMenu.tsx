import { useState } from 'react';
import type { FriendView } from '@puzzle/shared';
import { CheckIcon, LinkIcon } from '../../ui/icons';
import { Popover } from '../../ui/Popover';
import { FriendAvatar } from '../FriendsScreen';
import { t } from '../../i18n';

interface InviteMenuProps {
  roomId: string;
  /** Amigos aceitos (o menu mostra só quem está online ou jogando). */
  friends: FriendView[];
  onInvite: (friendId: string) => Promise<void>;
}

/** "Convidar" de quem está logado: copiar o link ou chamar um amigo online direto. */
export function InviteMenu({ roomId, friends, onInvite }: InviteMenuProps) {
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>();
  const online = friends.filter((friend) => friend.status !== 'offline');

  async function copyInvite() {
    await navigator.clipboard.writeText(`${location.origin}/${roomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function invite(friend: FriendView) {
    setError(undefined);
    try {
      await onInvite(friend.id);
      setSent((previous) => new Set(previous).add(friend.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Popover
      label={t('Convidar')}
      triggerClassName="btn reveal-btn"
      trigger={
        <>
          <LinkIcon size={18} />
          <span className="reveal-label">{t('Convidar')}</span>
        </>
      }
    >
      <button type="button" className="btn btn-block" onClick={() => void copyInvite()}>
        {copied ? <CheckIcon size={16} /> : <LinkIcon size={16} />}
        {copied ? t('Link copiado!') : t('Copiar link da sala')}
      </button>
      <p className="popover-note">{t('Amigos online')}</p>
      {online.length === 0 ? (
        <p className="popover-note">{t('Nenhum amigo online agora.')}</p>
      ) : (
        <ul className="invite-list">
          {online.map((friend) => (
            <li key={friend.id}>
              <FriendAvatar person={friend} />
              <span className="friend-name">
                <strong>{friend.name}</strong>
                <small>{friend.status === 'playing' ? t('Jogando') : 'Online'}</small>
              </span>
              <button
                type="button"
                className="btn"
                disabled={sent.has(friend.id)}
                onClick={() => void invite(friend)}
              >
                {sent.has(friend.id) ? t('Chamado') : t('Chamar')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="popover-note error">{error}</p>}
    </Popover>
  );
}
