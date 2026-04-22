import * as Phaser from 'phaser';
import { editorBridge } from '../../EditorBridge';
import type { AssetManifest, MapConfig, SlotInfo } from '../../types/map';
import { SERVER_URL } from '../../../config';
import { getActiveThemeId } from '../../../game/themes/registry';
import { registerAnimations } from '../../../game/data/asset-loader';
import { groupMissingByCategory } from '../../../game/data/asset-diagnostics';

export class EditorBootScene extends Phaser.Scene {
  private statusText: Phaser.GameObjects.Text | null = null;
  private manifest: AssetManifest | null = null;
  private initialMap: MapConfig | null = null;
  private slotInfo: SlotInfo[] = [];
  private activeSlot = 1;
  private missingAssets: string[] = [];

  constructor() {
    super({ key: 'EditorBootScene' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1a1a2e');
    this.statusText = this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
      'Loading editor\u2026',
      { fontSize: '18px', color: '#C4A35A', fontFamily: 'Cinzel, serif', resolution: 2 },
    ).setOrigin(0.5);

    void this.startLoading();
  }

  private async startLoading(): Promise<void> {
    try {
      // 1. Fetch the asset manifest for the user's chosen theme. The
      // server picks the right set of paths/tile grids/sheet framing so
      // the editor palette reflects the currently active theme.
      const themeId = getActiveThemeId();
      const mRes = await fetch(`${SERVER_URL}/api/assets/manifest?theme=${encodeURIComponent(themeId)}`);
      if (!mRes.ok) throw new Error(`manifest HTTP ${mRes.status}`);
      this.manifest = (await mRes.json()) as AssetManifest;

      // 2. Fetch slot info to determine which slot to load.
      const slotsRes = await fetch(`${SERVER_URL}/api/map/slots`);
      this.slotInfo = slotsRes.ok ? (await slotsRes.json()) as SlotInfo[] : [];
      const activeEntry = this.slotInfo.find((s) => s.isActive);
      this.activeSlot = activeEntry?.slot ?? 1;

      // 3. Fetch target slot's map, fall back to template, then default
      const cRes = await fetch(`${SERVER_URL}/api/map/${this.activeSlot}`);
      if (cRes.status === 200) {
        this.initialMap = (await cRes.json()) as MapConfig;
      } else {
        // Try template first
        const tRes = await fetch(`${SERVER_URL}/api/map/template`);
        if (tRes.status === 200) {
          this.initialMap = (await tRes.json()) as MapConfig;
        } else {
          const dRes = await fetch(`${SERVER_URL}/api/map/default`);
          if (!dRes.ok) throw new Error(`default map HTTP ${dRes.status}`);
          this.initialMap = (await dRes.json()) as MapConfig;
        }
      }

      // Ensure new fields exist on older map formats
      if (!this.initialMap.npcs) this.initialMap.npcs = [];
      if (!this.initialMap.settings) this.initialMap.settings = { heroScale: 0.50 };

      // 4. Queue asset loads based on manifest
      if (this.statusText !== null) this.statusText.setText('Loading textures\u2026');
      this.queueAssets(this.manifest);

      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        if (this.manifest !== null) registerAnimations(this, this.manifest);
        if (this.missingAssets.length > 0) {
          // Editor stays usable even when some textures are missing — the
          // React banner surfaces the problem so the user can fix it
          // without the scene blocking.
          editorBridge.emit('ed:asset:errors', groupMissingByCategory(this.missingAssets));
          for (const src of this.missingAssets) {
            console.warn('[editor] asset failed to load:', src);
          }
        }
        this.transitionToEditor();
      });
      // `on` (not `once`) so every failure is captured, not just the first.
      this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
        this.missingAssets.push(file.src);
      });
      this.load.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.statusText !== null) {
        this.statusText.setText(`Failed to load: ${msg}`);
        this.statusText.setColor('#8B2500');
      }
    }
  }

  private queueAssets(manifest: AssetManifest): void {
    // Tilesets — spritesheet per tileset
    for (const t of manifest.tilesets) {
      this.load.spritesheet(t.key, t.path, { frameWidth: t.tileWidth, frameHeight: t.tileHeight });
    }

    // Decorations — spritesheet if frameWidth, else plain image
    for (const d of manifest.decorations) {
      if (d.frameWidth !== undefined && d.frameHeight !== undefined) {
        this.load.spritesheet(d.key, d.path, { frameWidth: d.frameWidth, frameHeight: d.frameHeight });
      } else {
        this.load.image(d.key, d.path);
      }
    }

    // Protected buildings — plain images with textureKey `building-${id}`
    for (const b of manifest.protectedBuildings) {
      this.load.image(`building-${b.id}`, b.path);
    }

    // NPC sprites — idle + run spritesheets
    for (const npc of manifest.npcSprites ?? []) {
      this.load.spritesheet(npc.idleKey, npc.idlePath, { frameWidth: npc.frameWidth, frameHeight: npc.frameHeight });
      this.load.spritesheet(npc.runKey, npc.runPath, { frameWidth: npc.frameWidth, frameHeight: npc.frameHeight });
    }
  }

  private transitionToEditor(): void {
    if (this.manifest === null || this.initialMap === null) return;
    if (this.statusText !== null) this.statusText.destroy();

    // Emit slot info so React panels can render immediately
    editorBridge.emit('ed:slots:updated', this.slotInfo);

    this.scene.start('EditorScene', {
      manifest: this.manifest,
      initialMap: this.initialMap,
      slotInfo: this.slotInfo,
      activeSlot: this.activeSlot,
    });
  }
}
