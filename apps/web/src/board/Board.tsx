import { useEffect, useRef, useState } from 'react';
import type { PuzzleRoom } from '../net/connection';
import { BoardScene } from './BoardScene';

interface BoardProps {
  room: PuzzleRoom;
  image: HTMLImageElement;
}

export function Board({ room, image }: BoardProps) {
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
    scene?.attach(room, image);
  }, [scene, room, image]);

  return <div ref={hostRef} className="board" />;
}
