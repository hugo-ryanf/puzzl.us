import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import {
  CATALOG,
  type BulletRankingQuery,
  type InviteMessage,
  type RankingQuery,
} from '@puzzle/shared';
import { useAccount } from './net/account';
import { useCommunity } from './net/community';
import { useFriends } from './net/friends';
import { usePresence } from './net/presence';
import { useLibrary } from './net/library';
import {
  hasSavedSession,
  joinRoom,
  leaveRoom,
  resumeRoom,
  type PuzzleRoom,
} from './net/connection';
import { loadPlayerName } from './net/playerName';
import type { PuzzleChoice } from './screens/explore/CreateRoomDialog';
import { ExploreScreen } from './screens/explore/ExploreScreen';
import { LandingScreen } from './screens/landing/LandingScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { RankingScreen } from './screens/RankingScreen';
import { RecordsScreen } from './screens/RecordsScreen';
import { FriendsScreen } from './screens/FriendsScreen';
import { RoomScreen } from './screens/RoomScreen';
import { SavedScreen } from './screens/SavedScreen';
import { AppShell, type Section } from './ui/AppShell';
import { ArrowLeftIcon } from './ui/icons';
import { InviteToasts } from './ui/InviteToasts';
import { t } from './i18n';

/** Laboratório (/lab): só no ambiente de desenvolvimento; some do build de produção. */
const LabScreen = import.meta.env.DEV ? lazy(() => import('./screens/lab/LabScreen')) : null;

/** O link de convite é só o código no caminho: https://site/K7QF2 */
function codeFromUrl(): string {
  const code = location.pathname.slice(1).toUpperCase();
  return /^[A-Z2-9]{5}$/.test(code) ? code : '';
}

/** Link de amigo: https://site/?amigo=K7QF-2M9D abre "Amigos" com o código preenchido. */
function friendCodeFromUrl(): string | undefined {
  return new URLSearchParams(location.search).get('amigo') ?? undefined;
}

/** Perfil público: https://site/perfil/K7QF-2M9D */
function profileCodeFromUrl(): string | undefined {
  return /^\/perfil\/([A-Za-z0-9-]{8,9})$/.exec(location.pathname)?.[1]?.toUpperCase();
}

const DEFAULT_RANKING: RankingQuery = {
  image: CATALOG[0]!.id,
  pieces: 48,
  players: 2,
  period: 'all',
};

