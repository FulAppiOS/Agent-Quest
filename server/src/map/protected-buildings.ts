import type { BuildingPosition } from './types';

/**
 * The 8 interactive "protected" buildings — the editor can reposition them,
 * but it cannot add or remove entries. Mirrors the defaults from
 * client/src/game/data/building-layout.ts (BUILDING_DEFS).
 */
export interface ProtectedBuildingDefault {
  id: string;
  label: string;
  activity: string;
  x: number;
  y: number;
  defaultScale: number;
}

// Coordinates mirror BUILDING_DEFS in client/src/game/data/building-layout.ts.
// Keep both in sync whenever buildings are repositioned.
export const DEFAULT_PROTECTED_BUILDINGS: ProtectedBuildingDefault[] = [
  { id: 'library',    label: 'Library',    activity: 'reading',   x: 1150, y: 900,  defaultScale: 0.52 },
  { id: 'castle',     label: 'Castle',     activity: 'thinking',  x: 1300, y: 700,  defaultScale: 0.46 },
  { id: 'forge',      label: 'Forge',      activity: 'editing',   x: 1380, y: 880,  defaultScale: 0.42 },
  { id: 'arena',      label: 'Arena',      activity: 'bash',      x: 1560, y: 880,  defaultScale: 0.42 },
  { id: 'alchemist',  label: 'Alchemist',  activity: 'debugging', x: 1470, y: 700,  defaultScale: 0.50 },
  { id: 'chapel',     label: 'Chapel',     activity: 'git',       x: 1720, y: 560,  defaultScale: 0.38 },
  { id: 'watchtower', label: 'Watchtower', activity: 'reviewing', x: 1600, y: 450,  defaultScale: 0.42 },
  { id: 'tavern',     label: 'Tavern',     activity: 'idle',      x: 1250, y: 780,  defaultScale: 0.50 },
];

export const PROTECTED_BUILDING_IDS: readonly string[] = DEFAULT_PROTECTED_BUILDINGS.map((b) => b.id);

export const DEFAULT_WORLD = { width: 2800, height: 1800 } as const;

export function defaultBuildingPositions(): BuildingPosition[] {
  return DEFAULT_PROTECTED_BUILDINGS.map(({ id, x, y }) => ({ id, x, y }));
}
