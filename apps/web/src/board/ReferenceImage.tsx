import { useEffect, useState } from 'react';
import { CloseIcon } from '../ui/icons';

interface ReferenceImageProps {
  src: string;
  onClose: () => void;
}

/**
 * Foto montada como referência: pequena no canto; um clique amplia no meio da mesa, e clicar
 * fora (ou Esc) devolve ao canto. O X fecha de vez.
 */
export function ReferenceImage({ src, onClose }: ReferenceImageProps) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  const image = <img src={src} alt="Imagem do quebra-cabeça montado" />;

  return (
    <>
      {/* Fundo escuro clicável: "clicar fora" reduz a foto (e evita mexer em peças sem querer). */}
      {expanded && <div className="reference-backdrop" onClick={() => setExpanded(false)} />}
      <figure className={expanded ? 'reference-image expanded' : 'reference-image'}>
        {expanded ? (
          image
        ) : (
          <button
            type="button"
            className="reference-zoom"
            aria-label="Ampliar imagem"
            onClick={() => setExpanded(true)}
          >
            {image}
          </button>
        )}
        <button
          type="button"
          className="tool icon-only"
          aria-label="Fechar imagem"
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </figure>
    </>
  );
}
