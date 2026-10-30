import { useState } from 'react';
import type { CommunityPuzzle } from '@puzzle/shared';
import { formatDuration } from '../../format';
import { BookmarkIcon, CheckIcon, FlagIcon, MoreIcon, TrophyIcon } from '../../ui/icons';
import { Popover } from '../../ui/Popover';
import { t, tRich } from '../../i18n';

/** O que o card precisa de uma foto, seja do catálogo ou da comunidade. */
export interface PuzzleImage {
  id: string;
  title: string;
  credit: string;
  width: number;
  height: number;
}

/** Ações de moderação de um quebra-cabeça da comunidade (só as permitidas vêm preenchidas). */
export interface CommunityActions {
  puzzle: CommunityPuzzle;
  onReport?: () => Promise<void>;
  onRemove?: () => Promise<void>;
  onRestore?: () => Promise<void>;
}

interface PuzzleCardProps {
  image: PuzzleImage;
  thumbUrl: string;
  onPlay: () => void;
  onShowRanking: () => void;
  /** Melhor tempo, se a pessoa já montou esta foto (mostra o selo "Montado"). */
  completedMs?: number;
  favorite?: boolean;
  /** Sem ele (servidor sem login), o marcador de favorito não aparece. */
  onToggleFavorite?: () => void;
  /** Publicado por um jogador: selo "Comunidade", autor e o menu de denunciar/remover. */
  community?: CommunityActions;
}

export const orientationOf = (image: { width: number; height: number }) =>
  image.width >= image.height ? 'Horizontal' : 'Vertical';

/** No card só cabe o nome: "Foto de Adrian Botica no Unsplash" → "Adrian Botica". */
const shortCredit = (credit: string) =>
  /^(?:Foto de|Photo by) (.+) (?:no|on) \S+$/.exec(credit)?.[1] ?? credit;

/**
 * Card do catálogo: foto + título abrem "Criar sala"; o troféu abre o ranking da foto; o
 * marcador favorita; o selo verde avisa que você já montou.
 */
export function PuzzleCard({
  image,
  thumbUrl,
  onPlay,
  onShowRanking,
  completedMs,
  favorite = false,
  onToggleFavorite,
  community,
}: PuzzleCardProps) {
  const hidden = community?.puzzle.status === 'hidden';
  return (
    <article className={hidden ? 'card hidden-puzzle' : 'card'}>
      <button type="button" className="card-hit" onClick={onPlay}>
        <span className="card-thumb">
          <img src={thumbUrl} alt="" loading="lazy" />
          <span className="card-badges">
            <span className="card-badge">{orientationOf(image)}</span>
            {community && <span className="card-badge community">{t('Comunidade')}</span>}
            {hidden && (
              <span className="card-badge warning">
                {t('Oculta · {n} denúncias', { n: community.puzzle.reports })}
              </span>
            )}
            {completedMs !== undefined && (
              <span
                className="card-badge done"
                title={t('Você já montou · melhor tempo {time}', {
                  time: formatDuration(completedMs),
                })}
              >
                <CheckIcon size={12} />
                {t('Montado')}
              </span>
            )}
          </span>
        </span>
        <h2 className="card-title">{image.title}</h2>
      </button>
      {/* Fora do botão do card (botão dentro de botão não vale): fica por cima, no canto. */}
      {onToggleFavorite && (
        <button
          type="button"
          className={favorite ? 'card-favorite on' : 'card-favorite'}
          aria-pressed={favorite}
          aria-label={
            favorite
              ? t('Tirar {title} dos favoritos', { title: image.title })
              : t('Favoritar {title}', { title: image.title })
          }
          title={favorite ? t('Tirar dos favoritos') : t('Favoritar para montar depois')}
          onClick={onToggleFavorite}
        >
          <BookmarkIcon size={17} />
        </button>
      )}
      <div className="card-meta">
        {/* O crédito completo fica no title e aparece inteiro no diálogo e na sala. */}
        <span className="credit" title={image.credit}>
          {community
            ? image.credit
            : image.credit
              ? shortCredit(image.credit)
              : t('Foto do catálogo')}
        </span>
        {community && <CommunityMenu title={image.title} actions={community} />}
        <button
          type="button"
          className="btn"
          onClick={onShowRanking}
          aria-label={t('Ranking de {title}', { title: image.title })}
        >
          <TrophyIcon size={16} />
          Ranking
        </button>
      </div>
    </article>
  );
}

type Pending = 'report' | 'remove';

/** "⋯" do card da comunidade: denunciar, remover (autor/admin) e restaurar (admin). */
function CommunityMenu({ title, actions }: { title: string; actions: CommunityActions }) {
  const { puzzle, onReport, onRemove, onRestore } = actions;
  const [confirming, setConfirming] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(action: (() => Promise<void>) | undefined) {
    if (!action) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
      setConfirming(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      label={t('Opções de {name}', { name: title })}
      triggerClassName="btn btn-ghost icon-only card-more"
      trigger={<MoreIcon size={18} />}
    >
      <div className="menu-list">
        <p className="popover-note">
          {tRich('Publicado por {name}', { name: <strong>{puzzle.authorName}</strong> })}
        </p>
        {confirming === 'report' ? (
          <>
            <p className="popover-note">{t('Denunciar como imprópria ou sem direito de uso?')}</p>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void run(onReport)}
            >
              <FlagIcon size={16} />
              {t('Confirmar denúncia')}
            </button>
          </>
        ) : confirming === 'remove' ? (
          <>
            <p className="popover-note">{t('Tirar do Explorar para todo mundo?')}</p>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void run(onRemove)}
            >
              {t('Confirmar remoção')}
            </button>
          </>
        ) : (
          <>
            {puzzle.reported ? (
              <p className="popover-note">{t('Você já denunciou esta foto.')}</p>
            ) : (
              onReport && (
                <button type="button" className="btn" onClick={() => setConfirming('report')}>
                  <FlagIcon size={16} />
                  {t('Denunciar')}
                </button>
              )
            )}
            {onRestore && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void run(onRestore)}
              >
                {t('Voltar ao ar')}
              </button>
            )}
            {onRemove && (
              <button type="button" className="btn" onClick={() => setConfirming('remove')}>
                {t('Remover')}
              </button>
            )}
          </>
        )}
        {error && <p className="popover-note error">{error}</p>}
      </div>
    </Popover>
  );
}
