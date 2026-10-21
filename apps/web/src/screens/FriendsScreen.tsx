import { useState, type FormEvent, type ReactNode } from 'react';
import type { FriendStatus, FriendView } from '@puzzle/shared';
import type { Friends } from '../net/friends';
import { CheckIcon, LinkIcon, PlusIcon } from '../ui/icons';

interface FriendsScreenProps {
  friends: Friends;
  signedIn: boolean;
  googleLogin: boolean;
  /** Código vindo de um link de amigo (/?amigo=K7QF-2M9D): já preenchido. */
  initialCode?: string;
}

const STATUS_LABELS: Record<FriendStatus, string> = {
  playing: 'Jogando',
  online: 'Online',
  offline: 'Offline',
};
/** Quem está jogando ou online aparece primeiro. */
const STATUS_ORDER: Record<FriendStatus, number> = { playing: 0, online: 1, offline: 2 };

export function FriendsScreen({ friends, signedIn, googleLogin, initialCode }: FriendsScreenProps) {
  const { data } = friends;
  const [code, setCode] = useState(initialCode ?? '');
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'code' | 'link'>();
  /** Amizade a desfazer, esperando a confirmação. */
  const [removing, setRemoving] = useState<string>();

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await friends.add(code);
      setCode('');
      setMessage({
        text:
          result === 'requested'
            ? 'Pedido enviado. Assim que aceitarem, a pessoa aparece aqui.'
            : result === 'accepted'
              ? 'Vocês agora são amigos!'
              : 'Vocês já são amigos.',
      });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  async function copy(what: 'code' | 'link') {
    if (!data) return;
    const text =
      what === 'code'
        ? data.friendCode
        : `${location.origin}/?amigo=${encodeURIComponent(data.friendCode)}`;
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(undefined), 2000);
  }

  const run = (action: () => Promise<void>) => () =>
    void action().catch((e: unknown) =>
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true }),
    );

  const sorted = [...(data?.friends ?? [])].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Amigos</h1>
          <p>Veja quem está online e chame para montar junto.</p>
        </div>
      </div>

      {!signedIn && (
        <div className="empty">
          <strong>Entre para ter amigos</strong>
          <p>Com a conta, você adiciona amigos pelo código e chama eles para a sua sala.</p>
          {googleLogin && (
            <a className="btn" href="/auth/google">
              Entrar com Google
            </a>
          )}
        </div>
      )}

      {signedIn && data && (
        <div className="friends-layout">
          <section className="friends-card">
            <h2>Seu código</h2>
            <p className="friend-code">{data.friendCode}</p>
            <div className="friends-actions">
              <button type="button" className="btn" onClick={() => void copy('code')}>
                {copied === 'code' ? <CheckIcon size={16} /> : null}
                {copied === 'code' ? 'Copiado!' : 'Copiar código'}
              </button>
              <button type="button" className="btn" onClick={() => void copy('link')}>
                {copied === 'link' ? <CheckIcon size={16} /> : <LinkIcon size={16} />}
                {copied === 'link' ? 'Link copiado!' : 'Copiar link'}
              </button>
            </div>

            <form className="friend-add" onSubmit={(event) => void add(event)}>
              <label className="field">
                Adicionar pelo código
                <input
                  className="input code-input"
                  value={code}
                  placeholder="K7QF-2M9D"
                  maxLength={9}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </label>
              <button type="submit" className="btn btn-primary" disabled={busy || !code.trim()}>
                <PlusIcon size={16} />
                Adicionar
              </button>
            </form>
            {message && (
              <p className={message.error ? 'error' : 'result-note'} role="status">
                {message.text}
              </p>
            )}
          </section>

          <div className="friends-lists">
            {data.incoming.length > 0 && (
              <FriendList title="Pedidos recebidos" people={data.incoming}>
                {(person) => (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={run(() => friends.remove(person.id))}
                    >
                      Recusar
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={run(() => friends.accept(person.id))}
                    >
                      Aceitar
                    </button>
                  </>
                )}
              </FriendList>
            )}

            <FriendList title={`Amigos (${sorted.length})`} people={sorted} showStatus>
              {(person) =>
                removing === person.id ? (
                  <>
                    <button type="button" className="btn" onClick={() => setRemoving(undefined)}>
                      Manter
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={run(() => friends.remove(person.id))}
                    >
                      Desfazer amizade
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setRemoving(person.id)}
                    aria-label={`Desfazer amizade com ${person.name}`}
                  >
                    Remover
                  </button>
                )
              }
            </FriendList>
            {sorted.length === 0 && (
              <p className="result-note">
                Ninguém ainda. Mande seu código (ou o link) e adicione o de quem joga com você.
              </p>
            )}

            {data.outgoing.length > 0 && (
              <FriendList title="Pedidos enviados" people={data.outgoing}>
                {(person) => (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={run(() => friends.remove(person.id))}
                  >
                    Cancelar
                  </button>
                )}
              </FriendList>
            )}
          </div>
        </div>
      )}
    </>
  );
}

interface FriendListProps {
  title: string;
  people: FriendView[];
  showStatus?: boolean;
  children: (person: FriendView) => ReactNode;
}

function FriendList({ title, people, showStatus = false, children }: FriendListProps) {
  if (people.length === 0 && !showStatus) return null;
  return (
    <section className="friends-section">
      <h2>{title}</h2>
      {people.length > 0 && (
        <ul className="friend-list">
          {people.map((person) => (
            <li key={person.id}>
              <FriendAvatar person={person} showStatus={showStatus} />
              <span className="friend-name">
                <strong>{person.name}</strong>
                {showStatus && <small>{STATUS_LABELS[person.status]}</small>}
              </span>
              <span className="friend-actions">{children(person)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Foto (ou inicial) com a bolinha do status no canto. */
export function FriendAvatar({
  person,
  showStatus = true,
}: {
  person: FriendView;
  showStatus?: boolean;
}) {
  return (
    <span className="friend-avatar">
      {person.avatarUrl ? (
        <img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span>{person.name.charAt(0).toUpperCase()}</span>
      )}
      {showStatus && (
        <span className={`status-dot ${person.status}`} aria-label={STATUS_LABELS[person.status]} />
      )}
    </span>
  );
}
