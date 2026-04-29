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

    // Label above building — image top is at y - displayHeight (since origin is bottom)
    const labelY = def.y - this.image.displayHeight - 8;
    const labelFont = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
    this.label = addCrispText(scene, def.x, labelY, def.label, {
      fontSize: '15px',
      fontStyle: '600',
      color: '#F5E6C8',
      fontFamily: labelFont,
      stroke: '#000000',
      strokeThickness: 2,
      shadow: { offsetX: 0, offsetY: 1, color: '#000', blur: 3, fill: true },
    }).setOrigin(0.5, 1).setDepth(this.doorY + 0.1);

    // Subtitle (description) below the label — pushed 5px down to clear the
    // title's descenders and avoid muddiness in the overlap zone.
    addCrispText(scene, def.x, labelY + 5, def.activity, {
      fontSize: '11px',
      color: '#d8d8d8',
      fontFamily: labelFont,
      stroke: '#000000',
      strokeThickness: 1,
      shadow: { offsetX: 0, offsetY: 1, color: '#000', blur: 2, fill: true },
    }).setOrigin(0.5, 0).setDepth(this.doorY + 0.1);
  }
}
