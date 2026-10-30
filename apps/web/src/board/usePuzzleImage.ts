import { useEffect, useState } from 'react';
import { loadPuzzleImage } from './images';
import { t } from '../i18n';

interface Loaded {
  /** De qual imagem é este resultado: se não bate com a pedida, ainda está carregando. */
  id: string;
  image?: HTMLImageElement;
  error?: string;
}

/** Carrega a foto do puzzle (catálogo ou enviada); `undefined` enquanto baixa. */
export function usePuzzleImage(id: string): Loaded | undefined {
  const [loaded, setLoaded] = useState<Loaded>();

  useEffect(() => {
    let current = true; // ignora o resultado se a imagem pedida mudou no meio do caminho
    loadPuzzleImage(id)
      .then((image) => current && setLoaded({ id, image }))
      .catch(() => current && setLoaded({ id, error: t('Não foi possível carregar a imagem.') }));
    return () => {
      current = false;
    };
  }, [id]);

  return loaded?.id === id ? loaded : undefined;
}
