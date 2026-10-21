import { useState, type ChangeEvent } from 'react';
import { uploadImage, type UploadedImage } from '../../net/uploads';
import { CameraIcon } from '../../ui/icons';

interface UploadCardProps {
  uploaded?: UploadedImage;
  onUploaded: (image: UploadedImage) => void;
  onPlay: () => void;
}

/**
 * Primeiro card da grade. Sem foto: tracejado, abre o seletor de arquivos. Com foto: vira um card
 * como os do catálogo (clicar abre "Criar sala"), com a opção de trocar.
 */
export function UploadCard({ uploaded, onUploaded, onPlay }: UploadCardProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    setUploading(true);
    setError(undefined);
    try {
      onUploaded(await uploadImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  const picker = (label: string) => (
    <input
      type="file"
      accept="image/*"
      className="sr-only"
      aria-label={label}
      disabled={uploading}
      onChange={handleFile}
    />
  );

  if (uploaded && !uploading) {
    return (
      <article className="card">
        <button type="button" className="card-hit" onClick={onPlay}>
          <span className="card-thumb">
            <img src={uploaded.previewUrl} alt="" />
            <span className="card-badge">Fora do ranking</span>
          </span>
          <h2 className="card-title">Sua foto</h2>
        </button>
        <div className="card-meta">
          <span className="credit">Enviada por você</span>
          {/* <label> clicável abre o seletor; o input fica escondido mas acessível. */}
          <label className="btn">
            {picker('Trocar sua foto')}
            Trocar
          </label>
        </div>
        {error && <p className="error">{error}</p>}
      </article>
    );
  }

  return (
    <label className={uploading ? 'upload-card busy' : 'upload-card'}>
      {picker('Enviar sua foto')}
      <span className="upload-mark">
        <CameraIcon size={24} />
      </span>
      <strong>{uploading ? 'Enviando…' : 'Enviar sua foto'}</strong>
      <small>JPG, PNG ou WEBP · vira um quebra-cabeça só seu (fora do ranking)</small>
      {error && <span className="error">{error}</span>}
    </label>
  );
}
