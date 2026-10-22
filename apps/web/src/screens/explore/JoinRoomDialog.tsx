import { useState, type FormEvent } from 'react';
import { joinRoom, type PuzzleRoom } from '../../net/connection';
import { friendlyError, savePlayerName } from '../../net/playerName';
import { Dialog } from '../../ui/Dialog';

interface JoinRoomDialogProps {
  open: boolean;
  /** Código que veio no link de convite (já preenchido). */
  initialCode: string;
  name: string;
  onNameChange: (name: string) => void;
  /** Logado: o nome é o nickname do perfil (só mostra, não edita). */
  nameLocked?: boolean;
  onClose: () => void;
  onJoined: (room: PuzzleRoom) => void;
}

export function JoinRoomDialog({
  open,
  initialCode,
  name,
  onNameChange,
  nameLocked = false,
  onClose,
  onJoined,
}: JoinRoomDialogProps) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    const roomCode = code.trim().toUpperCase();
    if (!trimmed) return setError('Digite seu nome.');
    if (!roomCode) return setError('Digite o código da sala.');
    savePlayerName(trimmed);
    setBusy(true);
    setError(undefined);
    try {
      onJoined(await joinRoom(roomCode, { name: trimmed }));
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} labelledBy="join-title">
      <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
        <h2 id="join-title">Entrar com código</h2>
        {nameLocked ? (
          <p className="field-hint locked-name">
            Você entra como <strong>{name}</strong>, o nickname do seu perfil.
          </p>
        ) : (
          <label className="field">
            Seu nome
            <input
              className="input"
              value={name}
              maxLength={20}
              autoFocus={!name}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </label>
        )}
        <label className="field">
          Código da sala
          <input
            className="input code-input"
            value={code}
            maxLength={5}
            placeholder="K7QF2"
            autoFocus={!!name || nameLocked}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
