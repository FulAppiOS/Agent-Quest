export type ThemeId = 'tiny-swords-cc0';

export type UnitType = 'warrior' | 'archer' | 'pawn' | 'tnt' | 'torch';
export type UnitColor = 'blue' | 'yellow' | 'red' | 'black' | 'purple';

export interface PreloadEntry {
  key: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
}

/** Any asset BootScene needs to preload beyond heroes/buildings/terrain —
 * bushes, rocks, trees, stumps, decorative houses. When frameWidth is
 * undefined the file is loaded as a plain image; when set it's loaded as
 * a spritesheet. */
export interface StaticAssetEntry {
  key: string;
  path: string;
  frameWidth?: number;
  frameHeight?: number;
}

export interface HeroSpriteConfig {
  idleKey: string;
  runKey: string;
  /** Number of frames that the idle animation loops over. */
  idleFrames: number;
  /** Number of frames that the run animation loops over. */
  runFrames: number;
  /**
   * Explicit frame indices for the idle animation. When set, overrides the
   * contiguous 0..idleFrames-1 range. Used by sheets where frames of the
   * same animation are not contiguous (e.g. combined sheets where rows are
   * animations and columns are frames — we need to offset by sheetCols).
   */
  idleFrameIndices?: number[];
  /** Explicit frame indices for the run animation — see idleFrameIndices. */
  runFrameIndices?: number[];
  /** Set true for sprites that natively face left (we flipX by default). */
  facesLeft: boolean;
  /** Phaser tint (0xRRGGBB) applied via setTint on the sprite, or null. */
  tint: number | null;
}

/** Static preview of a hero's idle sheet — used by React UI (PartyBar). */
export interface HeroPreview {
  /** URL relative to the public root (leading slash). */
  url: string;
  /** Number of frames in one row of the idle sheet (for CSS background-size). */
  sheetColumns: number;
  /** Number of rows in the combined sheet (for CSS background-size). */
  sheetRows: number;
  /** Native frame dimensions in the sheet. */
  frameWidth: number;
  frameHeight: number;
}

/** Background tileset used by TerrainRenderer for the main village ground.
 * TerrainRenderer is mostly procedural (roads/forest/lake/noise) but the
 * base grass fill is drawn as a tiled sprite from one frame of a tileset. */
export interface TerrainConfig {
  /** Phaser texture key under which the tileset is registered. */
  tilesetKey: string;
  /** Path relative to the public root (no leading slash). */
  path: string;
  /** Square tile size in px. */
  tileSize: number;
  /** Frame index (row-major) of the "main grass" tile used as ground fill. */
  grassFrame: number;
}

export interface ThemeManifest {
  id: ThemeId;
  name: string;
  /** Base scale applied to hero sprites. MapConfig-saved values are
   * rebased against the Tiny Swords baseline (0.5) — see
   * rebaseSavedScale() in registry.ts. */
  heroScale: number;
  getHeroPreload(): PreloadEntry[];
  getHeroConfig(color: UnitColor, unit: UnitType): HeroSpriteConfig;
  getHeroPreview(color: UnitColor, unit: UnitType): HeroPreview;
  /** Background tileset for TerrainRenderer. When absent, the renderer
   * falls back to its built-in procedural grass tile. */
  terrain?: TerrainConfig;
  /** PNG path for a functional building (id from BUILDING_DEFS).
   * All themes are required to provide imagery for every building id. */
  getBuildingImage(id: string): string;
  /** Optional per-building scale override. When absent, the default
   * from BUILDING_DEFS is used. Needed when the theme's native building
   * sizes differ from the default pack. */
  getBuildingScale?(id: string): number | undefined;
  /** Decorations, decorative houses, trees, stumps — every static/sprite
   * asset BootScene used to hardcode. */
  getStaticAssetPreload(): StaticAssetEntry[];
  /** Optional post-load hook, called from BootScene.create() after the
   * Phaser loader has finished. Useful for canvas-based slicing: e.g.
   * turn one combined tree atlas into 4 separate `tree-1..4` textures. */
  postLoadHook?(scene: import('phaser').Scene): void;
}
