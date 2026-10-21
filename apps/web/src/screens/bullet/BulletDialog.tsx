import { useState, type FormEvent } from 'react';
import { BULLET_MINUTES, BULLET_PIECES, MAX_PLAYERS } from '@puzzle/shared';
import { createBulletRoom, type PuzzleRoom } from '../../net/connection';
import { friendlyError, savePlayerName } from '../../net/playerName';
import { Dialog } from '../../ui/Dialog';
import { ArrowRightIcon, CloseIcon, UserIcon, UsersIcon } from '../../ui/icons';

interface BulletDialogProps {
  open: boolean;
  name: string;
  onNameChange: (name: string) => void;
  onClose: () => void;
  onCreated: (room: PuzzleRoom) => void;
}

const PLAYER_OPTIONS = Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 2); // 2, 3, 4

/** Criar um Bullet: tempo, tamanho dos quebra-cabeças e quem joga (as fotos são sorteadas). */
export function BulletDialog({ open, name, onNameChange, onClose, onCreated }: BulletDialogProps) {
  const [solo, setSolo] = useState(true);
  const [players, setPlayers] = useState(2);
  const [minutes, setMinutes] = useState<(typeof BULLET_MINUTES)[number]>(5);
  const [pieces, setPieces] = useState<(typeof BULLET_PIECES)[number]>(12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Digite seu nome.');
    savePlayerName(trimmed);
    setBusy(true);
    setError(undefined);
    try {
      onCreated(
        await createBulletRoom({
          name: trimmed,
          minutes,
          pieces,
          maxPlayers: solo ? 1 : players,
        }),
      );
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="bullet-dialog-title">
      <form className="play-form mode-dialog" onSubmit={handleSubmit}>
        <header className="play-header">
          <h2 id="bullet-dialog-title">Bullet</h2>
          <p>
            Monte o máximo de quebra-cabeças pequenos até o tempo acabar. Terminou um, entra outro
            (fotos sorteadas).
          </p>
        </header>

        <fieldset className="mode-options">
          <legend>Como jogar</legend>
          <label className="mode-option">
            <input
              type="radio"
              name="bullet-mode"
              className="sr-only"
              checked={solo}
              onChange={() => setSolo(true)}
            />
            <UserIcon size={20} />
            <strong>Solo</strong>
            <small>O relógio começa na hora.</small>
          </label>
          <label className="mode-option">
            <input
              type="radio"
              name="bullet-mode"
              className="sr-only"
              checked={!solo}
              onChange={() => setSolo(false)}
            />
            <UsersIcon size={20} />
            <strong>Em equipe</strong>
            <small>Todo mundo monta junto, contra o relógio.</small>
          </label>
        </fieldset>

        <div className="choice-rows">
          {!solo && (
            <fieldset className="choice-row">
              <legend>Jogadores</legend>
              {PLAYER_OPTIONS.map((count) => (
                <label key={count} className="radio-chip">
                  <input
                    type="radio"
                    name="bullet-players"
                    className="sr-only"
                    checked={players === count}
                    onChange={() => setPlayers(count)}
                  />
                  {count}
                </label>
              ))}
            </fieldset>
          )}
          <fieldset className="choice-row">
            <legend>Tempo</legend>
            {BULLET_MINUTES.map((value) => (
              <label key={value} className="radio-chip">
                <input
                  type="radio"
                  name="bullet-minutes"
                  className="sr-only"
                  checked={minutes === value}
                  onChange={() => setMinutes(value)}
                />
                {value} min
              </label>
            ))}
          </fieldset>
          <fieldset className="choice-row">
            <legend>Peças</legend>
            {BULLET_PIECES.map((value) => (
              <label key={value} className="radio-chip">
                <input
                  type="radio"
                  name="bullet-pieces"
                  className="sr-only"
                  checked={pieces === value}
                  onChange={() => setPieces(value)}
                />
                {value}
              </label>
            ))}
          </fieldset>
        </div>

        <label className="field">
          Seu nome
          <input
            className="input"
            value={name}
            maxLength={20}
            data-autofocus
            onChange={(e) => onNameChange(e.target.value)}
          />
          <small className="field-hint">É o nome que aparece no ranking do Bullet.</small>
        </label>

        {error && <p className="error">{error}</p>}

        <div className="dialog-actions play-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Criando…' : solo ? 'Começar' : 'Criar sala'}
            {!busy && <ArrowRightIcon size={18} />}
          </button>
        </div>

        <button
          type="button"
          className="tool icon-only play-close"
          aria-label="Fechar"
          onClick={onClose}
        >
          <CloseIcon size={18} />
        </button>
      </form>
    </Dialog>
  );
}
