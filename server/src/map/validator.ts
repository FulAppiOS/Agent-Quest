import type { MapConfig, BuildingPosition, DecorationInstance, PathSegment, TerrainCell, NpcPlacement, MapSettings, SpawnPoint } from './types';
import { MAP_SCHEMA_VERSION } from './types';
import { PROTECTED_BUILDING_IDS } from './protected-buildings';

type ValidationResult =
  | { ok: true; map: MapConfig }
  | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateWorld(raw: unknown): { ok: true; world: { width: number; height: number } } | { ok: false; error: string } {
  if (!isObject(raw)) return { ok: false, error: 'world must be an object with width/height' };
  const { width, height } = raw;
  if (!isFiniteNumber(width) || width <= 0) return { ok: false, error: 'world.width must be a positive number' };
  if (!isFiniteNumber(height) || height <= 0) return { ok: false, error: 'world.height must be a positive number' };
  return { ok: true, world: { width, height } };
}

function validateBuildings(raw: unknown, world: { width: number; height: number }): { ok: true; buildings: BuildingPosition[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'buildings must be an array' };

  const seen = new Set<string>();
  const buildings: BuildingPosition[] = [];

  for (const entry of raw) {
    if (!isObject(entry)) return { ok: false, error: 'building entry must be an object' };
    const { id, x, y } = entry;
    if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'building.id must be a non-empty string' };
    if (!PROTECTED_BUILDING_IDS.includes(id)) return { ok: false, error: `Unknown building id: ${id}` };
    if (seen.has(id)) return { ok: false, error: `Duplicate building id: ${id}` };
    if (!isFiniteNumber(x) || x < 0 || x > world.width) return { ok: false, error: `building ${id}: x out of bounds (0..${world.width})` };
    if (!isFiniteNumber(y) || y < 0 || y > world.height) return { ok: false, error: `building ${id}: y out of bounds (0..${world.height})` };
    seen.add(id);
    buildings.push({ id, x, y });
  }

  for (const required of PROTECTED_BUILDING_IDS) {
    if (!seen.has(required)) return { ok: false, error: `Missing protected building: ${required}` };
  }

  if (buildings.length !== PROTECTED_BUILDING_IDS.length) {
    return { ok: false, error: `Expected exactly ${PROTECTED_BUILDING_IDS.length} buildings, got ${buildings.length}` };
  }

  return { ok: true, buildings };
}

function validateTerrain(raw: unknown): { ok: true; terrain: Record<string, TerrainCell> } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, terrain: {} };
  if (!isObject(raw)) return { ok: false, error: 'terrain must be an object keyed by "col,row"' };

  const terrain: Record<string, TerrainCell> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^-?\d+,-?\d+$/.test(key)) return { ok: false, error: `terrain key ${key} must match "col,row"` };
    if (!isObject(value)) return { ok: false, error: `terrain[${key}] must be an object` };
    const tile = value.tile;
    if (!isObject(tile)) return { ok: false, error: `terrain[${key}].tile must be an object` };
    const set = tile.set;
    const frame = tile.frame;
    if (typeof set !== 'string' || set.length === 0) return { ok: false, error: `terrain[${key}].tile.set must be a non-empty string` };
    if (!isFiniteNumber(frame) || frame < 0 || !Number.isInteger(frame)) return { ok: false, error: `terrain[${key}].tile.frame must be a non-negative integer` };
    if (typeof value.walkable !== 'boolean') return { ok: false, error: `terrain[${key}].walkable must be a boolean` };
    terrain[key] = { tile: { set, frame }, walkable: value.walkable };
  }
  return { ok: true, terrain };
}

