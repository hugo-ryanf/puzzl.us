import { useEffect, useState, type ChangeEvent } from 'react';
import { CATALOG } from '@puzzle/shared';
import { catalogThumbUrl } from '../board/images';
import { uploadImage, type UploadedImage } from '../net/uploads';

interface ImagePickerProps {
  value: string;
  onChange: (imageId: string) => void;
  /** Mostra o "Sua foto" (criação de sala). No filtro do ranking não faz sentido. */
  allowUpload?: boolean;
}

/** Grade de miniaturas do catálogo (e, opcionalmente, da foto enviada); a escolhida fica destacada. */
export function ImagePicker({ value, onChange, allowUpload = false }: ImagePickerProps) {
  const [uploaded, setUploaded] = useState<UploadedImage>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();

  // A pré-visualização é um object URL: libera a memória ao trocar de foto ou sair da tela.
  useEffect(() => {
    return () => {
      if (uploaded) URL.revokeObjectURL(uploaded.previewUrl);
    };
  }, [uploaded]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    setUploading(true);
    setError(undefined);
    try {
      const image = await uploadImage(file);
      setUploaded(image);
      onChange(image.imageId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <div className="image-picker" role="radiogroup" aria-label="Imagem do quebra-cabeça">
        {allowUpload && (
          <label className={uploading ? 'upload-tile busy' : 'upload-tile'}>
            <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} hidden />
            <span className="upload-icon">{uploading ? '⏳' : '📷'}</span>
            <span>
              {uploading ? 'Enviando…' : uploaded ? 'Trocar sua foto' : 'Enviar sua foto'}
            </span>
          </label>
        )}
        {uploaded && (
          <Tile
            selected={value === uploaded.imageId}
            onSelect={() => onChange(uploaded.imageId)}
            src={uploaded.previewUrl}
            title="Sua foto"
            tooltip="Sua foto (fora do ranking)"
          />
        )}
        {CATALOG.map((image) => (
          <Tile
            key={image.id}
            selected={image.id === value}
            onSelect={() => onChange(image.id)}
            src={catalogThumbUrl(image.id)}
            title={image.title}
            tooltip={image.credit ? `${image.title} · ${image.credit}` : image.title}
          />
        ))}
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

interface TileProps {
  selected: boolean;
  onSelect: () => void;
  src: string;
  title: string;
  tooltip: string;
}

function Tile({ selected, onSelect, src, title, tooltip }: TileProps) {
  return (
    <button
      type="button" // dentro do <form>: sem isso, clicar enviaria o formulário
      role="radio"
      aria-checked={selected}
      className={selected ? 'selected' : ''}
      onClick={onSelect}
      title={tooltip}
    >
      <img src={src} alt="" loading="lazy" />
      <span>{title}</span>
    </button>
  );
}
