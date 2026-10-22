import { useEffect, useState, type FormEvent } from 'react';
import {
  AVATAR_COLORS,
  levelOf,
  levelStart,
  type AvatarStyle,
  type PublicProfile,
} from '@puzzle/shared';
import type { Account } from '../net/account';
import type { Friends } from '../net/friends';
import { Avatar } from '../ui/UserAvatar';
import { CheckIcon, LinkIcon, PlusIcon } from '../ui/icons';

interface ProfileScreenProps {
  /** Código de amigo do perfil aberto (o próprio, quando é "Perfil" do menu). */
  code: string;
  account: Account;
  friends: Friends;
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

/**
 * Perfil: avatar, nickname, bio e estatísticas. O próprio perfil tem o formulário de edição; o
 * de outra pessoa, o botão de adicionar como amigo.
 */
export function ProfileScreen({ code, account, friends }: ProfileScreenProps) {
  const [profile, setProfile] = useState<PublicProfile | null>();
  const [copied, setCopied] = useState(false);
  const [friendError, setFriendError] = useState<string>();

  useEffect(() => {
    let current = true;
    fetch(`/api/profiles/${encodeURIComponent(code)}`)
      .then((response) => (response.ok ? (response.json() as Promise<PublicProfile>) : null))
      .then((data) => current && setProfile(data))
      .catch(() => current && setProfile(null));
    return () => {
      current = false;
    };
    // Busca de novo depois de editar o perfil (ou entrar/sair) e sempre que a lista de amigos
    // muda, aqui ou do outro lado (pedido aceito, desfeito…): a relação mostrada acompanha.
  }, [code, account.user, friends.data]);

  if (profile === undefined) return <p className="loading">Carregando…</p>;
  if (profile === null) {
    return (
      <div className="empty">
        <strong>Perfil não encontrado</strong>
        <p>Confira o código do link.</p>
      </div>
    );
  }

  const isMe = profile.relation === 'me';
  const { stats } = profile;
  const level = levelOf(stats.pointsAll);
  const levelFrom = levelStart(level);
  const levelTo = levelStart(level + 1);

  async function copyLink() {
    await navigator.clipboard.writeText(`${location.origin}/perfil/${profile!.friendCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function addFriend() {
    setFriendError(undefined);
    try {
      await friends.add(profile!.friendCode);
    } catch (e) {
      setFriendError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="profile">
      <section className="profile-card">
        <Avatar
          name={profile.name}
          url={profile.avatarUrl}
          color={profile.avatarColor}
          size={96}
          className="profile-avatar"
        />
        <div className="profile-who">
          <h1>
            {profile.name}
            <span className="level-chip">Nv {level}</span>
          </h1>
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
          <p className="profile-meta">
            Joga desde {dateFormat.format(new Date(profile.memberSince))} · código{' '}
            <span className="profile-code">{profile.friendCode}</span>
          </p>
          <div className="profile-level">
            <span className="profile-level-label">
              <strong>Nível {level}</strong>
              <span>
                {(stats.pointsAll - levelFrom).toLocaleString('pt-BR')} /{' '}
                {(levelTo - levelFrom).toLocaleString('pt-BR')} pts para o nível {level + 1}
              </span>
            </span>
            <span className="profile-level-bar" aria-hidden="true">
              <span
                style={{
                  width: `${((stats.pointsAll - levelFrom) / (levelTo - levelFrom)) * 100}%`,
                }}
              />
            </span>
          </div>
        </div>
        <div className="profile-actions">
          <button type="button" className="btn" onClick={() => void copyLink()}>
            {copied ? <CheckIcon size={16} /> : <LinkIcon size={16} />}
            {copied ? 'Link copiado!' : 'Copiar link do perfil'}
          </button>
          {profile.relation === 'none' && (
            <button type="button" className="btn btn-primary" onClick={() => void addFriend()}>
              <PlusIcon size={16} />
              Adicionar amigo
            </button>
          )}
          {profile.relation === 'pending' && (
            <span className="profile-relation">Pedido de amizade pendente</span>
          )}
          {profile.relation === 'friend' && (
            <span className="profile-relation">
              <CheckIcon size={16} /> Vocês são amigos
            </span>
          )}
          {profile.relation === 'guest' && account.googleLogin && (
            <a className="btn" href="/auth/google">
              Entrar para adicionar
            </a>
          )}
          {friendError && <p className="error">{friendError}</p>}
        </div>
      </section>

      <section className="profile-stats" aria-label="Estatísticas">
        <Stat label="Quebra-cabeças montados" value={stats.puzzles} />
        <Stat label="Fotos diferentes" value={stats.images} />
        <Stat label="Peças encaixadas" value={stats.pieces} />
        <Stat label="Pontos na semana" value={stats.pointsWeek} />
        <Stat label="Pontos no total" value={stats.pointsAll} />
        <Stat label="Sequência" value={stats.streak} unit={stats.streak === 1 ? 'dia' : 'dias'} />
        <Stat label="Melhor Bullet" value={stats.bulletBest} unit="montados" />
        <Stat label="Amigos" value={stats.friends} />
      </section>

      {isMe && account.user && <ProfileForm account={account} />}
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="profile-stat">
      <span className="profile-stat-value">
        {value.toLocaleString('pt-BR')}
        {unit && <small> {unit}</small>}
      </span>
      <span className="profile-stat-label">{label}</span>
    </div>
  );
}

/** Editar o próprio perfil: nickname, bio e avatar (foto do Google ou iniciais numa cor). */
function ProfileForm({ account }: { account: Account }) {
  const user = account.user!;
  const [nickname, setNickname] = useState(user.name);
  const [bio, setBio] = useState(user.bio ?? '');
  const [style, setStyle] = useState<AvatarStyle>(
    user.googleAvatarUrl ? user.avatarStyle : 'initials',
  );
  const [color, setColor] = useState<string | null>(user.avatarColor);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      await account.updateProfile({
        nickname,
        bio,
        avatarStyle: style,
        avatarColor: color as (typeof AVATAR_COLORS)[number] | null,
      });
      setMessage({ text: 'Perfil salvo.' });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="profile-form" onSubmit={(event) => void save(event)}>
      <h2>Editar perfil</h2>

      <fieldset className="profile-avatar-choice">
        <legend>Avatar</legend>
        {user.googleAvatarUrl && (
          <label className="avatar-option">
            <input
              type="radio"
              name="avatar-style"
              className="sr-only"
              checked={style === 'google'}
              onChange={() => setStyle('google')}
            />
            <Avatar name={nickname || user.name} url={user.googleAvatarUrl} size={56} />
            Foto do Google
          </label>
        )}
        <label className="avatar-option">
          <input
            type="radio"
            name="avatar-style"
            className="sr-only"
            checked={style === 'initials'}
            onChange={() => setStyle('initials')}
          />
          <Avatar name={nickname || user.name} color={color} size={56} />
          Iniciais
        </label>
      </fieldset>

      {style === 'initials' && (
        <fieldset className="profile-colors">
          <legend>Cor das iniciais</legend>
          <label className="color-swatch auto">
            <input
              type="radio"
              name="avatar-color"
              className="sr-only"
              checked={color === null}
              onChange={() => setColor(null)}
            />
            Automática
          </label>
          {AVATAR_COLORS.map((value) => (
            <label key={value} className="color-swatch" style={{ background: value }}>
              <input
                type="radio"
                name="avatar-color"
                className="sr-only"
                aria-label={`Cor ${value}`}
                checked={color === value}
                onChange={() => setColor(value)}
              />
              {color === value && <CheckIcon size={16} />}
            </label>
          ))}
        </fieldset>
      )}

      <label className="field">
        Nickname
        <input
          className="input"
          value={nickname}
          minLength={2}
          maxLength={20}
          required
          onChange={(e) => setNickname(e.target.value)}
        />
        <small className="field-hint">
          É o nome nas salas e no ranking. No Google você é {user.googleName}.
        </small>
      </label>

      <label className="field">
        Bio
        <textarea
          className="input profile-bio-input"
          value={bio}
          maxLength={120}
          rows={2}
          placeholder="Uma frase sobre você (opcional)"
          onChange={(e) => setBio(e.target.value)}
        />
        <small className="field-hint">{bio.length}/120</small>
      </label>

      {message && (
        <p className={message.error ? 'error' : 'result-note'} role="status">
          {message.text}
        </p>
      )}
      <div className="profile-form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || nickname.trim().length < 2}
        >
          {busy ? 'Salvando…' : 'Salvar perfil'}
        </button>
      </div>
    </form>
  );
}
