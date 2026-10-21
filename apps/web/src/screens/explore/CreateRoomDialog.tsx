import { useState, type FormEvent } from 'react';
import { PIECE_COUNT_PRESETS } from '@puzzle/shared';
import { createRoom, type PuzzleRoom } from '../../net/connection';
import { friendlyError, savePlayerName } from '../../net/playerName';
import { DIFFICULTY_NAMES, Pips, difficultyOf } from '../../ui/difficulty';
import { Dialog } from '../../ui/Dialog';

/** A imagem escolhida na grade (do catálogo ou enviada). */
export interface PuzzleChoice {
  imageId: string;
  title: string;
  subtitle: string;
  thumbUrl: string;
}

interface CreateRoomDialogProps {
  choice: PuzzleChoice | null;
  name: string;
  onNameChange: (name: string) => void;
  onClose: () => void;
  onCreated: (room: PuzzleRoom) => void;
}

export function CreateRoomDialog({
  choice,
  name,
  onNameChange,
  onClose,
  onCreated,
}: CreateRoomDialogProps) {
  const [pieceCount, setPieceCount] = useState(48);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!choice) return;
    const trimmed = name.trim();
    if (!trimmed) return setError('Digite seu nome.');
    savePlayerName(trimmed);
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await createRoom({ name: trimmed, pieceCount, imageId: choice.imageId }));
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <Dialog open={choice !== null} onClose={onClose} labelledBy="create-title">
      {choice && (
        <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
          <h2 id="create-title">Criar sala</h2>

          <div className="dialog-image">
            <img src={choice.thumbUrl} alt="" />
            <div>
              <strong>{choice.title}</strong>
              <p>{choice.subtitle}</p>
            </div>
          </div>

          <label className="field">
            Seu nome
            <input
              className="input"
              value={name}
              maxLength={20}
              autoFocus
              onChange={(e) => onNameChange(e.target.value)}
            />
          </label>

          <div className="filter-group" role="radiogroup" aria-labelledby="pieces-label">
            <span id="pieces-label">Peças</span>
            <div className="chips">
              {PIECE_COUNT_PRESETS.map((count) => {
                const level = difficultyOf(count);
                return (
                  <button
                    key={count}
                    type="button"
                    role="radio"
                    aria-checked={count === pieceCount}
                    className="chip piece-chip"
                    onClick={() => setPieceCount(count)}
                  >
                    <Pips level={level} />
                    {count} <small>{DIFFICULTY_NAMES[level - 1]}</small>
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="error">{error}</p>}

          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn btn-primary" disabled={busy}>
              {busy ? 'Criando…' : 'Criar sala'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
