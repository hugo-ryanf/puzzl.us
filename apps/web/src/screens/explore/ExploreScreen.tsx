import { useEffect, useState } from 'react';
import { CATALOG, type CatalogImage } from '@puzzle/shared';
import { catalogThumbUrl } from '../../board/images';
import type { PuzzleRoom } from '../../net/connection';
import type { UploadedImage } from '../../net/uploads';
import { ChevronDownIcon, FilterIcon, SearchIcon } from '../../ui/icons';
import { CreateRoomDialog, type PuzzleChoice } from './CreateRoomDialog';
import { JoinRoomDialog } from './JoinRoomDialog';
import { PuzzleCard, orientationOf } from './PuzzleCard';
import { UploadCard } from './UploadCard';

type Orientation = 'Todas' | 'Horizontal' | 'Vertical';
const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: 'Todas', label: 'Todas' },
  { value: 'Horizontal', label: 'Horizontais' },
  { value: 'Vertical', label: 'Verticais' },
];

/** Busca sem acento e sem caixa: "patio" acha "Pátio com chafariz". */
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

function catalogChoice(image: CatalogImage): PuzzleChoice {
  return {
    imageId: image.id,
    title: image.title,
    subtitle: image.credit || 'Foto do catálogo',
    thumbUrl: catalogThumbUrl(image.id),
  };
}

export interface ExploreScreenProps {
  notice?: string;
  name: string;
  onNameChange: (name: string) => void;
  /** Diálogos abertos pela barra lateral (que fica no App). */
  createRequested: boolean;
  joinOpen: boolean;
  initialCode: string;
  onCloseCreate: () => void;
  onCloseJoin: () => void;
  onEnter: (room: PuzzleRoom) => void;
  onShowRanking: (imageId: string) => void;
}

export function ExploreScreen({
  notice,
  name,
  onNameChange,
  createRequested,
  joinOpen,
  initialCode,
  onCloseCreate,
  onCloseJoin,
  onEnter,
  onShowRanking,
}: ExploreScreenProps) {
  const [query, setQuery] = useState('');
  const [orientation, setOrientation] = useState<Orientation>('Todas');
  const [uploaded, setUploaded] = useState<UploadedImage>();
  const [choice, setChoice] = useState<PuzzleChoice | null>(null);

  // A pré-visualização da foto enviada é um object URL: libera ao trocar de foto ou sair da tela.
  useEffect(() => {
    return () => {
      if (uploaded) URL.revokeObjectURL(uploaded.previewUrl);
    };
  }, [uploaded]);

  const q = normalize(query);
  const items = CATALOG.filter(
    (image) =>
      (orientation === 'Todas' || orientationOf(image) === orientation) &&
      (!q || normalize(image.title).includes(q)),
  );
  const filtering = q !== '' || orientation !== 'Todas';

  // "Criar sala" da barra lateral: sem imagem escolhida ainda, começa pela primeira do catálogo.
  const dialogChoice = choice ?? (createRequested ? catalogChoice(CATALOG[0]!) : null);
  const uploadChoice: PuzzleChoice | null = uploaded
    ? {
        imageId: uploaded.imageId,
        title: 'Sua foto',
        subtitle: 'Fora do ranking',
        thumbUrl: uploaded.previewUrl,
      }
    : null;

  return (
    <>
      <div className="toolbar-row">
        <label className="search">
          <SearchIcon size={18} />
          <span className="sr-only">Buscar imagens</span>
          <input
            type="search"
            placeholder="Buscar por título…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-lg" disabled title="Em breve">
          <FilterIcon size={18} />
          Filtros
          <span className="soon">em breve</span>
        </button>
        <button type="button" className="btn btn-lg" disabled title="Em breve">
          <span style={{ color: 'var(--text-3)' }}>Ordenar:</span>
          Mais populares
          <ChevronDownIcon size={18} />
          <span className="soon">em breve</span>
        </button>
      </div>

      {notice && <p className="notice">{notice}</p>}

      <div className="page-header">
        <div>
          <h1>Explorar</h1>
          <p>
            {items.length === 1 ? '1 imagem' : `${items.length} imagens`} · escolha uma para criar a
            sala
          </p>
        </div>
        <div className="chips" role="group" aria-label="Orientação">
          {ORIENTATIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className="chip"
              aria-pressed={orientation === value}
              onClick={() => setOrientation(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid">
        <UploadCard
          uploaded={uploaded}
          onUploaded={setUploaded}
          onPlay={() => setChoice(uploadChoice)}
        />
        {items.map((image) => (
          <PuzzleCard
            key={image.id}
            image={image}
            onPlay={() => setChoice(catalogChoice(image))}
            onShowRanking={() => onShowRanking(image.id)}
          />
        ))}
      </div>

      {filtering && items.length === 0 && (
        <div className="empty">
          <strong>Nenhuma imagem encontrada</strong>
          <p>Tente outro termo ou outra orientação.</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setQuery('');
              setOrientation('Todas');
            }}
          >
            Limpar filtros
          </button>
        </div>
      )}

      <CreateRoomDialog
        key={`criar:${dialogChoice?.imageId ?? 'fechado'}`} // estado novo (peças, erro) a cada imagem
        choice={dialogChoice}
        name={name}
        onNameChange={onNameChange}
        onClose={() => {
          setChoice(null);
          onCloseCreate();
        }}
        onCreated={onEnter}
      />
      <JoinRoomDialog
        key={joinOpen ? 'entrar:aberto' : 'entrar:fechado'}
        open={joinOpen}
        initialCode={initialCode}
        name={name}
        onNameChange={onNameChange}
        onClose={onCloseJoin}
        onJoined={onEnter}
      />
    </>
  );
}
