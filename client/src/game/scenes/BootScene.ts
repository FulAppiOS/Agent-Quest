import * as Phaser from 'phaser';
import { eventBridge } from '../EventBridge';
import { BUILDING_DEFS } from '../data/building-layout';
import { addCrispText } from '../text';
import { getActiveTheme } from '../themes/registry';
import { groupMissingByCategory } from '../data/asset-diagnostics';



export class BootScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private hasTransitioned = false;
  private onConnected: (() => void) | null = null;
  private missingAssets: string[] = [];

  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Diagnostic logging for issue #13 — preload stuck at ~30%. These three
    // listeners pin down which file ID was the last to land and at what
    // progress fraction. Empirically reducing `maxParallelDownloads` makes
    // things WORSE (drops to 0% stuck), so this PR ships diagnostics only
    // and the real fix is tracked as the next strand.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[BOOT] FILE_LOAD_ERROR src=${file.src} key=${file.key} type=${file.type}`);
      this.missingAssets.push(file.src);
    });
    this.load.on(Phaser.Loader.Events.COMPLETE, () => {
      console.log(
        `[BOOT] preload COMPLETE totalToLoad=${this.load.totalToLoad} totalComplete=${this.load.totalComplete} totalFailed=${this.load.totalFailed}`,
      );
    });
    // FILE_COMPLETE fires when an individual asset finishes. Logging both
    // key AND src lets the reader pair a 30%-stuck moment with the exact
    // path that landed last (the stuck file is in flight, not this one).
    this.load.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string, type: string, _data: unknown) => {
      const file = this.load.list
        ? Array.from(this.load.list.values()).find((f: Phaser.Loader.File) => f.key === key)
        : undefined;
      const src = file?.src ?? '?';
      console.log(`[BOOT] filecomplete type=${type} key=${key} src=${src}`);
    });
    // Log on either a pct bucket change OR a totalComplete tick. The bucket
    // alone hides progress within a 10% range; tracking totalComplete makes
    // a partial-load stall (e.g. queue=60, complete frozen at 18) obvious.
    let lastReportedPct = -1;
    let lastReportedComplete = -1;
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => {
      const pct = Math.floor(p * 10) * 10;
      const totalComplete = this.load.totalComplete;
      if (pct !== lastReportedPct || totalComplete !== lastReportedComplete) {
        lastReportedPct = pct;
        lastReportedComplete = totalComplete;
        console.log(
          `[BOOT] preload progress ${pct}% (totalToLoad=${this.load.totalToLoad}, totalComplete=${totalComplete}, totalFailed=${this.load.totalFailed})`,
        );
      }
    });

    // Logo shown on the loading screen + reused by the React TopBar
    this.load.image('logo', 'assets/logo.png');

    // Functional building images — path comes from the active theme.
    // The CC0 theme remaps each activity id to a specific Knights or
    // Goblins building PNG via getBuildingImage().
    const theme = getActiveTheme();
    for (const def of BUILDING_DEFS) {
      this.load.image(def.imageKey, theme.getBuildingImage(def.id));
    }

    // Hero spritesheets provided by the active theme. Each theme's manifest
    // returns the (key → path, frame size) list needed for its variants.
    // The CC0 pack ships one combined sheet per (color, unit) with
    // multiple animations packed into rows.
    const seen = new Set<string>();
    for (const entry of getActiveTheme().getHeroPreload()) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      this.load.spritesheet(entry.key, entry.path, {
        frameWidth: entry.frameWidth,
        frameHeight: entry.frameHeight,
      });
    }

    // Terrain tileset comes from the active theme; TerrainRenderer keys off
    // the same config to pick the grass frame. Themes without a terrain
    // section get the procedural fallback tile from TerrainRenderer.
    const terrain = getActiveTheme().terrain;
    if (terrain !== undefined) {
      this.load.spritesheet(terrain.tilesetKey, terrain.path, {
        frameWidth: terrain.tileSize,
        frameHeight: terrain.tileSize,
      });
    }

    // Ground decorations, trees, stumps, decorative houses — all delegated
    // to the active theme so swapping themes swaps their PNGs end-to-end.
    // The CC0 pack ships static 64×64 props + a tree atlas that
    // postLoadHook slices into per-frame textures.
    for (const entry of getActiveTheme().getStaticAssetPreload()) {
      if (entry.frameWidth !== undefined && entry.frameHeight !== undefined) {
        this.load.spritesheet(entry.key, entry.path, {
          frameWidth: entry.frameWidth,
          frameHeight: entry.frameHeight,
        });
      } else {
        this.load.image(entry.key, entry.path);
      }
    }
  }

  create(): void {
    // Themes can post-process loaded assets (e.g. slice a combined tree
    // atlas into per-variant textures). Runs once here before any scene
    // that consumes those textures starts.
    getActiveTheme().postLoadHook?.(this);

    this.cameras.main.setBackgroundColor('#1a1a2e');

    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;
    const hasMissing = this.missingAssets.length > 0;

    // Logo is always rendered the same way — the missing-sprites state just
    // changes the status line underneath and adds a single action button.
    const logo = this.add.image(cx, cy - 40, 'logo').setOrigin(0.5);
    const maxW = Math.min(this.scale.width * 0.5, 520);
    const maxH = this.scale.height * 0.55;
    const scale = Math.min(maxW / logo.width, maxH / logo.height);
    logo.setScale(scale);

    const statusY = logo.y + (logo.displayHeight * 0.5) + 30;

    if (hasMissing) {
      const n = this.missingAssets.length;
      const grouped = groupMissingByCategory(this.missingAssets);

      const headline = `Bundled asset pack is missing ${n} file${n === 1 ? '' : 's'}.`;
      this.statusText = addCrispText(this, cx, statusY, headline, {
        fontSize: '16px',
        color: '#f0d89a',
        fontFamily: "'Fira Code', monospace",
        align: 'center',
        wordWrap: { width: Math.min(this.scale.width * 0.8, 640) },
      }).setOrigin(0.5);

      // Per-category breakdown so the user can tell at a glance whether
      // heroes, buildings, terrain, or decorations were affected — each
      // class of asset has a different visual impact once we render.
      const summaryLines = grouped.categories
        .map((c) => `  • ${c.label}: ${c.count}`)
        .join('\n');
      const summary = addCrispText(this, cx, statusY + 28, summaryLines, {
        fontSize: '13px',
        color: '#e8c880',
        fontFamily: "'Fira Code', monospace",
        align: 'left',
      }).setOrigin(0.5, 0);

      // Show a small sample of the actual paths so the user has something
      // concrete to paste into `git status` / `ls`. Cap the list to keep
      // the boot screen readable even when a whole directory is missing.
      const MAX_SAMPLES = 6;
      const samples = grouped.samples.slice(0, MAX_SAMPLES);
      const overflow = n - samples.length;
      const sampleLines =
        samples.map((p) => `  ${p}`).join('\n') +
        (overflow > 0 ? `\n  …and ${overflow} more` : '');
      const sample = addCrispText(this, cx, summary.y + summary.displayHeight + 16, sampleLines, {
        fontSize: '11px',
        color: '#8ea0b4',
        fontFamily: "'Fira Code', monospace",
        align: 'left',
        wordWrap: { width: Math.min(this.scale.width * 0.9, 780) },
      }).setOrigin(0.5, 0);

      const hintText =
        'Restore with:\n   git checkout -- client/public/assets/themes/tiny-swords-cc0/\n' +
        'or re-clone the repository.';
      const hint = addCrispText(this, cx, sample.y + sample.displayHeight + 20, hintText, {
        fontSize: '12px',
        color: '#aabbcc',
        fontFamily: "'Fira Code', monospace",
        align: 'center',
        wordWrap: { width: Math.min(this.scale.width * 0.9, 720) },
      }).setOrigin(0.5, 0);

      const primary = addCrispText(this, cx, hint.y + hint.displayHeight + 24, '↻  Reload page', {
          fontSize: '16px',
          color: '#1a1a2e',
          fontFamily: "'Fira Code', monospace",
          backgroundColor: '#c4a35a',
          padding: { x: 18, y: 10 },
        })
        .setOrigin(0.5, 0)
        .setInteractive({ useHandCursor: true });
      primary.on('pointerdown', () => window.location.reload());
      primary.on('pointerover', () => primary.setStyle({ backgroundColor: '#e2c77a' }));
      primary.on('pointerout', () => primary.setStyle({ backgroundColor: '#c4a35a' }));
      return;
    }

    this.statusText = addCrispText(this, cx, statusY, 'Connecting to server...', {
      fontSize: '18px',
      color: '#888888',
      fontFamily: "'Fira Code', monospace",
    }).setOrigin(0.5);

    this.onConnected = () => {
      if (this.hasTransitioned) return;
      this.hasTransitioned = true;
      try {
        this.statusText.setText('Connected! Entering village...');
        this.time.delayedCall(800, () => {
          this.scene.start('VillageScene');
        });
      } catch {
        // scene was destroyed before the transition could run
      }
    };
    eventBridge.on('ws:connected', this.onConnected);

    const cleanup = () => {
      if (this.onConnected !== null) {
        eventBridge.off('ws:connected', this.onConnected);
        this.onConnected = null;
      }
    };
    this.events.on('shutdown', cleanup);
    this.events.on('destroy', cleanup);
  }
}
