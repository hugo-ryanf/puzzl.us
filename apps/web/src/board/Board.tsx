import { useEffect, useRef, useState } from 'react';
import type { GamePhase } from '@puzzle/shared';
import type { PuzzleRoom } from '../net/connection';
import { BoardScene, type AttachOptions } from './BoardScene';
import { BoardToolbar } from './BoardToolbar';

interface BoardProps extends AttachOptions {
  room: PuzzleRoom;
  image: HTMLImageElement;
  phase: GamePhase;
}

export function Board({ room, image, phase, source, boardKey, readOnly = false }: BoardProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<BoardScene | null>(null);

  // A inicialização do Pixi é assíncrona; se o componente desmontar antes de terminar
  // (o StrictMode faz isso de propósito em dev), destruímos a cena assim que ela ficar pronta.
  useEffect(() => {
    let disposed = false;
    let created: BoardScene | undefined;
    void BoardScene.create(hostRef.current!).then((newScene) => {
      if (disposed) newScene.destroy();
      else {
        created = newScene;
        setScene(newScene);
      }
    });
    return () => {
      disposed = true;
      created?.destroy();
    };
  }, []);

  useEffect(() => {
    scene?.attach(room, image, { source, boardKey, readOnly });
  }, [scene, room, image, source, boardKey, readOnly]);

  return (
    <>
      <div ref={hostRef} className="board" />
      {scene && (
        <BoardToolbar
          scene={scene}
          image={image}
          canScatter={phase === 'playing' && !readOnly}
          onScatter={() => room.send('scatter', boardKey ? { board: boardKey } : {})}
        />
      )}
    </>
  );
}
