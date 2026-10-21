import { useState, type CSSProperties, type FormEvent } from 'react';
import { PIECE_COUNT_PRESETS, gridForPieceCount } from '@puzzle/shared';
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
  /** Proporção da foto, lida da miniatura ao carregar (serve para catálogo e foto enviada). */
  const [aspect, setAspect] = useState(4 / 3);
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

          <SizePicker
            choice={choice}
            aspect={aspect}
            onAspect={setAspect}
            pieceCount={pieceCount}
            onPieceCount={setPieceCount}
          />

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

const THUMB_MAX = { width: 180, height: 112 };

interface SizePickerProps {
  choice: PuzzleChoice;
  aspect: number;
  onAspect: (aspect: number) => void;
  pieceCount: number;
  onPieceCount: (count: number) => void;
}

/**
 * Escolha do tamanho com prévia: a miniatura ganha as linhas de corte de verdade (linhas ×
 * colunas que o servidor vai usar para esta foto), então dá para ver a dificuldade.
 */
function SizePicker({ choice, aspect, onAspect, pieceCount, onPieceCount }: SizePickerProps) {
  const { rows, cols } = gridForPieceCount(pieceCount, aspect);
  const level = difficultyOf(pieceCount);
  // Cabe em 180 × 112 sem cortar a foto: assim cada linha desenhada é um corte de verdade.
  const width = Math.min(THUMB_MAX.width, THUMB_MAX.height * aspect);
  const cuts = { '--cols': cols, '--rows': rows, width, height: width / aspect } as CSSProperties;

  return (
    <>
      <div className="size-preview">
        <div className="size-thumb" style={cuts}>
          <img
            src={choice.thumbUrl}
            alt=""
            onLoad={(e) => onAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
          />
        </div>
        <div className="size-summary">
          <strong>{choice.title}</strong>
          <p>{choice.subtitle}</p>
          <p className="size-count" aria-live="polite">
            {cols} × {rows} = <strong>{cols * rows} peças</strong>
          </p>
          <span className="size-level">
            <Pips level={level} />
            {DIFFICULTY_NAMES[level - 1]}
          </span>
        </div>
      </div>

      {/* Rádios nativos (escondidos): as setas do teclado trocam a opção, como em qualquer grupo. */}
      <fieldset className="size-options">
        <legend>Tamanho</legend>
        {PIECE_COUNT_PRESETS.map((count) => {
          const optionLevel = difficultyOf(count);
          return (
            <label key={count} className="size-option">
              <input
                type="radio"
                name="pieces"
                className="sr-only"
                checked={count === pieceCount}
                onChange={() => onPieceCount(count)}
              />
              <span className="size-option-number">{count}</span>
              <span className="size-option-unit">peças</span>
              <span className="size-option-level">
                <Pips level={optionLevel} />
                {DIFFICULTY_NAMES[optionLevel - 1]}
              </span>
            </label>
          );
        })}
      </fieldset>
    </>
  );
}
