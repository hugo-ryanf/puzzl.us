import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccountView, LibraryResponse, PuzzleRecord } from '@puzzle/shared';

export interface Library {
  records: PuzzleRecord[];
  favorites: ReadonlySet<string>;
  /** Fotos já montadas → melhor tempo (em qualquer tamanho/modalidade). */
  completed: ReadonlyMap<string, number>;
  toggleFavorite: (imageId: string) => void;
  /** Busca de novo (ex.: ao sair de uma sala, que pode ter terminado com um record novo). */
  refresh: () => void;
}

const EMPTY: LibraryResponse = { records: [], favorites: [] };

/** Records e favoritos da conta logada; convidado fica com tudo vazio. */
export function useLibrary(user: AccountView | null | undefined): Library {
  const [data, setData] = useState<LibraryResponse>(EMPTY);
  const [version, setVersion] = useState(0);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let current = true;
    fetch('/api/me/library')
      .then((response) => (response.ok ? (response.json() as Promise<LibraryResponse>) : EMPTY))
      .then((library) => current && setData(library))
      .catch(() => current && setData(EMPTY));
    return () => {
      current = false;
    };
  }, [userId, version]);

  const favorites = useMemo(() => new Set(userId ? data.favorites : []), [userId, data.favorites]);
  const records = useMemo(() => (userId ? data.records : []), [userId, data.records]);
  const completed = useMemo(() => {
    const best = new Map<string, number>();
    for (const record of records) {
      const previous = best.get(record.imageId);
      if (previous === undefined || record.bestMs < previous)
        best.set(record.imageId, record.bestMs);
    }
    return best;
  }, [records]);

  const toggleFavorite = useCallback(
    (imageId: string) => {
      const favorite = !favorites.has(imageId);
      // Otimista: o marcador muda na hora; se o servidor recusar, a próxima busca corrige.
      setData((previous) => ({
        ...previous,
        favorites: favorite
          ? [imageId, ...previous.favorites]
          : previous.favorites.filter((id) => id !== imageId),
      }));
      void fetch(`/api/me/favorites/${encodeURIComponent(imageId)}`, {
        method: favorite ? 'PUT' : 'DELETE',
      }).then((response) => {
        if (!response.ok) setVersion((v) => v + 1);
      });
    },
    [favorites],
  );

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return { records, favorites, completed, toggleFavorite, refresh };
}
