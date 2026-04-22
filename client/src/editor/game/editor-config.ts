import * as Phaser from 'phaser';
import { EditorBootScene } from './scenes/EditorBootScene';
import { EditorScene } from './scenes/EditorScene';

export const editorGameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#1a1a2e',
  scene: [EditorBootScene, EditorScene],
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
