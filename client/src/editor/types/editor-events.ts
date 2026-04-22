import type { AssetManifest, TileRef, UnitType, UnitColor } from './map';

export type ToolName =
  | 'select'
  | 'paint'
  | 'erase'
  | 'decoration'
  | 'path'
  | 'move-building'
  | 'npc'
  | 'spawn';

export type Layer = 'terrain' | 'decorations' | 'paths' | 'buildings';

export type PathStyle = 'main' | 'secondary' | 'trail' | 'plaza';

export type EraseScope = 'terrain' | 'decorations' | 'paths' | 'all';

export type EditorAction =
  | 'save'
  | 'load-current'
  | 'load-default'
  | 'clear-terrain'
  | 'clear-decorations'
  | 'clear-paths'
  | 'clear-npcs'
  | 'reset-buildings'
  | 'reset-all'
  | 'fill-terrain'
  | 'set-active';

export interface PaintTilePayload {
  tile: TileRef | null;
  walkable: boolean;
}

export interface DecorationBrushPayload {
  key: string;
  frame?: number;
  scale: number;
  /** When true, placed instance gets `animated: true`. Default false. */
  animated?: boolean;
  /** Animation name from the manifest's AnimSpec. Defaults to "idle". */
  animation?: string;
}

export interface PathBrushPayload {
  style: PathStyle;
  width: number;
}

export interface NpcBrushPayload {
  unit: UnitType;
  color: UnitColor;
  scale: number;
  wanderRadius: number;
}

export interface LayerTogglePayload {
  layer: Layer;
  visible: boolean;
}

export interface EditorStats {
  terrainCells: number;
  decorations: number;
  paths: number;
  buildings: number;
  npcs: number;
}

export type Selection =
  | { kind: 'decoration'; id: string; textureKey: string; x: number; y: number; scale: number }
  | { kind: 'path'; id: string; pointCount: number; width: number; style: PathStyle }
  | { kind: 'building'; id: string; label: string; x: number; y: number }
  | { kind: 'npc'; id: string; unit: UnitType; color: UnitColor; x: number; y: number; scale: number; wanderRadius: number }
  | { kind: 'spawn'; x: number; y: number; isSet: boolean };

export interface EditorReadyPayload {
  manifest: AssetManifest;
}
