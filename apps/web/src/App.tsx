import { useCallback, useEffect, useState } from 'react';
import type { RankingQuery } from '@puzzle/shared';
import { hasSavedSession, resumeRoom, type PuzzleRoom } from './net/connection';
import { HomeScreen } from './screens/HomeScreen';
import { RankingScreen } from './screens/RankingScreen';
import { RoomScreen } from './screens/RoomScreen';

/** O link de convite é só o código no caminho: https://site/K7QF2 */
function codeFromUrl(): string {
  const code = location.pathname.slice(1).toUpperCase();
  return /^[A-Z2-9]{5}$/.test(code) ? code : '';
}

export function App() {
  const [room, setRoom] = useState<PuzzleRoom | null>(null);
  // Ranking aberto por cima (da home ou do fim da partida); a sala continua conectada por trás.
  const [ranking, setRanking] = useState<RankingQuery | null>(null);
  const [notice, setNotice] = useState<string>();
  // F5 dentro de uma sala: tenta voltar para ela com o token salvo antes de mostrar a home.
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
    setRoom(joined);
  }, []);

  const leave = useCallback((message?: string) => {
    history.replaceState(null, '', '/');
    setRoom(null);
    setNotice(message);
  }, []);

  if (resuming) return <p className="loading">Voltando para a sala…</p>;
  if (ranking) return <RankingScreen initial={ranking} onBack={() => setRanking(null)} />;
  if (room) {
    return <RoomScreen key={room.roomId} room={room} onLeave={leave} onShowRanking={setRanking} />;
  }
  return (
    <HomeScreen
      initialCode={codeFromUrl()}
      notice={notice}
      onEnter={enter}
      onShowRanking={setRanking}
    />
  );
}
