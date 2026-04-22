import { useEffect, useRef } from 'react';
import * as Phaser from 'phaser';
import { editorGameConfig } from './game/editor-config';

export function EditorPhaserGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (containerRef.current === null) return;
    if (gameRef.current !== null) return;

    const game = new Phaser.Game({
      ...editorGameConfig,
      parent: containerRef.current,
    });
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        touchAction: 'none',
      }}
    />
  );
}
