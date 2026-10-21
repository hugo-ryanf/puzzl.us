import { useState } from 'react';
import { CATALOG, type CatalogImage } from '@puzzle/shared';
import { catalogThumbUrl } from '../../board/images';
import type { PuzzleRoom } from '../../net/connection';
import type { Library } from '../../net/library';
import { ChevronDownIcon, FilterIcon, SearchIcon } from '../../ui/icons';
import { CreateRoomDialog, type CreateRoomSource, type PuzzleChoice } from './CreateRoomDialog';
import { JoinRoomDialog } from './JoinRoomDialog';
import { PuzzleCard, orientationOf } from './PuzzleCard';

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
  /** "favorites": só os favoritos da conta (aba Favoritos da barra lateral). */
  view?: 'all' | 'favorites';
  library: Library;
  /** Logado: favorita. Convidado (com login no servidor): o marcador leva ao login. */
  signedIn: boolean;
  googleLogin: boolean;
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
  view = 'all',
  library,
  signedIn,
  googleLogin,
}: ExploreScreenProps) {
  const [query, setQuery] = useState('');
  const [orientation, setOrientation] = useState<Orientation>('Todas');
  const [choice, setChoice] = useState<PuzzleChoice | null>(null);

  const favoritesOnly = view === 'favorites';
  const q = normalize(query);
  const items = CATALOG.filter(
    (image) =>
      (!favoritesOnly || library.favorites.has(image.id)) &&
      (orientation === 'Todas' || orientationOf(image) === orientation) &&
      (!q || normalize(image.title).includes(q)),
  );
  // Convidado: o marcador aparece, mas leva ao login (favoritos ficam guardados na conta).
  const toggleFavorite = (imageId: string) =>
    signedIn
      ? () => library.toggleFavorite(imageId)
      : googleLogin
        ? () => location.assign('/auth/google')
        : undefined;
  const filtering = q !== '' || orientation !== 'Todas';

  // Clique num card = jogar aquela foto; "Criar sala" da barra lateral = sala personalizada
  // (o único caminho para jogar com uma foto própria).
  const dialogSource: CreateRoomSource = choice ?? (createRequested ? 'custom' : null);

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
          <h1>{favoritesOnly ? 'Favoritos' : 'Explorar'}</h1>
          <p>
            {items.length === 1 ? '1 imagem' : `${items.length} imagens`} ·{' '}
            {favoritesOnly ? 'separadas para montar depois' : 'escolha uma para jogar'}
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
        {items.map((image) => (
          <PuzzleCard
            key={image.id}
            image={image}
            onPlay={() => setChoice(catalogChoice(image))}
            onShowRanking={() => onShowRanking(image.id)}
            completedMs={library.completed.get(image.id)}
            favorite={library.favorites.has(image.id)}
            onToggleFavorite={toggleFavorite(image.id)}
          />
        ))}
      </div>

      {favoritesOnly && !filtering && items.length === 0 && (
        <div className="empty">
          <strong>{signedIn ? 'Nenhum favorito ainda' : 'Entre para ter favoritos'}</strong>
          <p>
            {signedIn
              ? 'Toque no marcador de um quebra-cabeça para guardar aqui e montar depois.'
              : 'Os favoritos ficam na sua conta, em qualquer aparelho.'}
          </p>
          {!signedIn && googleLogin && (
            <a className="btn" href="/auth/google">
              Entrar com Google
            </a>
          )}
        </div>
      )}

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
        // Estado novo (modo, peças, foto enviada, erro) a cada abertura.
        key={`criar:${typeof dialogSource === 'string' ? dialogSource : (dialogSource?.imageId ?? 'fechado')}`}
        source={dialogSource}
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
