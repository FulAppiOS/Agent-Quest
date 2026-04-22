/**
 * Map Editor data model — server/client share the same shape.
 * If you change this file, mirror the change in client/src/editor/types/map.ts.
 */

export const MAP_SCHEMA_VERSION = 1;

export const TILE_SIZE = 64;

// ---------------------------------------------------------------------------
// NPC placement types
// ---------------------------------------------------------------------------

export type UnitType = 'warrior' | 'archer' | 'pawn' | 'tnt' | 'torch';
export type UnitColor = 'blue' | 'red' | 'black' | 'yellow' | 'purple';

export interface NpcPlacement {
  id: string;
  unit: UnitType;
  color: UnitColor;
  x: number;
  y: number;
  scale: number;
  wanderRadius: number;
}

export interface MapSettings {
  heroScale: number;
  /** Asset theme the map was authored against. Optional — absent value
   * falls back to the default theme. */
  theme?: string;
}

/** Reference to a tile inside a loaded tileset spritesheet. */
export interface TileRef {
  /** tileset key, e.g. "terrain-color1" */
  set: string;
  /** frame index inside the spritesheet (0-based row-major) */
  frame: number;
}

/** A single painted terrain cell, keyed by `${col},${row}` in MapConfig.terrain. */
export interface TerrainCell {
  tile: TileRef;
  /** true if characters can walk on this tile (grass, dirt, path) */
  walkable: boolean;
}

/** Free-placed decoration sprite (tree, bush, rock, cloud, prop). */
export interface DecorationInstance {
  id: string;
  /** texture key registered by the scene, e.g. "tree-1" */
  textureKey: string;
  /** optional spritesheet frame (for multi-frame decorations like trees) */
  frame?: number;
  x: number;
  y: number;
  scale: number;
  /** render order. undefined = auto by Y */
  depth?: number;
  /** optional tint (hex, e.g. 0x9CC8C2) */
  tint?: number;
  /** When true, renderer calls sprite.play(`${textureKey}:${animation}`). Optional for back-compat. */
  animated?: boolean;
  /** Animation name (must match one of the manifest's AnimSpec.name). Defaults to "idle". */
  animation?: string;
}

/** Polyline describing a walkable path (road/trail). */
export interface PathSegment {
  id: string;
  points: Array<{ x: number; y: number }>;
  /** render width in pixels */
  width: number;
  /** visual style: main road, secondary path, forest trail, plaza cobble */
  style: 'main' | 'secondary' | 'trail' | 'plaza';
}

/** Protected interactive building — editor can move it but cannot add/remove. */
export interface BuildingPosition {
  id: string;
  x: number;
  y: number;
}

/** World-space spawn point where new heroes appear before walking into the village. */
export interface SpawnPoint {
  x: number;
  y: number;
}

export interface MapConfig {
  version: number;
  world: { width: number; height: number };
  /** base terrain colour variant (which Tilemap_colorN.png fills the ground when no cell paints over it) */
  baseTileset: string;
  /** sparse grid — only cells painted explicitly. Key: `${col},${row}` */
  terrain: Record<string, TerrainCell>;
  decorations: DecorationInstance[];
  paths: PathSegment[];
  buildings: BuildingPosition[];
  /** NPC placements on the map */
  npcs: NpcPlacement[];
  /** Optional hero spawn point. Falls back to VILLAGE_GATE when absent. */
  spawn?: SpawnPoint;
  /** map-level settings */
  settings: MapSettings;
  /** editor metadata */
  meta: {
    createdAt: number;
    updatedAt: number;
    name: string;
  };
}

// ---------------------------------------------------------------------------
// Asset manifest — served by GET /api/assets/manifest
// ---------------------------------------------------------------------------

export interface TilesetManifest {
  key: string;
  label: string;
  path: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
}

/** Animation definition for a decoration spritesheet. frame indices are
 * 0-based into the sheet's frame grid. */
export interface AnimSpec {
  name: string;         // "idle" | "walk" | "attack" | ...
  start: number;
  end: number;
  frameRate?: number;   // default 10 at load time
  repeat?: number;      // default -1 (loop)
}

export interface DecorationManifest {
  key: string;
  label: string;
  path: string;
  category: 'tree' | 'bush' | 'rock' | 'stump' | 'cloud' | 'house' | 'prop' | 'water-rock' | 'water' | 'effect';
  /** UI group label — typically `folderPath.join('/')`. Kept for backward
   * compat with existing palette code that reads `group`. */
  group: string;
  /** Hierarchical path from the theme root, e.g. ["Factions","Knights","Buildings","Castle"].
   * Optional — entries without a folder path render under the tree root as a flat group. */
  folderPath?: string[];
  frameWidth?: number;
  frameHeight?: number;
  /** Derived from sheet dimensions / frame size. Only set for spritesheets. */
  frameCount?: number;
  /** Number of columns in the sheet (sheetWidth / frameWidth). Lets the
   * palette preview render multi-row atlases like Tree (4×3) or Bridge
   * (3×4) without assuming a single-row layout. */
  sheetColumns?: number;
  /** If present, Phaser animations named `${key}:${spec.name}` are registered at load time. */
  animations?: AnimSpec[];
  defaultScale: number;
}

export interface ProtectedBuildingManifest {
  id: string;
  label: string;
  path: string;
  activity: string;
  defaultScale: number;
}

export interface NpcSpriteManifest {
  unit: UnitType;
  color: UnitColor;
  idleKey: string;
  runKey: string;
  idlePath: string;
  runPath: string;
  idleFrames: number;
  runFrames: number;
  frameWidth: number;
  frameHeight: number;
  /** Optional explicit frame indices for the idle animation — used by
   * themes (e.g. Tiny Swords CC0) whose sheets combine multiple
   * animations on different rows. When absent, frames 0..idleFrames-1
   * are assumed contiguous. */
  idleFrameIndices?: number[];
  /** Same for the run animation. */
  runFrameIndices?: number[];
}

export interface AssetManifest {
  tilesets: TilesetManifest[];
  decorations: DecorationManifest[];
  protectedBuildings: ProtectedBuildingManifest[];
  npcSprites: NpcSpriteManifest[];
}
