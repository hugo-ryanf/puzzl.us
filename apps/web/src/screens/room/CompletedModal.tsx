import { useEffect, useRef, useState } from 'react';
import type { RankingEntry, RankingQuery } from '@puzzle/shared';
import { puzzleImageInfo } from '../../board/images';
import { formatDuration } from '../../format';
import { fetchRanking } from '../../net/ranking';
import type { RoomSnapshot } from '../../net/useRoomSnapshot';
import { DIFFICULTY_NAMES, difficultyOf } from '../../ui/difficulty';
import { CloseIcon, ImageIcon, PartyIcon, TrophyIcon } from '../../ui/icons';

interface CompletedModalProps {
  snapshot: RoomSnapshot;
  onShowRanking: (query: RankingQuery) => void;
  onLeave: () => void;
}

/** Espera a foto montada aparecer (as linhas sumirem) antes de cobrir a mesa com o resultado. */
const OPEN_DELAY_MS = 1300;
/** Quantas posições do ranking cabem no resumo; a da equipe aparece mesmo se ficar abaixo. */
const RANKING_PREVIEW = 5;

/**
 * Resultado da partida: tempo, métricas, quanto cada um encaixou (em grupo), o ranking da
 * categoria e o crédito da foto. Pode ser fechado para admirar a imagem e reaberto depois.
 */
export function CompletedModal({ snapshot, onShowRanking, onLeave }: CompletedModalProps) {
  const [open, setOpen] = useState(false);
  const [ranking, setRanking] = useState<RankingEntry[]>();
  const dialogRef = useRef<HTMLElement>(null);
  const { imageId, pieceCount, pieces, durationMs, teamSize, rankStatus, rank, players } = snapshot;
  const image = puzzleImageInfo(imageId);
  const query: RankingQuery = { image: imageId, pieces: pieceCount, players: teamSize };

  useEffect(() => {
    const timer = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus(); // leitor de tela e teclado começam pelo resultado
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // O ranking só existe depois que o servidor gravou a partida.
  useEffect(() => {
    if (rankStatus !== 'saved') return;
    let cancelled = false;
    fetchRanking({ image: imageId, pieces: pieceCount, players: teamSize })
      .then((entries) => !cancelled && setRanking(entries))
      .catch(() => !cancelled && setRanking([]));
    return () => {
      cancelled = true;
    };
  }, [rankStatus, imageId, pieceCount, teamSize]);

  if (!open) {
    return (
      <button type="button" className="btn result-reopen" onClick={() => setOpen(true)}>
        <TrophyIcon size={18} />
        Ver resultado
      </button>
    );
  }

  const minutes = durationMs / 60_000;
  const pace =
    minutes > 0 ? (pieces / minutes).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—';
  const category = `${pieceCount} peças · ${teamSize === 1 ? 'solo' : `${teamSize} jogadores`}`;
  const totalSnaps = Math.max(1, pieces - 1);
  const contributions = [...players].sort((a, b) => b.snaps - a.snaps);

  // Top 5 + a linha da equipe, se ela ficou mais abaixo.
  const top = ranking?.slice(0, RANKING_PREVIEW) ?? [];
  const mine = ranking?.find((entry) => entry.position === rank);
  const rows = mine && !top.includes(mine) ? [...top, mine] : top;

  return (
    // Clicar no fundo escuro fecha: é o jeito rápido de voltar a ver a foto montada.
    <div className="overlay result-overlay" onClick={() => setOpen(false)}>
      <section
        ref={dialogRef}
        className="result"
        role="dialog"
        aria-labelledby="result-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="tool icon-only result-close"
          aria-label="Fechar e ver a imagem"
          onClick={() => setOpen(false)}
        >
          <CloseIcon size={18} />
        </button>

        <header className="result-header">
          <span className="result-badge" aria-hidden="true">
            <PartyIcon size={26} />
          </span>
          <h2 id="result-title">Quebra-cabeça completo!</h2>
          {image && (
            <p className="caption">
              <strong>{image.title}</strong>
              {image.credit && <span className="credit"> · {image.credit}</span>}
            </p>
          )}
        </header>

        <dl className="metrics">
          <div>
            <dt>Tempo</dt>
            <dd>{formatDuration(durationMs)}</dd>
          </div>
          <div>
            <dt>Peças</dt>
            <dd>{pieces}</dd>
          </div>
          <div>
            <dt>Ritmo</dt>
            <dd>
              {pace} <small>peças/min</small>
            </dd>
          </div>
          <div>
            <dt>Dificuldade</dt>
            <dd>{DIFFICULTY_NAMES[difficultyOf(pieceCount) - 1]}</dd>
          </div>
        </dl>

        {players.length > 1 && (
          <section className="result-section">
            <h3>Encaixes de cada um</h3>
            <ul className="contributions">
              {contributions.map((player) => {
                const share = player.snaps / totalSnaps;
                return (
                  <li key={player.sessionId}>
                    <span className="contribution-name">
                      <span className="contribution-dot" style={{ background: player.color }} />
                      {player.name}
                    </span>
                    <span className="contribution-bar" aria-hidden="true">
                      <span style={{ width: `${share * 100}%`, background: player.color }} />
                    </span>
                    <span className="contribution-count">
                      {player.snaps} <small>({Math.round(share * 100)}%)</small>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="result-section">
          <h3>Ranking · {category}</h3>
          {rankStatus === 'saving' && <p className="result-note">Registrando no ranking…</p>}
          {rankStatus === 'unavailable' && (
            <p className="result-note">O ranking está indisponível neste servidor.</p>
          )}
          {rankStatus === 'unranked' && (
            <p className="result-note">Foto própria: fica fora do ranking (cada foto é única).</p>
          )}
          {rankStatus === 'saved' && (
            <>
              <p className="result-rank">
                <TrophyIcon size={18} />
                <strong>{rank}º lugar</strong> na categoria
              </p>
              {rows.length > 0 && (
                <ol className="result-ranking">
                  {rows.map((entry) => (
                    <li
                      key={entry.position}
                      className={entry.position === rank ? 'mine' : undefined}
                    >
                      <span className="position">{entry.position}º</span>
                      <span className="players">{entry.players.join(' & ')}</span>
                      <span className="time">{formatDuration(entry.durationMs)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>

        <div className="result-actions">
          {rankStatus === 'saved' && (
            <button type="button" className="btn" onClick={() => onShowRanking(query)}>
              <TrophyIcon size={18} />
              Ranking completo
            </button>
          )}
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            <ImageIcon size={18} />
            Ver a imagem
          </button>
          <button type="button" className="btn btn-primary" onClick={onLeave}>
            Voltar ao início
          </button>
        </div>
      </section>
    </div>
  );
}
