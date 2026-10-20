import { useState, type FormEvent } from 'react';
import { CATALOG, PIECE_COUNT_PRESETS, uploadIdOf, type RankingQuery } from '@puzzle/shared';
import { createRoom, joinRoom, type PuzzleRoom } from '../net/connection';
import { ImagePicker } from './ImagePicker';

const NAME_KEY = 'quebra-cabeca:nome';

interface HomeScreenProps {
  initialCode: string;
  notice?: string;
  onEnter: (room: PuzzleRoom) => void;
  onShowRanking: (query: RankingQuery) => void;
}

export function HomeScreen({ initialCode, notice, onEnter, onShowRanking }: HomeScreenProps) {
  const [name, setName] = useState(loadName);
  const [imageId, setImageId] = useState(CATALOG[0]!.id);
  const [pieceCount, setPieceCount] = useState<number>(48);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function enter(connect: () => Promise<PuzzleRoom>) {
    const trimmed = name.trim();
    if (!trimmed) return setError('Digite seu nome antes de entrar.');
    saveName(trimmed);
    setBusy(true);
    setError(undefined);
    try {
      onEnter(await connect());
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    void enter(() => createRoom({ name: name.trim(), pieceCount, imageId }));
  }

  function handleJoin(event: FormEvent) {
    event.preventDefault();
    const roomCode = code.trim().toUpperCase();
    if (!roomCode) return setError('Digite o código da sala.');
    void enter(() => joinRoom(roomCode, { name: name.trim() }));
  }

  return (
    <main className="home">
      <h1>Quebra-cabeça</h1>
      <p className="subtitle">
        Monte junto com seus amigos, em tempo real.{' '}
        <button
          className="link"
          onClick={() =>
            // Foto enviada não tem ranking: abre o da primeira foto do catálogo.
            onShowRanking({
              image: uploadIdOf(imageId) ? CATALOG[0]!.id : imageId,
              pieces: pieceCount,
              players: 2,
            })
          }
        >
          Ver ranking
        </button>
      </p>
      {notice && <p className="notice">{notice}</p>}

      <label className="field">
        Seu nome
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>

      <div className="cards">
        <form className="card" onSubmit={handleCreate}>
          <h2>Criar sala</h2>
          <ImagePicker value={imageId} onChange={setImageId} allowUpload />
          <label className="field">
            Peças
            <select value={pieceCount} onChange={(e) => setPieceCount(Number(e.target.value))}>
              {PIECE_COUNT_PRESETS.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy}>Criar</button>
        </form>

        <form className="card" onSubmit={handleJoin}>
          <h2>Entrar com código</h2>
          <label className="field">
            Código
            <input
              value={code}
              maxLength={5}
              placeholder="K7QF2"
              className="code-input"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          <button disabled={busy}>Entrar</button>
        </form>
      </div>

      {error && <p className="error">{error}</p>}
    </main>
  );
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) return 'Sala não encontrada. Confira o código.';
  if (/locked|full/i.test(message)) return 'Essa sala está cheia.';
  if (/fetch|network|ECONNREFUSED/i.test(message)) return 'Não consegui falar com o servidor.';
  return message;
}

// localStorage pode estar bloqueado; o nome lembrado é só conveniência.
function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // sem storage, a pessoa só digita de novo da próxima vez
  }
}
