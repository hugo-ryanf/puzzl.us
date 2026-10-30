import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  AVATAR_COLORS,
  AVATAR_PRESETS,
  avatarPresetUrl,
  levelOf,
  levelStart,
  type AvatarPreset,
  type AvatarStyle,
  type ProfileStats,
  type PublicProfile,
} from '@puzzle/shared';
import type { Account } from '../net/account';
import type { Friends } from '../net/friends';
import { ACCENTS, applyAccent, loadAccent, saveAccent, type AccentChoice } from '../ui/accent';
import { Avatar } from '../ui/UserAvatar';
import {
  BoltIcon,
  CheckIcon,
  FlameIcon,
  GridIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  PuzzleIcon,
  StarIcon,
  SwordsIcon,
  TrophyIcon,
  UsersIcon,
} from '../ui/icons';
import { formatNumber, locale, t, tRich } from '../i18n';

interface ProfileScreenProps {
  /** Código de amigo do perfil aberto (o próprio, quando é "Perfil" do menu). */
  code: string;
  account: Account;
  friends: Friends;
  /** "Ver no ranking" do melhor Bullet. */
  onShowBulletRanking?: () => void;
  /** "Amigos" no próprio perfil abre a lista. */
  onOpenFriends?: () => void;
}

const dateFormat = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
/** Os dias da barrinha da sequência (a conquista é uma semana seguida). */
const STREAK_GOAL = 7;
const PIECES_GOAL = 100;
/** Vitórias seguidas na batalha para a conquista. */
const WIN_STREAK_GOAL = 5;
const PRESET_NAMES: Record<AvatarPreset, string> = {
  petroleo: t('Petróleo'),
  gelo: t('Gelo'),
  verde: t('Verde'),
  ouro: t('Ouro'),
  ambar: t('Âmbar'),
  vermelho: t('Vermelho'),
  rosa: t('Rosa'),
  roxo: t('Roxo'),
};

/**
 * Perfil: cabeçalho com avatar, nível e código de amigo; "Visão geral" com os números e as
 * conquistas. O próprio perfil tem a aba "Editar perfil"; o de outra pessoa, o botão de
 * adicionar como amigo.
 */
