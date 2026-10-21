import { useState, type FormEvent } from 'react';
import { GlobeIcon } from '../../ui/icons';

export interface Publisher {
  /** Nome que aparece como autor, se a pessoa não trocar. */
  defaultAuthor: string;
  publish: (title: string, authorName: string) => Promise<void>;
}

/**
 * No resultado de uma sala com foto própria: quem enviou a foto (logado) pode publicá-la para
 * todo mundo. Publicada, ela vai para o Explorar e as próximas partidas entram no ranking.
 */
export function PublishSection({ defaultAuthor, publish }: Publisher) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState(defaultAuthor);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await publish(title.trim(), author.trim());
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="result-section publish-section">
      <h3>Publicar para todos</h3>
      {done ? (
        <p className="result-note">
          Publicado! Já está no Explorar, e as próximas partidas com esta foto entram no ranking.
        </p>
      ) : !open ? (
        <div className="publish-intro">
          <p className="result-note">
            Gostou? Publique a foto para qualquer pessoa montar. Ela ganha ranking próprio.
          </p>
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            <GlobeIcon size={18} />
            Publicar…
          </button>
        </div>
      ) : (
        <form className="publish-form" onSubmit={(event) => void submit(event)}>
          <label className="field">
            Título
            <input
              className="input"
              value={title}
              maxLength={60}
              placeholder="Ex.: Pôr do sol na praia"
              autoFocus
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            Autor
            <input
              className="input"
              value={author}
              maxLength={40}
              required
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />
            A foto é minha ou tenho direito de compartilhá-la, e ela não tem nada impróprio.
          </label>
          {error && <p className="error">{error}</p>}
          <div className="publish-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !rights || title.trim().length < 2 || !author.trim()}
            >
              {busy ? 'Publicando…' : 'Publicar'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
