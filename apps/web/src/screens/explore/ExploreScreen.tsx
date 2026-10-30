import { useState } from 'react';
import { CATALOG, type CommunityPuzzle } from '@puzzle/shared';
import { catalogThumbUrl, localizedCatalogImage } from '../../board/images';
import type { Community } from '../../net/community';
import type { PuzzleRoom } from '../../net/connection';
import type { Library } from '../../net/library';
import { ChevronDownIcon, FilterIcon, SearchIcon } from '../../ui/icons';
import { CreateRoomDialog, type CreateRoomSource, type PuzzleChoice } from './CreateRoomDialog';
import { JoinRoomDialog } from './JoinRoomDialog';
import { PuzzleCard, orientationOf, type CommunityActions, type PuzzleImage } from './PuzzleCard';
import { t } from '../../i18n';

type Orientation = 'Todas' | 'Horizontal' | 'Vertical';
const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: 'Todas', label: t('Todas') },
  { value: 'Horizontal', label: t('Horizontais') },
  { value: 'Vertical', label: t('Verticais') },
];

/** Busca sem acento e sem caixa: "patio" acha "Pátio com chafariz". */
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Um card do Explorar: foto do catálogo ou publicada por alguém. */
interface ExploreItem {
  image: PuzzleImage;
  thumbUrl: string;
  puzzle?: CommunityPuzzle;
}

const catalogItems: ExploreItem[] = CATALOG.map((image) => ({
  image: localizedCatalogImage(image),
  thumbUrl: catalogThumbUrl(image.id),
}));

function communityItem(puzzle: CommunityPuzzle): ExploreItem {
  return {
    image: {
      id: puzzle.imageId,
      title: puzzle.title,
      credit: t('por {author}', { author: puzzle.authorName }),
      width: puzzle.width,
      height: puzzle.height,
    },
    thumbUrl: `/api/puzzles/${puzzle.id}/mini`,
    puzzle,
  };
}

function choiceOf({ image, thumbUrl }: ExploreItem): PuzzleChoice {
  return {
    imageId: image.id,
    title: image.title,
    subtitle: image.credit || t('Foto do catálogo'),
    thumbUrl,
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
  /** Quebra-cabeças publicados pelos jogadores (aparecem depois do catálogo). */
  community: Community;
  isAdmin: boolean;
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
  community,
  isAdmin,
}: ExploreScreenProps) {
  const [query, setQuery] = useState('');
  const [orientation, setOrientation] = useState<Orientation>('Todas');
  const [choice, setChoice] = useState<PuzzleChoice | null>(null);

  const favoritesOnly = view === 'favorites';
  const q = normalize(query);
  const items = [...catalogItems, ...community.puzzles.map(communityItem)].filter(
    ({ image }) =>
      (!favoritesOnly || library.favorites.has(image.id)) &&
      (orientation === 'Todas' || orientationOf(image) === orientation) &&
      (!q || normalize(image.title).includes(q) || normalize(image.credit).includes(q)),
  );
  /** Só as ações que esta pessoa pode fazer: denunciar (logada, não é dela), remover, restaurar. */
  const actionsFor = (puzzle: CommunityPuzzle): CommunityActions => ({
    puzzle,
    onReport: signedIn && !puzzle.mine ? () => community.report(puzzle.id) : undefined,
    onRemove: puzzle.mine || isAdmin ? () => community.remove(puzzle.id) : undefined,
    onRestore:
      isAdmin && puzzle.status === 'hidden' ? () => community.restore(puzzle.id) : undefined,
  });
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
          <span className="sr-only">{t('Buscar imagens')}</span>
          <input
            type="search"
            placeholder={t('Buscar por título…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-lg" disabled title={t('Em breve')}>
          <FilterIcon size={18} />
          {t('Filtros')}
          <span className="soon">{t('em breve')}</span>
        </button>
        <button type="button" className="btn btn-lg" disabled title={t('Em breve')}>
          <span style={{ color: 'var(--text-3)' }}>{t('Ordenar:')}</span>
          {t('Mais populares')}
          <ChevronDownIcon size={18} />
          <span className="soon">{t('em breve')}</span>
        </button>
      </div>

      {notice && <p className="notice">{notice}</p>}

      <div className="page-header">
        <div>
          <h1>{favoritesOnly ? t('Favoritos') : t('Explorar')}</h1>
          <p>
            {items.length === 1 ? t('1 imagem') : t('{n} imagens', { n: items.length })} ·{' '}
            {favoritesOnly ? t('separadas para montar depois') : t('escolha uma para jogar')}
          </p>
        </div>
        <div className="chips" role="group" aria-label={t('Orientação')}>
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
        {items.map((item) => (
          <PuzzleCard
            key={item.image.id}
            image={item.image}
            thumbUrl={item.thumbUrl}
            onPlay={() => setChoice(choiceOf(item))}
            onShowRanking={() => onShowRanking(item.image.id)}
            completedMs={library.completed.get(item.image.id)}
            favorite={library.favorites.has(item.image.id)}
            onToggleFavorite={toggleFavorite(item.image.id)}
            community={item.puzzle && actionsFor(item.puzzle)}
          />
        ))}
      </div>

      {favoritesOnly && !filtering && items.length === 0 && (
        <div className="empty">
          <strong>{signedIn ? t('Nenhum favorito ainda') : t('Entre para ter favoritos')}</strong>
          <p>
            {signedIn
              ? t('Toque no marcador de um quebra-cabeça para guardar aqui e montar depois.')
              : t('Os favoritos ficam na sua conta, em qualquer aparelho.')}
          </p>
          {!signedIn && googleLogin && (
            <a className="btn" href="/auth/google">
              {t('Entrar com Google')}
            </a>
          )}
        </div>
      )}

      {filtering && items.length === 0 && (
        <div className="empty">
          <strong>{t('Nenhuma imagem encontrada')}</strong>
          <p>{t('Tente outro termo ou outra orientação.')}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setQuery('');
              setOrientation('Todas');
            }}
          >
            {t('Limpar filtros')}
          </button>
        </div>
      )}

      <CreateRoomDialog
        // Estado novo (modo, peças, foto enviada, erro) a cada abertura.
        key={`criar:${typeof dialogSource === 'string' ? dialogSource : (dialogSource?.imageId ?? 'fechado')}`}
        source={dialogSource}
        name={name}
        onNameChange={onNameChange}
        nameLocked={signedIn}
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
        nameLocked={signedIn}
        onClose={onCloseJoin}
        onJoined={onEnter}
      />
    </>
  );
}