function validateDecorations(raw: unknown, world: { width: number; height: number }): { ok: true; decorations: DecorationInstance[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, decorations: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'decorations must be an array' };

  const seenIds = new Set<string>();
  const decorations: DecorationInstance[] = [];

  for (const entry of raw) {
    if (!isObject(entry)) return { ok: false, error: 'decoration entry must be an object' };
    const { id, textureKey, x, y, scale, frame, depth, tint, animated, animation } = entry;
    if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'decoration.id must be a non-empty string' };
    if (seenIds.has(id)) return { ok: false, error: `Duplicate decoration id: ${id}` };
    if (typeof textureKey !== 'string' || textureKey.length === 0) return { ok: false, error: `decoration ${id}: textureKey must be a non-empty string` };
    if (!isFiniteNumber(x) || x < 0 || x > world.width) return { ok: false, error: `decoration ${id}: x out of bounds (0..${world.width})` };
    if (!isFiniteNumber(y) || y < 0 || y > world.height) return { ok: false, error: `decoration ${id}: y out of bounds (0..${world.height})` };
    if (!isFiniteNumber(scale) || scale <= 0) return { ok: false, error: `decoration ${id}: scale must be a positive number` };

    const instance: DecorationInstance = { id, textureKey, x, y, scale };
    if (frame !== undefined) {
      if (!isFiniteNumber(frame) || frame < 0 || !Number.isInteger(frame)) return { ok: false, error: `decoration ${id}: frame must be a non-negative integer` };
      instance.frame = frame;
    }
    if (depth !== undefined) {
      if (!isFiniteNumber(depth)) return { ok: false, error: `decoration ${id}: depth must be a number` };
      instance.depth = depth;
    }
    if (tint !== undefined) {
      if (!isFiniteNumber(tint) || !Number.isInteger(tint)) return { ok: false, error: `decoration ${id}: tint must be an integer (hex colour)` };
      instance.tint = tint;
    }
    if (animated !== undefined) {
      if (typeof animated !== 'boolean') return { ok: false, error: `decoration ${id}: animated must be a boolean` };
      instance.animated = animated;
    }
    if (animation !== undefined) {
      if (typeof animation !== 'string' || animation.length === 0) return { ok: false, error: `decoration ${id}: animation must be a non-empty string` };
      instance.animation = animation;
    }

    seenIds.add(id);
    decorations.push(instance);
  }

  return { ok: true, decorations };
}

function validatePaths(raw: unknown, world: { width: number; height: number }): { ok: true; paths: PathSegment[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, paths: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'paths must be an array' };

  const allowedStyles: PathSegment['style'][] = ['main', 'secondary', 'trail', 'plaza'];
  const seenIds = new Set<string>();
  const paths: PathSegment[] = [];

  for (const entry of raw) {
    if (!isObject(entry)) return { ok: false, error: 'path entry must be an object' };
    const { id, points, width, style } = entry;
    if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'path.id must be a non-empty string' };
    if (seenIds.has(id)) return { ok: false, error: `Duplicate path id: ${id}` };
    if (!Array.isArray(points) || points.length < 2) return { ok: false, error: `path ${id}: points must be an array of at least 2 entries` };
    const pts: Array<{ x: number; y: number }> = [];
    for (const p of points) {
      if (!isObject(p)) return { ok: false, error: `path ${id}: point must be an object` };
      if (!isFiniteNumber(p.x) || p.x < 0 || p.x > world.width) return { ok: false, error: `path ${id}: point.x out of bounds (0..${world.width})` };
      if (!isFiniteNumber(p.y) || p.y < 0 || p.y > world.height) return { ok: false, error: `path ${id}: point.y out of bounds (0..${world.height})` };
      pts.push({ x: p.x, y: p.y });
    }
    if (!isFiniteNumber(width) || width <= 0) return { ok: false, error: `path ${id}: width must be a positive number` };
    if (typeof style !== 'string' || !allowedStyles.includes(style as PathSegment['style'])) {
      return { ok: false, error: `path ${id}: style must be one of ${allowedStyles.join(', ')}` };
    }
    seenIds.add(id);
    paths.push({ id, points: pts, width, style: style as PathSegment['style'] });
  }

  return { ok: true, paths };
}

function validateMeta(raw: unknown): { ok: true; meta: MapConfig['meta'] } | { ok: false; error: string } {
  if (!isObject(raw)) return { ok: false, error: 'meta must be an object' };
  const { createdAt, updatedAt, name } = raw;
  if (!isFiniteNumber(createdAt)) return { ok: false, error: 'meta.createdAt must be a number' };
  if (!isFiniteNumber(updatedAt)) return { ok: false, error: 'meta.updatedAt must be a number' };
  if (typeof name !== 'string') return { ok: false, error: 'meta.name must be a string' };
  return { ok: true, meta: { createdAt, updatedAt, name } };
}

export const VALID_UNIT_TYPES = ['warrior', 'archer', 'pawn', 'tnt', 'torch'] as const;
const VALID_UNIT_COLORS = ['blue', 'red', 'black', 'yellow', 'purple'] as const;

/** O(1) membership test for use by lazy-migration filters. */
export const VALID_UNIT_TYPES_SET: ReadonlySet<string> = new Set<string>(VALID_UNIT_TYPES);

export function isValidUnitType(x: unknown): boolean {
  return typeof x === 'string' && VALID_UNIT_TYPES_SET.has(x);
}

