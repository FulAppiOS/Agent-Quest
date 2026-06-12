import { useEffect, useRef } from 'react';
import * as Phaser from 'phaser';
import { gameConfig } from './config';
import { applyDprSize, getRenderScale } from './dpr';

export function PhaserGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (containerRef.current === null) return;
    if (gameRef.current !== null) return;

    const container = containerRef.current;
    const renderScale = getRenderScale();

    const game = new Phaser.Game({
      ...gameConfig,
      parent: container,
      scale: {
        ...gameConfig.scale,
        // Backing store at physical pixels, CSS at logical pixels (zoom).
        // The container is laid out by the time this effect runs, so its
        // client size is the real viewport.
        width: Math.max(1, Math.floor(container.clientWidth * renderScale)),
        height: Math.max(1, Math.floor(container.clientHeight * renderScale)),
        zoom: 1 / renderScale,
      },
    });

    gameRef.current = game;

    // Scale.NONE means Phaser no longer tracks the parent — resize manually.
    const resizeObserver = new ResizeObserver(() => applyDprSize(game, container));
    resizeObserver.observe(container);

    // ResizeObserver misses DPR-only changes (window dragged between a
    // Retina and a non-Retina display without the CSS size changing), so
    // also watch the media query — same technique as text.ts.
    let dprQuery: MediaQueryList | null = null;
    const onDprChange = () => {
      applyDprSize(game, container);
      watchDpr();
    };
    const watchDpr = () => {
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprQuery.addEventListener('change', onDprChange, { once: true });
    };
    watchDpr();

    return () => {
      resizeObserver.disconnect();
      dprQuery?.removeEventListener('change', onDprChange);
      game.destroy(true);
      gameRef.current = null;
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