export function App() {
  const [room, setRoom] = useState<PuzzleRoom | null>(null);
  // Ranking aberto por cima (do menu ou do fim da partida); a sala continua conectada por trás.
  const [ranking, setRanking] = useState<
    (RankingQuery & { bullet?: BulletRankingQuery; tab?: 'general' }) | null
  >(null);
  /** Tela da barra lateral (o ranking, quando aberto, fica por cima dela). */
  const [section, setSection] = useState<Exclude<Section, 'ranking'>>(() =>
    profileCodeFromUrl() ? 'profile' : friendCodeFromUrl() ? 'friends' : 'explore',
  );
  /** Perfil aberto (o próprio ou de outra pessoa), pelo código de amigo. */
  const [profileCode, setProfileCode] = useState(profileCodeFromUrl);
  const [notice, setNotice] = useState<string>();
  const [name, setName] = useState(loadPlayerName);
  const account = useAccount();
  // Logado, o nome nas salas é sempre o nickname do perfil (o servidor também garante isso).
  const playerName = account.user ? account.user.name : name;
  const library = useLibrary(account.user);
  const signedIn = !!account.user;
  const presence = usePresence(account.user?.id);
  const friends = useFriends(account.user?.id, presence.version);
  const community = useCommunity(
    account.user === undefined ? undefined : (account.user?.id ?? null),
  );
  const [createRequested, setCreateRequested] = useState(false);
  // Sem login, "/" abre a landing; dali um clique leva ao app (e a foto escolhida, se houver).
  const [landing, setLanding] = useState(
    () => location.pathname === '/' && !location.search && !location.hash,
  );
  const [startChoice, setStartChoice] = useState<PuzzleChoice | null>(null);
  // Link de convite (/K7QF2) sem sessão salva: abre "Entrar com código" já preenchido.
  const [joinOpen, setJoinOpen] = useState(() => codeFromUrl() !== '');
  /** Código digitado no campo da barra lateral (vale mais que o do link). */
  const [joinCode, setJoinCode] = useState('');
  // F5 dentro de uma sala: tenta voltar para ela com o token salvo antes de mostrar o início.
  const [resuming, setResuming] = useState(() => hasSavedSession(codeFromUrl()));

  useEffect(() => {
    if (!resuming) return;
    void resumeRoom(codeFromUrl()).then((resumed) => {
      if (resumed) setRoom(resumed);
      setResuming(false);
    });
  }, [resuming]);

  const enter = useCallback((joined: PuzzleRoom) => {
    history.replaceState(null, '', `/${joined.roomId}`);
    setNotice(undefined);
    setCreateRequested(false);
    setStartChoice(null);
    setJoinOpen(false);
    setRanking(null);
    setRoom(joined);
  }, []);

  const { refresh: refreshLibrary } = library;
  const leave = useCallback(
    (message?: string) => {
      history.replaceState(null, '', '/');
      setRoom(null);
      setRanking(null);
      setNotice(message);
      refreshLibrary(); // a partida pode ter terminado: selo "Montado" e record novo
    },
    [refreshLibrary],
  );

  const { dismissInvite } = presence;
  /** "Entrar" num convite: sai da sala atual (se houver) e entra na do amigo. */
  const acceptInvite = useCallback(
    async (invite: InviteMessage) => {
      dismissInvite(invite);
      if (room) leaveRoom(room);
      try {
        enter(await joinRoom(invite.roomCode, { name: playerName.trim() || t('Jogador') }));
      } catch {
        leave(t('Não deu para entrar na sala do convite (ela pode ter acabado ou enchido).'));
      }
    },
    [dismissInvite, room, enter, leave, playerName],
  );
  const toasts = (
    <InviteToasts
      invites={presence.invites}
      onAccept={acceptInvite}
      onDismiss={presence.dismissInvite}
    />
  );

  // Página fixa (o Google exige o link da política de privacidade para liberar o login).
  if (location.pathname === '/privacidade') return <PrivacyScreen />;
  // Laboratório de testes: só no `pnpm dev` (no build de produção, LabScreen nem existe).
  if (LabScreen && location.pathname === '/lab') {
    return (
      <Suspense fallback={<p className="loading">Carregando o laboratório…</p>}>
        <LabScreen />
      </Suspense>
    );
  }
  if (resuming) return <p className="loading">{t('Voltando para a sala…')}</p>;
  // Ainda não se sabe se tem login: a tela fica vazia em vez de piscar a landing para quem tem.
  if (landing && !room && account.user === undefined) return null;
  if (landing && !room && account.user === null) {
    /** Sai da landing para o app: com uma foto, o "Criar sala" dela; sem, o "Criar sala" livre. */
    const startFromLanding = (choice?: PuzzleChoice) => {
      scrollTo(0, 0); // o Explorar começa do topo, não da altura em que a landing estava
      setLanding(false);
      if (choice) setStartChoice(choice);
      else setCreateRequested(true);
    };
    return (
      <LandingScreen
        googleLogin={account.googleLogin}
        onStart={startFromLanding}
        ranking={
          <RankingScreen
            initial={{ ...DEFAULT_RANKING, tab: 'general' }}
            community={community.puzzles}
            onCreateRoom={() => startFromLanding()}
            onOpenProfile={(code) => {
              scrollTo(0, 0);
              setLanding(false);
              setProfileCode(code);
              setSection('profile');
              history.replaceState(null, '', `/perfil/${code}`);
            }}
          />
        }
      />
    );
  }
  if (room) {
    // Ranking aberto do fim da partida: sem barra lateral (o "Explorar" voltaria para a sala).
    if (ranking) {
      return (
        <div className="main standalone">
          <button type="button" className="btn" onClick={() => setRanking(null)}>
            <ArrowLeftIcon size={18} />
            {t('Voltar para a sala')}
          </button>
          <RankingScreen
            key={JSON.stringify(ranking)}
            initial={ranking}
            community={community.puzzles}
          />
        </div>
      );
    }
    return (
      <>
        <RoomScreen
          // Mesma sala por outra conexão (voltou depois de um reinício): remonta tudo do zero.
          key={`${room.roomId}:${room.sessionId}`}
          room={room}
          onLeave={leave}
          onRejoin={enter}
          onShowRanking={(open) => setRanking({ ...DEFAULT_RANKING, ...open })}
          account={
            account.user ? { name: account.user.name, publish: community.publish } : undefined
          }
          friends={account.user ? friends : undefined}
        />
        {toasts}
      </>
    );
  }

  const onExplore = section === 'explore' || section === 'favorites';
  /** Perfil de alguém (pelo código de amigo); o endereço vira o link do perfil. */
  const openProfile = (code: string) => {
    setRanking(null);
    setProfileCode(code);
    setSection('profile');
    history.replaceState(null, '', `/perfil/${code}`);
  };
  return (
    <>
      <AppShell
        active={ranking ? 'ranking' : section}
        onNavigate={(next) => {
          if (next === 'profile') {
            if (account.user) openProfile(account.user.friendCode);
            return;
          }
          if (location.pathname.startsWith('/perfil/')) history.replaceState(null, '', '/');
          if (next === 'ranking') return setRanking({ ...DEFAULT_RANKING, tab: 'general' });
          setRanking(null);
          setSection(next);
        }}
        onOpenProfile={openProfile}
        onCreateRoom={() => {
          setRanking(null);
          if (!onExplore) setSection('explore'); // os diálogos moram no Explorar
          setCreateRequested(true);
        }}
        onJoinRoom={(code) => {
          setRanking(null);
          if (!onExplore) setSection('explore');
          setJoinCode(code ?? '');
          setJoinOpen(true);
        }}
        account={account}
        friends={friends.data?.friends}
        friendRequests={friends.data?.incoming.length}
      >
        {ranking ? (
          // `key`: abrir o ranking de outra foto recomeça os filtros a partir dela.
          <RankingScreen
            key={JSON.stringify(ranking)}
            initial={ranking}
            community={community.puzzles}
            onCreateRoom={() => {
              setRanking(null);
              setSection('explore');
              setCreateRequested(true);
            }}
            onOpenProfile={openProfile}
          />
        ) : section === 'profile' && profileCode ? (
          <ProfileScreen
            key={profileCode}
            code={profileCode}
            account={account}
            friends={friends}
            onShowBulletRanking={() =>
              setRanking({
                ...DEFAULT_RANKING,
                bullet: { minutes: 3, pieces: 12, players: 1, period: 'all' },
              })
            }
            onOpenFriends={() => setSection('friends')}
          />
        ) : section === 'friends' ? (
          <FriendsScreen
            friends={friends}
            signedIn={signedIn}
            googleLogin={account.googleLogin}
            initialCode={friendCodeFromUrl()}
            onOpenProfile={openProfile}
          />
        ) : section === 'saved' ? (
          <SavedScreen
            signedIn={signedIn}
            googleLogin={account.googleLogin}
            name={playerName}
            onEnter={enter}
          />
        ) : section === 'records' ? (
          <RecordsScreen
            library={library}
            signedIn={signedIn}
            googleLogin={account.googleLogin}
            onShowRanking={setRanking}
          />
        ) : (
          <ExploreScreen
            view={section === 'favorites' ? 'favorites' : 'all'}
            library={library}
            signedIn={signedIn}
            googleLogin={account.googleLogin}
            community={community}
            isAdmin={account.user?.isAdmin ?? false}
            notice={notice ?? account.loginNotice}
            name={playerName}
            onNameChange={setName}
            createRequested={createRequested}
            initialChoice={startChoice}
            joinOpen={joinOpen}
            initialCode={joinCode || codeFromUrl()}
            onCloseCreate={() => {
              setCreateRequested(false);
              setStartChoice(null);
            }}
            onCloseJoin={() => setJoinOpen(false)}
            onEnter={enter}
            onShowRanking={(image) => setRanking({ ...DEFAULT_RANKING, image })}
          />
        )}
      </AppShell>
      {toasts}
    </>
  );
}