function validateNpcs(raw: unknown, world: { width: number; height: number }): { ok: true; npcs: NpcPlacement[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, npcs: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'npcs must be an array' };

  const seenIds = new Set<string>();
  const npcs: NpcPlacement[] = [];

  for (const entry of raw) {
    if (!isObject(entry)) return { ok: false, error: 'npc entry must be an object' };
    const { id, unit, color, x, y, scale, wanderRadius } = entry;

    if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'npc.id must be a non-empty string' };
    if (seenIds.has(id)) return { ok: false, error: `Duplicate npc id: ${id}` };

    if (typeof unit !== 'string' || !(VALID_UNIT_TYPES as readonly string[]).includes(unit)) {
      return { ok: false, error: `npc ${id}: unit must be one of ${VALID_UNIT_TYPES.join(', ')}` };
    }
    if (typeof color !== 'string' || !(VALID_UNIT_COLORS as readonly string[]).includes(color)) {
      return { ok: false, error: `npc ${id}: color must be one of ${VALID_UNIT_COLORS.join(', ')}` };
    }

    if (!isFiniteNumber(x) || x < 0 || x > world.width) return { ok: false, error: `npc ${id}: x out of bounds (0..${world.width})` };
    if (!isFiniteNumber(y) || y < 0 || y > world.height) return { ok: false, error: `npc ${id}: y out of bounds (0..${world.height})` };
    if (!isFiniteNumber(scale) || scale <= 0) return { ok: false, error: `npc ${id}: scale must be a positive number` };
    if (!isFiniteNumber(wanderRadius) || wanderRadius <= 0 || wanderRadius > 500) {
      return { ok: false, error: `npc ${id}: wanderRadius must be a positive number <= 500` };
    }

    seenIds.add(id);
    npcs.push({
      id,
      unit: unit as NpcPlacement['unit'],
      color: color as NpcPlacement['color'],
      x,
      y,
      scale,
      wanderRadius,
    });
  }

  return { ok: true, npcs };
}

function validateSpawn(raw: unknown, world: { width: number; height: number }): { ok: true; spawn: SpawnPoint | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, spawn: undefined };
  if (!isObject(raw)) return { ok: false, error: 'spawn must be an object with x/y' };
  const { x, y } = raw;
  if (!isFiniteNumber(x) || x < 0 || x > world.width) return { ok: false, error: `spawn.x out of bounds (0..${world.width})` };
  if (!isFiniteNumber(y) || y < 0 || y > world.height) return { ok: false, error: `spawn.y out of bounds (0..${world.height})` };
  return { ok: true, spawn: { x, y } };
}

function validateSettings(raw: unknown): { ok: true; settings: MapSettings } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, settings: { heroScale: 0.50 } };
  if (!isObject(raw)) return { ok: false, error: 'settings must be an object' };

  const { heroScale } = raw;
  if (heroScale === undefined || heroScale === null) {
    return { ok: true, settings: { heroScale: 0.50 } };
  }
  if (!isFiniteNumber(heroScale) || heroScale < 0.1 || heroScale > 1.0) {
    return { ok: false, error: 'settings.heroScale must be a number between 0.1 and 1.0' };
  }

  return { ok: true, settings: { heroScale } };
}

export function validateMap(raw: unknown): ValidationResult {
  if (!isObject(raw)) return { ok: false, error: 'map must be an object' };

  if (raw.version !== MAP_SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported schema version: expected ${MAP_SCHEMA_VERSION}, got ${String(raw.version)}` };
  }

  const world = validateWorld(raw.world);
  if (!world.ok) return world;

  if (typeof raw.baseTileset !== 'string' || raw.baseTileset.length === 0) {
    return { ok: false, error: 'baseTileset must be a non-empty string' };
  }

  const terrain = validateTerrain(raw.terrain);
  if (!terrain.ok) return terrain;

  const decorations = validateDecorations(raw.decorations, world.world);
  if (!decorations.ok) return decorations;

  const paths = validatePaths(raw.paths, world.world);
  if (!paths.ok) return paths;

  const buildings = validateBuildings(raw.buildings, world.world);
  if (!buildings.ok) return buildings;

  const npcs = validateNpcs(raw.npcs, world.world);
  if (!npcs.ok) return npcs;

  const spawn = validateSpawn(raw.spawn, world.world);
  if (!spawn.ok) return spawn;

  const settings = validateSettings(raw.settings);
  if (!settings.ok) return settings;

  const meta = validateMeta(raw.meta);
  if (!meta.ok) return meta;

  const map: MapConfig = {
    version: MAP_SCHEMA_VERSION,
    world: world.world,
    baseTileset: raw.baseTileset,
    terrain: terrain.terrain,
    decorations: decorations.decorations,
    paths: paths.paths,
    buildings: buildings.buildings,
    npcs: npcs.npcs,
    settings: settings.settings,
    meta: meta.meta,
  };
  if (spawn.spawn !== undefined) map.spawn = spawn.spawn;

  return { ok: true, map };
}
