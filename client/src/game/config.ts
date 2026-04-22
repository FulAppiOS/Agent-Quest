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
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    touch: true,
    mouse: true,
  },
  banner: false,
};
