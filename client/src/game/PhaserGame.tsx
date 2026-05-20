import { useEffect, useRef } from 'react';
import * as Phaser from 'phaser';
import { gameConfig } from './config';

// React StrictMode (dev) mounts twice — mount → cleanup → mount. A useRef-per-
// component pattern lets cleanup destroy() the game before the second mount
// builds a fresh one, but Phaser's LoaderPlugin keeps in-flight HTTP requests
// alive past destroy(). Both Phaser.Game instances then fetch the same ~80-file
// asset batch in parallel, saturate the browser's HTTP/1.1 connection pool,
// and hang preload at ~31/83.
//
// Anchor the game to a module-level slot: the second mount reuses the existing
// instance and reparents the canvas. Cleanup defers destruction so a fast
// remount can cancel it. The game tears down only on genuine unmount.
let liveGame: Phaser.Game | null = null;
let pendingDestroy: ReturnType<typeof setTimeout> | null = null;

export function PhaserGame() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current === null) return;

    if (pendingDestroy !== null) {
      clearTimeout(pendingDestroy);
      pendingDestroy = null;
    }

    if (liveGame === null) {
      liveGame = new Phaser.Game({
        ...gameConfig,
        parent: containerRef.current,
      });
    } else if (liveGame.scale.parent !== containerRef.current) {
      containerRef.current.appendChild(liveGame.canvas);
      liveGame.scale.parent = containerRef.current;
      liveGame.scale.refresh();
    }

    return () => {
      pendingDestroy = setTimeout(() => {
        liveGame?.destroy(true);
        liveGame = null;
        pendingDestroy = null;
      }, 0);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
        touchAction: 'none',
      }}
    />
  );
}
