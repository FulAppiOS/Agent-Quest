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

export const DEFAULT_PROTECTED_BUILDINGS: ProtectedBuildingDefault[] = [
  { id: 'library',    label: 'Library',    activity: 'reading',   x: 1060, y: 600,  defaultScale: 0.52 },
  { id: 'alchemist',  label: 'Alchemist',  activity: 'debugging', x: 1210, y: 460,  defaultScale: 0.50 },
  { id: 'castle',     label: 'Castle',     activity: 'thinking',  x: 1430, y: 430,  defaultScale: 0.46 },
  { id: 'watchtower', label: 'Watchtower', activity: 'reviewing', x: 1650, y: 470,  defaultScale: 0.42 },
  { id: 'chapel',     label: 'Chapel',     activity: 'git',       x: 1790, y: 610,  defaultScale: 0.38 },
  { id: 'tavern',     label: 'Tavern',     activity: 'idle',      x: 1510, y: 810,  defaultScale: 0.50 },
  { id: 'forge',      label: 'Forge',      activity: 'editing',   x: 1150, y: 970,  defaultScale: 0.42 },
  { id: 'arena',      label: 'Arena',      activity: 'bash',      x: 1700, y: 970,  defaultScale: 0.42 },
];

export const PROTECTED_BUILDING_IDS: readonly string[] = DEFAULT_PROTECTED_BUILDINGS.map((b) => b.id);

export const DEFAULT_WORLD = { width: 2800, height: 1800 } as const;

export function defaultBuildingPositions(): BuildingPosition[] {
  return DEFAULT_PROTECTED_BUILDINGS.map(({ id, x, y }) => ({ id, x, y }));
}
