import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  ImageIcon,
  ScanIcon,
  ShuffleIcon,
  SlidersIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../ui/icons';
import type { BoardScene } from './BoardScene';
import { ReferenceImage } from './ReferenceImage';

interface BoardToolbarProps {
  scene: BoardScene;
  image: HTMLImageElement;
  /** "Espalhar" só vale com o relógio correndo (o servidor também confere). */
  canScatter: boolean;
  onScatter: () => void;
}

/** Atraso para abrir ao passar o mouse: atravessar a barra a caminho de uma peça não a abre. */
const OPEN_DELAY_MS = 150;
/** Atraso para fechar ao sair: dá tempo de voltar com o mouse se escapou sem querer. */
const CLOSE_DELAY_MS = 600;
const ZOOM_STEP = 1.25;

/**
 * Ferramentas da mesa, recolhidas num botãozinho discreto para não atrapalhar a montagem.
 * Abrem ao passar o mouse (e fecham ao sair) ou com um clique, que as fixa até o próximo clique.
 *
 * A barra abre ACIMA do botão, que nunca sai do lugar: quem passa o mouse e clica logo em
 * seguida acerta o botão (fixar), e não uma ferramenta que tivesse aparecido embaixo do cursor.
 */
export function BoardToolbar({ scene, image, canScatter, onScatter }: BoardToolbarProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [showImage, setShowImage] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => scene.onZoom(setZoom), [scene]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const collapse = () => {
    clearTimeout(timer.current);
    setOpen(false);
    setPinned(false);
  };

  const togglePinned = () => {
    clearTimeout(timer.current);
    if (pinned) collapse();
    else {
      setOpen(true);
      setPinned(true);
    }
  };

  const onMouseEnter = (event: MouseEvent) => {
    clearTimeout(timer.current);
    // Botão apertado = arrastando uma peça por cima: não é para abrir.
    if (open || event.buttons !== 0) return;
    timer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };

  const onMouseLeave = () => {
    clearTimeout(timer.current);
    if (!pinned) timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    <>
      <div
        className="board-tools"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !open) return;
          collapse();
          handleRef.current?.focus(); // o foco estava numa ferramenta que sumiu
        }}
      >
        {open && (
          <div className="tools-bar" role="toolbar" aria-label="Ferramentas da mesa">
            <button
              type="button"
              className="tool icon-only"
              aria-label="Afastar"
              onClick={() => scene.zoomBy(1 / ZOOM_STEP)}
            >
              <ZoomOutIcon size={18} />
            </button>
            <span className="tool-zoom" aria-live="polite">
              {zoom}%
            </span>
            <button
              type="button"
              className="tool icon-only"
              aria-label="Aproximar"
              onClick={() => scene.zoomBy(ZOOM_STEP)}
            >
              <ZoomInIcon size={18} />
            </button>
            <span className="tool-divider" aria-hidden="true" />
            <button type="button" className="tool" onClick={() => scene.centerView()}>
              <ScanIcon size={18} />
              Centralizar
            </button>
            <button
              type="button"
              className="tool"
              aria-pressed={showImage}
              onClick={() => setShowImage(!showImage)}
            >
              <ImageIcon size={18} />
              Ver imagem
            </button>
            <button
              type="button"
              className="tool"
              disabled={!canScatter}
              title="Espalha de novo as peças soltas pela mesa (para todos na sala)"
              onClick={onScatter}
            >
              <ShuffleIcon size={18} />
              Espalhar
            </button>
            <span className="tool-divider" aria-hidden="true" />
            {/* As peças vêm viradas: como desvirar. */}
            <span className="tool-hint">Girar: clique direito, R arrastando ou dois toques</span>
          </div>
        )}
        <button
          ref={handleRef}
          type="button"
          className={pinned ? 'tools-handle pinned' : 'tools-handle'}
          aria-expanded={open}
          aria-label={`Ferramentas da mesa (zoom ${zoom}%)`}
          title={pinned ? 'Recolher ferramentas' : 'Fixar ferramentas abertas'}
          onClick={togglePinned}
        >
          <SlidersIcon size={16} />
          <span>{zoom}%</span>
        </button>
      </div>

      {showImage && <ReferenceImage src={image.src} onClose={() => setShowImage(false)} />}
    </>
  );
}