export function ProfileScreen({
  code,
  account,
  friends,
  onShowBulletRanking,
  onOpenFriends,
}: ProfileScreenProps) {
  const [profile, setProfile] = useState<PublicProfile | null>();
  const [tab, setTab] = useState<'overview' | 'edit'>('overview');
  const [copied, setCopied] = useState<'link' | 'code'>();
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

  if (profile === undefined) return <p className="loading">{t('Carregando…')}</p>;
  if (profile === null) {
    return (
      <div className="empty">
        <strong>{t('Perfil não encontrado')}</strong>
        <p>{t('Confira o código do link.')}</p>
      </div>
    );
  }

  const isMe = profile.relation === 'me' && !!account.user;
  const editing = isMe && tab === 'edit';
  const { stats } = profile;
  const level = levelOf(stats.pointsAll);
  const levelFrom = levelStart(level);
  const levelSize = levelStart(level + 1) - levelFrom;
  const levelDone = stats.pointsAll - levelFrom;
  const levelPct = Math.round((levelDone / levelSize) * 100);

  async function copy(what: 'link' | 'code') {
    const text =
      what === 'link' ? `${location.origin}/perfil/${profile!.friendCode}` : profile!.friendCode;
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(undefined), 2000);
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
      <section className="profile-card" aria-labelledby="profile-name">
        <div className="profile-head">
          {/* O anel em volta do avatar é o progresso do nível. */}
          <span
            className="profile-ring"
            aria-hidden="true"
            style={{ '--level-deg': `${levelPct * 3.6}deg` } as CSSProperties}
          >
            <Avatar
              name={profile.name}
              url={profile.avatarUrl}
              color={profile.avatarColor}
              size={96}
              className="profile-avatar"
            />
            <span className="profile-level-badge">{t('Nv {level}', { level })}</span>
          </span>
          <div className="profile-who">
            <h1 id="profile-name">{profile.name}</h1>
            <p className="profile-meta">
              {/* O nome do Google só para a própria pessoa: o perfil público mostra o nickname. */}
              {isMe
                ? t('{google} · joga desde {date}', {
                    google: account.user!.googleName,
                    date: dateFormat.format(new Date(profile.memberSince)),
                  })
                : t('Joga desde {date}', {
                    date: dateFormat.format(new Date(profile.memberSince)),
                  })}
            </p>
            {profile.bio ? (
              <p className="profile-bio">{profile.bio}</p>
            ) : (
              isMe && (
                <button type="button" className="profile-add-bio" onClick={() => setTab('edit')}>
                  {t('Adicionar uma bio')}
                </button>
              )
            )}
          </div>
          <div className="profile-actions">
            <button type="button" className="btn" onClick={() => void copy('link')}>
              {copied === 'link' ? <CheckIcon size={16} /> : <LinkIcon size={16} />}
              {copied === 'link' ? t('Link copiado') : t('Copiar link do perfil')}
            </button>
            {isMe && !editing && (
              <button type="button" className="btn btn-primary" onClick={() => setTab('edit')}>
                <PencilIcon size={16} />
                {t('Editar perfil')}
              </button>
            )}
            {profile.relation === 'none' && (
              <button type="button" className="btn btn-primary" onClick={() => void addFriend()}>
                <PlusIcon size={16} />
                {t('Adicionar amigo')}
              </button>
            )}
            {profile.relation === 'pending' && (
              <span className="profile-relation">{t('Pedido de amizade pendente')}</span>
            )}
            {profile.relation === 'friend' && (
              <span className="profile-relation">
                <CheckIcon size={16} /> {t('Vocês são amigos')}
              </span>
            )}
            {profile.relation === 'guest' && account.googleLogin && (
              <a className="btn btn-primary" href="/auth/google">
                {t('Entrar para adicionar')}
              </a>
            )}
            {friendError && <p className="error">{friendError}</p>}
          </div>
        </div>

        <div className="profile-strip">
          <div className="profile-level">
            <div className="profile-level-label">
              <span>
                <strong>{t('Nível {level}', { level })}</strong>{' '}
                {t('· faltam {points} pts para o nível {level}', {
                  points: formatNumber(levelSize - levelDone),
                  level: level + 1,
                })}
              </span>
              <span className="profile-mono">
                {levelDone}/{levelSize}
              </span>
            </div>
            <div
              className="profile-level-bar"
              role="progressbar"
              aria-label={t('Progresso do nível')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={levelPct}
            >
              <span style={{ width: `${levelPct}%` }} />
            </div>
          </div>
          <div className="profile-code">
            {t('Código de amigo')}
            <button
              type="button"
              className="profile-code-btn"
              aria-label={t('Copiar código de amigo {code}', { code: profile.friendCode })}
              onClick={() => void copy('code')}
            >
              {profile.friendCode}
              <span>{copied === 'code' ? t('Copiado') : t('Copiar')}</span>
            </button>
          </div>
        </div>

        {isMe && (
          <div className="profile-tabs" role="tablist" aria-label={t('Seções do perfil')}>
            <button
              type="button"
              role="tab"
              aria-selected={!editing}
              onClick={() => setTab('overview')}
            >
              {t('Visão geral')}
            </button>
            <button type="button" role="tab" aria-selected={editing} onClick={() => setTab('edit')}>
              {t('Editar perfil')}
            </button>
          </div>
        )}
      </section>

      {editing ? (
        <ProfileForm account={account} onDone={() => setTab('overview')} />
      ) : (
        <Overview
          stats={stats}
          onShowBulletRanking={onShowBulletRanking}
          onOpenFriends={isMe ? onOpenFriends : undefined}
        />
      )}
    </div>
  );
}

