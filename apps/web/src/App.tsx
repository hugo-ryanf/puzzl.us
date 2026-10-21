import { useCallback, useEffect, useState } from 'react';
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
import { ExploreScreen } from './screens/explore/ExploreScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { RankingScreen } from './screens/RankingScreen';
import { RecordsScreen } from './screens/RecordsScreen';
import { FriendsScreen } from './screens/FriendsScreen';
import { RoomScreen } from './screens/RoomScreen';
import { SavedScreen } from './screens/SavedScreen';
import { AppShell, type Section } from './ui/AppShell';
import { ArrowLeftIcon } from './ui/icons';
import { InviteToasts } from './ui/InviteToasts';

/** O link de convite é só o código no caminho: https://site/K7QF2 */
function codeFromUrl(): string {
  const code = location.pathname.slice(1).toUpperCase();
  return /^[A-Z2-9]{5}$/.test(code) ? code : '';
}

/** Link de amigo: https://site/?amigo=K7QF-2M9D abre "Amigos" com o código preenchido. */
function friendCodeFromUrl(): string | undefined {
  return new URLSearchParams(location.search).get('amigo') ?? undefined;
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
  const [ranking, setRanking] = useState<(RankingQuery & { bullet?: BulletRankingQuery }) | null>(
    null,
  );
  /** Tela da barra lateral (o ranking, quando aberto, fica por cima dela). */
  const [section, setSection] = useState<Exclude<Section, 'ranking'>>(() =>
    friendCodeFromUrl() ? 'friends' : 'explore',
  );
  const [notice, setNotice] = useState<string>();
  const [name, setName] = useState(loadPlayerName);
  const account = useAccount();
  // Logado e sem nome digitado ainda: começa com o primeiro nome da conta.
  const accountName = account.user?.name.split(' ')[0];
  const playerName = name.trim() ? name : (accountName ?? name);
  const library = useLibrary(account.user);
  const signedIn = !!account.user;
  const presence = usePresence(account.user?.id);
  const friends = useFriends(account.user?.id, presence.version);
  const community = useCommunity(
    account.user === undefined ? undefined : (account.user?.id ?? null),
  );
  const [createRequested, setCreateRequested] = useState(false);
  // Link de convite (/K7QF2) sem sessão salva: abre "Entrar com código" já preenchido.
  const [joinOpen, setJoinOpen] = useState(() => codeFromUrl() !== '');
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
        enter(await joinRoom(invite.roomCode, { name: playerName.trim() || 'Jogador' }));
      } catch {
        leave('Não deu para entrar na sala do convite (ela pode ter acabado ou enchido).');
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
  if (resuming) return <p className="loading">Voltando para a sala…</p>;
  if (room) {
    // Ranking aberto do fim da partida: sem barra lateral (o "Explorar" voltaria para a sala).
    if (ranking) {
      return (
        <div className="main standalone">
          <button type="button" className="btn" onClick={() => setRanking(null)}>
            <ArrowLeftIcon size={18} />
            Voltar para a sala
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
  return (
    <>
      <AppShell
        active={ranking ? 'ranking' : section}
        onNavigate={(next) => {
          if (next === 'ranking') return setRanking(DEFAULT_RANKING);
          setRanking(null);
          setSection(next);
        }}
        onCreateRoom={() => {
          setRanking(null);
          if (!onExplore) setSection('explore'); // os diálogos moram no Explorar
          setCreateRequested(true);
        }}
        onJoinRoom={() => {
          setRanking(null);
          if (!onExplore) setSection('explore');
          setJoinOpen(true);
        }}
        account={account}
        friendRequests={friends.data?.incoming.length}
      >
        {ranking ? (
          // `key`: abrir o ranking de outra foto recomeça os filtros a partir dela.
          <RankingScreen
            key={JSON.stringify(ranking)}
            initial={ranking}
            community={community.puzzles}
          />
        ) : section === 'friends' ? (
          <FriendsScreen
            friends={friends}
            signedIn={signedIn}
            googleLogin={account.googleLogin}
            initialCode={friendCodeFromUrl()}
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
            joinOpen={joinOpen}
            initialCode={codeFromUrl()}
            onCloseCreate={() => setCreateRequested(false)}
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
