import * as Phaser from 'phaser';
import type { BuildingDef } from '../data/building-layout';
import { eventBridge } from '../EventBridge';
import { addCrispText } from '../text';
import { getActiveTheme } from '../themes/registry';

export class Building {
  readonly def: BuildingDef;
  readonly image: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
  readonly doorX: number;
  readonly doorY: number;

  constructor(scene: Phaser.Scene, def: BuildingDef) {
    this.def = def;

    this.image = scene.add.image(def.x, def.y, def.imageKey);
    this.image.setOrigin(0.5, 1); // bottom-center — matches editor coordinate system
    // Theme can override the default scale when its building PNG has a
    // different native size than the BuildingDef baseline.
    const themeScale = getActiveTheme().getBuildingScale?.(def.id);
    this.image.setScale(themeScale ?? def.scale);
    this.image.setInteractive({ useHandCursor: true });

    // Click handler — emit the building id AND the pointer's screen-space
    // position so the React panel can anchor itself next to the clicked
    // structure instead of always opening at the viewport center.
    this.image.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      eventBridge.emit('building:clicked', {
        id: def.id,
        screenX: pointer.x,
        screenY: pointer.y,
      });
    });

    // Hover highlight
    this.image.on('pointerover', () => {
      this.image.setTint(0xdddddd);
    });
    this.image.on('pointerout', () => {
      this.image.clearTint();
    });

    // Door position: just below the image bottom (origin is bottom-center, so y IS the bottom)
    this.doorX = def.x;
    this.doorY = def.y + 5;

    // Y-based depth: use doorY (bottom edge) so heroes sort correctly
    this.image.setDepth(this.doorY);

    // Activity label above building — shows what heroes do here (THINKING,
    // EDITING, etc.) instead of the building's proper name. Cleaner for PiP.
    const labelY = def.y - this.image.displayHeight - 8;
    this.label = addCrispText(scene, def.x, labelY, def.activity.toUpperCase(), {
      fontSize: '17px',
      fontStyle: '600',
      color: '#F5E6C8',
      fontFamily: "'Fira Code', monospace",
      backgroundColor: 'rgba(0,0,0,0.6)',
      padding: { x: 6, y: 3 },
    }).setOrigin(0.5, 1).setDepth(this.doorY + 0.1);
  }
}