function Overview({
  stats,
  onShowBulletRanking,
  onOpenFriends,
}: {
  stats: ProfileStats;
  onShowBulletRanking?: () => void;
  onOpenFriends?: () => void;
}) {
  const streakDays = Math.min(stats.streak, STREAK_GOAL);
  const streakHint = stats.playedToday
    ? t('Jogue amanhã para manter')
    : stats.streak > 0
      ? t('Jogue hoje para manter')
      : t('Jogue hoje para começar');
  const badges = achievements(stats);
  const unlocked = badges.filter((badge) => badge.pct >= 100).length;

  return (
    <>
      <div className="profile-highlights">
        <div className="profile-highlight">
          <span className="profile-highlight-label">
            <StarIcon size={16} />
            {t('Pontos no total')}
          </span>
          <span className="profile-big">{formatNumber(stats.pointsAll)}</span>
          <span className={stats.pointsWeek > 0 ? 'profile-gain' : 'profile-hint'}>
            {stats.pointsWeek > 0
              ? t('+{n} esta semana', { n: formatNumber(stats.pointsWeek) })
              : t('Nenhum ponto esta semana')}
          </span>
        </div>
        <div className="profile-highlight">
          <span className="profile-highlight-label streak">
            <FlameIcon size={16} />
            {t('Sequência')}
          </span>
          <span className="profile-big-line">
            <span className="profile-big">{stats.streak}</span>
            {stats.streak === 1 ? t('dia') : t('dias')}
          </span>
          <span className="profile-streak-bar" aria-hidden="true">
            {Array.from({ length: STREAK_GOAL }, (_, index) => (
              <span key={index} className={index < streakDays ? 'on' : undefined} />
            ))}
          </span>
          <span className="profile-hint">{streakHint}</span>
        </div>
        <div className="profile-highlight">
          <span className="profile-highlight-label">
            <BoltIcon size={16} />
            {t('Melhor Bullet')}
          </span>
          <span className="profile-big-line">
            <span className="profile-big">{stats.bulletBest}</span>
            {stats.bulletBest === 1 ? t('montado') : t('montados')}
          </span>
          {onShowBulletRanking && (
            <button type="button" className="profile-link" onClick={onShowBulletRanking}>
              {t('Ver no ranking')}
            </button>
          )}
        </div>
      </div>

      <div className="profile-numbers">
        <Stat value={stats.puzzles} label={t('Quebra-cabeças montados')} />
        <Stat value={stats.images} label={t('Fotos diferentes')} />
        <Stat value={stats.pieces} label={t('Peças encaixadas')} />
        <Stat value={stats.friends} label={t('Amigos')} onClick={onOpenFriends} />
      </div>

      <section className="profile-battles" aria-labelledby="profile-battles-title">
        <h2 id="profile-battles-title">
          <SwordsIcon size={18} /> {t('Batalhas')}
        </h2>
        <div className="profile-numbers">
          <Stat value={stats.battleWins} label={t('Vitórias')} />
          <Stat value={stats.battleLosses} label={t('Derrotas')} />
          <Stat value={stats.battleBestStreak} label={t('Maior sequência de vitórias')} />
        </div>
        {stats.rival && (
          <p className="profile-hint">
            {tRich('Quem mais enfrentou: {name} ({battles})', {
              name: <strong>{stats.rival.name}</strong>,
              battles:
                stats.rival.battles === 1
                  ? t('1 batalha')
                  : t('{n} batalhas', { n: stats.rival.battles }),
            })}
          </p>
        )}
      </section>

      <section className="profile-badges" aria-labelledby="profile-badges-title">
        <div className="profile-badges-head">
          <h2 id="profile-badges-title">{t('Conquistas')}</h2>
          <span>
            {t('{unlocked} de {total} desbloqueadas', { unlocked, total: badges.length })}
          </span>
        </div>
        <ul>
          {badges.map((badge) => {
            const done = badge.pct >= 100;
            return (
              <li key={badge.title} className={done ? 'done' : undefined}>
                <span className="profile-badge-icon" aria-hidden="true">
                  {badge.icon}
                </span>
                <span className="profile-badge-text">
                  <strong>
                    {badge.title}
                    {done && <span className="sr-only"> {t('(desbloqueada)')}</span>}
                  </strong>
                  <span>{done ? badge.doneText : badge.progressText}</span>
                  {!done && (
                    <span className="profile-badge-bar" aria-hidden="true">
                      <span style={{ width: `${badge.pct}%` }} />
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

/** As conquistas saem das estatísticas do perfil (nada guardado à parte). */
function achievements(stats: ProfileStats): Array<{
  icon: ReactNode;
  title: string;
  doneText: string;
  progressText: string;
  pct: number;
}> {
  const pct = (value: number, goal: number) => Math.min(100, Math.round((value / goal) * 100));
  return [
    {
      icon: <PuzzleIcon size={22} />,
      title: t('Primeira montagem'),
      doneText: t('Montou o primeiro quebra-cabeça'),
      progressText: t('Monte seu primeiro quebra-cabeça'),
      pct: pct(stats.puzzles, 1),
    },
    {
      icon: <FlameIcon size={22} />,
      title: t('Uma semana seguida'),
      doneText: t('{n} dias seguidos jogando', { n: STREAK_GOAL }),
      progressText: t('{current} de {goal} dias', {
        current: Math.min(stats.bestStreak, STREAK_GOAL),
        goal: STREAK_GOAL,
      }),
      pct: pct(stats.bestStreak, STREAK_GOAL),
    },
    {
      icon: <GridIcon size={22} />,
      title: t('{goal} peças', { goal: PIECES_GOAL }),
      doneText: t('{goal} peças encaixadas', { goal: PIECES_GOAL }),
      progressText: t('{current} de {goal} peças encaixadas', {
        current: stats.pieces,
        goal: PIECES_GOAL,
      }),
      pct: pct(stats.pieces, PIECES_GOAL),
    },
    {
      icon: <UsersIcon size={22} />,
      title: t('Em equipe'),
      doneText: t('Montou um quebra-cabeça em equipe'),
      progressText: t('Monte um quebra-cabeça em dupla'),
      pct: pct(stats.teamPuzzles, 1),
    },
    {
      icon: <SwordsIcon size={22} />,
      title: t('Primeira vitória'),
      doneText: t('Ganhou a primeira batalha'),
      progressText: t('Ganhe uma batalha'),
      pct: pct(stats.battleWins, 1),
    },
    {
      icon: <TrophyIcon size={22} />,
      title: t('{goal} seguidas', { goal: WIN_STREAK_GOAL }),
      doneText: t('{goal} batalhas ganhas seguidas', { goal: WIN_STREAK_GOAL }),
      progressText: t('{current} de {goal} vitórias seguidas', {
        current: Math.min(stats.battleBestStreak, WIN_STREAK_GOAL),
        goal: WIN_STREAK_GOAL,
      }),
      pct: pct(stats.battleBestStreak, WIN_STREAK_GOAL),
    },
    {
      icon: <BoltIcon size={22} />,
      title: t('Virada!'),
      doneText: t('Ganhou uma batalha estando atrás a 10 s do fim'),
      progressText: t('Vire uma batalha por tempo nos últimos 10 s'),
      pct: pct(stats.battleComebacks, 1),
    },
  ];
}

/** Um número da faixa de estatísticas; com `onClick`, vira botão (Amigos abre a lista). */
function Stat({ value, label, onClick }: { value: number; label: string; onClick?: () => void }) {
  const content = (
    <>
      <span className="profile-number-value">{formatNumber(value)}</span>
      <span className="profile-number-label">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="profile-number" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="profile-number">{content}</div>
  );
}

/** Editar o próprio perfil: avatar (foto do Google ou iniciais numa cor), nickname e bio. */
function ProfileForm({ account, onDone }: { account: Account; onDone: () => void }) {
  const user = account.user!;
  const [nickname, setNickname] = useState(user.name);
  const [bio, setBio] = useState(user.bio ?? '');
  const [style, setStyle] = useState<AvatarStyle>(
    user.googleAvatarUrl ? user.avatarStyle : 'initials',
  );
  const [color, setColor] = useState<string | null>(user.avatarColor);
  const [preset, setPreset] = useState<AvatarPreset>(user.avatarPreset ?? AVATAR_PRESETS[0]);
  const [accent, setAccent] = useState<AccentChoice>(loadAccent);

  // A cor aparece no site enquanto escolhe; sem salvar (Cancelar ou sair), volta a guardada.
  useEffect(() => applyAccent(accent), [accent]);
  useEffect(() => () => applyAccent(loadAccent()), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await account.updateProfile({
        nickname,
        bio,
        avatarStyle: style,
        avatarColor: color as (typeof AVATAR_COLORS)[number] | null,
        avatarPreset: preset,
      });
      saveAccent(accent);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form
      className="profile-form"
      aria-labelledby="profile-form-title"
      onSubmit={(event) => void save(event)}
    >
      <h2 id="profile-form-title">{t('Editar perfil')}</h2>

      <fieldset>
        <legend>Avatar</legend>
        <div className="profile-avatar-options">
          {user.googleAvatarUrl && (
            <label className="avatar-option">
              <input
                type="radio"
                name="avatar-style"
                className="sr-only"
                checked={style === 'google'}
                onChange={() => setStyle('google')}
              />
              <Avatar name={nickname || user.name} url={user.googleAvatarUrl} size={44} />
              {t('Foto do Google')}
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
            <Avatar name={nickname || user.name} color={color} size={44} />
            {t('Iniciais')}
          </label>
          <label className="avatar-option">
            <input
              type="radio"
              name="avatar-style"
              className="sr-only"
              checked={style === 'preset'}
              onChange={() => setStyle('preset')}
            />
            <Avatar name={nickname || user.name} url={avatarPresetUrl(preset)} size={44} />
            {t('Camaleão')}
          </label>
        </div>
        {style === 'preset' && (
          <div className="profile-presets" role="radiogroup" aria-label={t('Camaleão')}>
            {AVATAR_PRESETS.map((value) => (
              <label key={value} className="preset-option" title={PRESET_NAMES[value]}>
                <input
                  type="radio"
                  name="avatar-preset"
                  className="sr-only"
                  aria-label={t('Camaleão {name}', { name: PRESET_NAMES[value] })}
                  checked={preset === value}
                  onChange={() => setPreset(value)}
                />
                <img src={avatarPresetUrl(value)} alt="" width={56} height={56} />
              </label>
            ))}
          </div>
        )}
        {style === 'initials' && (
          <div className="profile-colors" role="radiogroup" aria-label={t('Cor das iniciais')}>
            <label className="color-swatch auto">
              <input
                type="radio"
                name="avatar-color"
                className="sr-only"
                checked={color === null}
                onChange={() => setColor(null)}
              />
              {t('Automática')}
            </label>
            {AVATAR_COLORS.map((value) => (
              <label key={value} className="color-swatch">
                <input
                  type="radio"
                  name="avatar-color"
                  className="sr-only"
                  aria-label={t('Cor {value}', { value })}
                  checked={color === value}
                  onChange={() => setColor(value)}
                />
                <span style={{ background: value }} />
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>{t('Cor de destaque')}</legend>
        <div className="accent-options" role="radiogroup" aria-label={t('Cor de destaque')}>
          {ACCENTS.map(({ value, label, swatch }) => (
            <label key={value} className="color-swatch" title={label}>
              <input
                type="radio"
                name="accent"
                className="sr-only"
                aria-label={t('Destaque {name}', { name: label })}
                checked={accent === value}
                onChange={() => setAccent(value)}
              />
              <span style={{ background: swatch }} />
            </label>
          ))}
        </div>
        <small className="field-hint">
          {t('Muda só a cor de destaque do site (barras, selos, marcações), neste navegador.')}
        </small>
      </fieldset>

      <label className="field profile-field">
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
          {t('Aparece nas salas e no ranking. No Google você é {name}.', { name: user.googleName })}
        </small>
      </label>

      <label className="field">
        <span>
          Bio <span className="profile-optional">{t('(opcional)')}</span>
        </span>
        <textarea
          className="input profile-bio-input"
          value={bio}
          maxLength={120}
          rows={3}
          placeholder={t('Uma frase sobre você')}
          onChange={(e) => setBio(e.target.value)}
        />
        <small className="profile-mono profile-count">{bio.length}/120</small>
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="profile-form-actions">
        <button type="button" className="btn" onClick={onDone}>
          {t('Cancelar')}
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || nickname.trim().length < 2}
        >
          {busy ? t('Salvando…') : t('Salvar perfil')}
        </button>
      </div>
    </form>
  );
}
