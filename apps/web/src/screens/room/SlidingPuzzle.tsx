import { useRef, type CSSProperties, type PointerEvent } from 'react';
import { CATALOG, EMPTY_TILE, SLIDE_SIZE, canSlide } from '@puzzle/shared';
import { puzzleImageUrl } from '../../board/images';
import { t } from '../../i18n';

/**
 * Foto do relâmpago (a mesma para todo mundo). Se ela ainda não existir, a segunda camada (uma
 * foto do catálogo) aparece no lugar.
 */
const PHOTO = `url(/relampago/foto.webp), url(${puzzleImageUrl(CATALOG[0]!.id)})`;
/** Arrastar menos que isso conta como toque. */
const DRAG_PX = 12;

const rowOf = (position: number) => Math.floor(position / SLIDE_SIZE);
const colOf = (position: number) => position % SLIDE_SIZE;

/**
 * Grade do relâmpago de deslizar: cada peça mostra o seu pedaço da foto e anda até a casa onde
 * está. Tocar numa peça vizinha do vazio, ou arrastá-la na direção dele, desliza. Sem `onSlide`,
 * é só para olhar (o lado do adversário).
 */
export function SlidingPuzzle({
  tiles,
  onSlide,
  label,
}: {
  tiles: number[];
  onSlide?: (index: number) => void;
  label: string;
}) {
  const press = useRef<{ x: number; y: number; position: number }>(undefined);
  const empty = tiles.indexOf(EMPTY_TILE);

  const release = (event: PointerEvent, position: number) => {
    const start = press.current;
    press.current = undefined;
    if (!onSlide || start?.position !== position || !canSlide(tiles, position)) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) >= DRAG_PX) {
      // Arrastou: só vale na direção do vazio.
      const towardX = Math.sign(colOf(empty) - colOf(position));
      const towardY = Math.sign(rowOf(empty) - rowOf(position));
      const along =
        Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) === towardX : Math.sign(dy) === towardY;
      if (!along) return;
    }
    onSlide(position);
  };

  return (
    <div className={onSlide ? 'slide-grid' : 'slide-grid readonly'} role="group" aria-label={label}>
      {tiles.map((tile, position) =>
        tile === EMPTY_TILE ? null : (
          <button
            key={tile}
            type="button"
            className="slide-tile"
            disabled={!onSlide}
            aria-label={t('Peça {n}', { n: tile + 1 })}
            style={
              {
                '--row': rowOf(position),
                '--col': colOf(position),
                backgroundImage: PHOTO,
                backgroundPosition: `${colOf(tile) * 50}% ${rowOf(tile) * 50}%`,
              } as CSSProperties
            }
            onPointerDown={(event) => {
              press.current = { x: event.clientX, y: event.clientY, position };
            }}
            onPointerUp={(event) => release(event, position)}
            onKeyDown={(event) => {
              if ((event.key === 'Enter' || event.key === ' ') && canSlide(tiles, position)) {
                event.preventDefault();
                onSlide?.(position);
              }
            }}
          />
        ),
      )}
    </div>
  );
}
