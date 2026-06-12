import * as Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { VillageScene } from './scenes/VillageScene';

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  backgroundColor: '#1a1a2e',
  scene: [BootScene, VillageScene],
  // Disable bilinear filtering so pixel-art sprites stay crisp under any
  // upscale. Both Tiny Swords packs are pixel art, so this is safe for
  // every theme we ship.
  pixelArt: true,
  // Scale.NONE because RESIZE forces the canvas backing store to CSS pixels,
  // which on Retina displays renders at half resolution and lets the browser
  // blur-upscale everything. PhaserGame sizes the canvas at physical pixels
  // (cssSize * devicePixelRatio) with zoom = 1/dpr instead — see dpr.ts.
  scale: {
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    touch: true,
    mouse: true,
  },
  banner: false,
};
