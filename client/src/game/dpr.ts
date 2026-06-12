import * as Phaser from 'phaser';

/**
 * Device-pixel-ratio handling for the Phaser canvas.
 *
 * Phaser 4 sizes the canvas backing store in CSS pixels and never consults
 * `window.devicePixelRatio` (ScaleManager has no DPR support). On a Retina
 * display that leaves the WebGL framebuffer at half the physical resolution
 * and the browser upscales it, so sprites and especially text look grainy.
 *
 * The fix: run the game in `Scale.NONE`, size the backing store at
 * `cssSize * renderScale` and set `scale.zoom = 1 / renderScale` so the
 * canvas CSS size stays at logical pixels. Input mapping is unaffected —
 * ScaleManager derives `displayScale` from the canvas bounding rect.
 */

/** Backing-store multiplier: the device pixel ratio, clamped to [1, 3] to
 * keep VRAM bounded on high-density mobile screens. */
export function getRenderScale(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.min(Math.max(dpr, 1), 3);
}

/** The render scale a live game is currently using (the inverse of the
 * ScaleManager zoom we set in PhaserGame). 1 when no zoom is applied. */
export function sceneRenderScale(scene: Phaser.Scene): number {
  const zoom = scene.game.scale.zoom;
  return zoom > 0 ? 1 / zoom : 1;
}

/** Resize the game so the backing store matches physical pixels for the
 * container's current CSS size. Safe to call repeatedly. */
export function applyDprSize(game: Phaser.Game, container: HTMLElement): void {
  const scale = getRenderScale();
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) return;

  if (game.scale.zoom !== 1 / scale) {
    game.scale.setZoom(1 / scale);
  }
  game.scale.resize(Math.floor(width * scale), Math.floor(height * scale));
}
