import { useEffect, useState } from 'react';
import {
  MAX_PLAYERS,
  PIECE_COUNT_PRESETS,
  findCatalogImage,
  type RankingEntry,
  type RankingQuery,
} from '@puzzle/shared';
import { formatDuration } from '../format';
import { fetchRanking } from '../net/ranking';
import { ImagePicker } from './ImagePicker';

interface RankingScreenProps {
  initial: RankingQuery;
  onBack: () => void;
}

interface Loaded {
  /** De qual consulta é este resultado: se não bate com a atual, ainda está carregando. */
  key: string;
  entries?: RankingEntry[];
  error?: string;
}

const TEAM_LABELS: Record<number, string> = { 1: 'Solo', 2: 'Duplas', 3: 'Trios', 4: 'Quartetos' };
const teamLabel = (n: number) => TEAM_LABELS[n] ?? `${n} jogadores`;
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

export function RankingScreen({ initial, onBack }: RankingScreenProps) {
  const [query, setQuery] = useState(initial);
  const [loaded, setLoaded] = useState<Loaded>();
  const key = `${query.image}:${query.pieces}:${query.players}`;

  useEffect(() => {
    let current = true; // ignora respostas de consultas antigas (troca rápida de filtro)
    fetchRanking(query)
      .then((entries) => current && setLoaded({ key, entries }))
      .catch(
        (e: unknown) =>
          current && setLoaded({ key, error: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      current = false;
    };
  }, [query, key]);

  const result = loaded?.key === key ? loaded : undefined;

  return (
    <main className="ranking">
      <button onClick={onBack}>← Voltar</button>
      <h1>Ranking</h1>
      <p className="subtitle">Melhor tempo de cada equipe. Tempo medido pelo servidor.</p>

      <ImagePicker value={query.image} onChange={(image) => setQuery({ ...query, image })} />
      <div className="filters">
        <label className="field">
          Peças
          <select
            value={query.pieces}
            onChange={(e) => setQuery({ ...query, pieces: Number(e.target.value) })}
          >
            {PIECE_COUNT_PRESETS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Equipe
          <select
            value={query.players}
            onChange={(e) => setQuery({ ...query, players: Number(e.target.value) })}
          >
            {Array.from({ length: MAX_PLAYERS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {teamLabel(n)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!result && <p>Carregando…</p>}
      {result?.error && <p className="error">{result.error}</p>}
      {result?.entries?.length === 0 && (
        <p>
          Ninguém montou “{findCatalogImage(query.image)?.title}” com {query.pieces} peças nessa
          categoria ainda. Seja o primeiro!
        </p>
      )}
      {!!result?.entries?.length && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Equipe</th>
              <th>Tempo</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {result.entries.map((entry) => (
              <tr key={entry.position}>
                <td>{entry.position}º</td>
                <td>{entry.players.join(' & ')}</td>
                <td className="time">{formatDuration(entry.durationMs)}</td>
                <td>{dateFormat.format(new Date(entry.finishedAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
