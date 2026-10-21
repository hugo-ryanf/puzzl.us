import { useCallback, useEffect, useState } from 'react';
import { CATALOG, type RankingQuery } from '@puzzle/shared';
import { useAccount } from './net/account';
import { hasSavedSession, resumeRoom, type PuzzleRoom } from './net/connection';
import { loadPlayerName } from './net/playerName';
import { ExploreScreen } from './screens/explore/ExploreScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { RankingScreen } from './screens/RankingScreen';
import { RoomScreen } from './screens/RoomScreen';
import { AppShell } from './ui/AppShell';
import { ArrowLeftIcon } from './ui/icons';

/** O link de convite é só o código no caminho: https://site/K7QF2 */
function codeFromUrl(): string {
  const code = location.pathname.slice(1).toUpperCase();
  return /^[A-Z2-9]{5}$/.test(code) ? code : '';
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
  const [ranking, setRanking] = useState<RankingQuery | null>(null);
  const [notice, setNotice] = useState<string>();
  const [name, setName] = useState(loadPlayerName);
  const account = useAccount();
  // Logado e sem nome digitado ainda: começa com o primeiro nome da conta.
  const accountName = account.user?.name.split(' ')[0];
  const playerName = name.trim() ? name : (accountName ?? name);
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

  const leave = useCallback((message?: string) => {
    history.replaceState(null, '', '/');
    setRoom(null);
    setRanking(null);
    setNotice(message);
  }, []);

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
          <RankingScreen key={JSON.stringify(ranking)} initial={ranking} />
        </div>
      );
    }
    return (
      <RoomScreen
        // Mesma sala por outra conexão (voltou depois de um reinício): remonta tudo do zero.
        key={`${room.roomId}:${room.sessionId}`}
        room={room}
        onLeave={leave}
        onRejoin={enter}
        onShowRanking={setRanking}
      />
    );
  }

  return (
    <AppShell
      active={ranking ? 'ranking' : 'explore'}
      onNavigate={(section) => setRanking(section === 'ranking' ? DEFAULT_RANKING : null)}
      onCreateRoom={() => {
        setRanking(null);
        setCreateRequested(true);
      }}
      onJoinRoom={() => {
        setRanking(null);
        setJoinOpen(true);
      }}
      account={account}
    >
      {ranking ? (
        // `key`: abrir o ranking de outra foto recomeça os filtros a partir dela.
        <RankingScreen key={JSON.stringify(ranking)} initial={ranking} />
      ) : (
        <ExploreScreen
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
  );
}
