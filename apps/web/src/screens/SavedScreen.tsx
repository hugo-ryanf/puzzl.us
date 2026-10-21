import { useEffect, useState } from 'react';
import { uploadIdOf, type SavedGameSummary } from '@puzzle/shared';
import { catalogThumbUrl, puzzleImageInfo, puzzleImageUrl } from '../board/images';
import { formatDuration } from '../format';
import { resumeSavedGame, type PuzzleRoom } from '../net/connection';
import { ArrowRightIcon } from '../ui/icons';

interface SavedScreenProps {
  signedIn: boolean;
  googleLogin: boolean;
  name: string;
  onEnter: (room: PuzzleRoom) => void;
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Foto enviada não tem miniatura: usa a própria foto (já é pequena o bastante). */
const thumbUrl = (imageId: string) =>
  uploadIdOf(imageId) ? puzzleImageUrl(imageId) : catalogThumbUrl(imageId);

/** Partidas salvas pela conta, da mais recente para a mais antiga; continuar abre uma sala nova. */
export function SavedScreen({ signedIn, googleLogin, name, onEnter }: SavedScreenProps) {
  const [games, setGames] = useState<SavedGameSummary[]>();
  const [opening, setOpening] = useState<string>();
  const [confirming, setConfirming] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!signedIn) return;
    let current = true;
    fetch('/api/me/saved')
      .then((response) => (response.ok ? (response.json() as Promise<SavedGameSummary[]>) : []))
      .then((list) => current && setGames(list))
      .catch(() => current && setGames([]));
    return () => {
      current = false;
    };
  }, [signedIn]);

  async function resume(game: SavedGameSummary) {
    setOpening(game.id);
    setError(undefined);
    try {
      onEnter(await resumeSavedGame(game.id, { name: name.trim() || 'Jogador' }));
    } catch {
      setOpening(undefined);
      setError('Não deu para continuar esta partida (a foto enviada pode ter expirado).');
    }
  }

  async function discard(id: string) {
    setConfirming(undefined);
    setGames((list) => list?.filter((game) => game.id !== id));
    await fetch(`/api/me/saved/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Em andamento</h1>
          <p>Partidas que você salvou para terminar depois. O tempo continua de onde parou.</p>
        </div>
      </div>

      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}

      {!signedIn && (
        <div className="empty">
          <strong>Entre para salvar partidas</strong>
          <p>Com a conta, você salva no meio e continua depois, em qualquer aparelho.</p>
          {googleLogin && (
            <a className="btn" href="/auth/google">
              Entrar com Google
            </a>
          )}
        </div>
      )}

      {signedIn && games?.length === 0 && (
        <div className="empty">
          <strong>Nenhuma partida em andamento</strong>
          <p>
            Numa sala que você criou, use "Salvar e sair". Se todo mundo sair no meio, ela também
            fica guardada aqui.
          </p>
        </div>
      )}

      {signedIn && games && games.length > 0 && (
        <ol className="records-list saved-list">
          {games.map((game) => {
            const title = puzzleImageInfo(game.imageId)?.title ?? 'Quebra-cabeça';
            const percent = game.pieces > 0 ? Math.round((game.placed / game.pieces) * 100) : 0;
            const mode = game.maxPlayers === 1 ? 'Solo' : `até ${game.maxPlayers} jogadores`;
            return (
              <li key={game.id}>
                <img src={thumbUrl(game.imageId)} alt="" loading="lazy" />
                <span className="records-title">
                  <strong>{title}</strong>
                  <small>
                    {game.pieces} peças · {mode} · salva em{' '}
                    {dateFormat.format(new Date(game.savedAt))}
                  </small>
                  <span className="saved-progress">
                    <span className="progress-bar" aria-hidden="true">
                      <span style={{ width: `${percent}%` }} />
                    </span>
                    <small>{percent}%</small>
                  </span>
                </span>
                <span className="records-time">
                  <strong>{formatDuration(game.elapsedMs)}</strong>
                  <small>de jogo</small>
                </span>
                <span className="saved-actions">
                  {confirming === game.id ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => void discard(game.id)}
                      >
                        Descartar
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setConfirming(undefined)}
                      >
                        Manter
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setConfirming(game.id)}
                        aria-label={`Descartar ${title}`}
                      >
                        Descartar
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={opening !== undefined}
                        onClick={() => void resume(game)}
                      >
                        {opening === game.id ? 'Abrindo…' : 'Continuar'}
                        <ArrowRightIcon size={16} />
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
