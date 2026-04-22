import type { Hono } from 'hono';
import type { MapConfig, NpcPlacement } from './types';
import { MAP_SCHEMA_VERSION } from './types';
import { MapStorage } from './storage';
import { validateMap, isValidUnitType } from './validator';
import { buildAssetManifest } from './asset-manifest';
import { DEFAULT_WORLD, defaultBuildingPositions } from './protected-buildings';

/**
 * Drop NPCs whose `unit` is not in the active VALID_UNIT_TYPES set,
 * so stored maps stay loadable across changes to the supported unit
 * list. Transforms the in-memory map on load; the on-disk JSON is
 * rewritten only on the next save.
 */
function migrateMap(map: MapConfig, source: string): MapConfig {
  const before = map.npcs?.length ?? 0;
  if (before === 0) return map;
  const valid: NpcPlacement[] = (map.npcs ?? []).filter((n) => isValidUnitType(n.unit));
  const dropped = before - valid.length;
  if (dropped > 0) {
    console.warn(`[map] ${source}: dropped ${dropped} NPC(s) with removed unit types`);
  }
  return { ...map, npcs: valid };
}

function buildDefaultMap(): MapConfig {
  const now = Date.now();
  return {
    version: MAP_SCHEMA_VERSION,
    world: { width: DEFAULT_WORLD.width, height: DEFAULT_WORLD.height },
    baseTileset: 'terrain-color1',
    terrain: {},
    decorations: [],
    paths: [],
    buildings: defaultBuildingPositions(),
    npcs: [],
    settings: { heroScale: 0.50 },
    meta: {
      createdAt: now,
      updatedAt: now,
      name: 'Untitled Map',
    },
  };
}

export function registerMapRoutes(app: Hono, storage: MapStorage): void {
  // -------------------------------------------------------------------------
  // Active map (convenience — loads the map from the active slot)
  // -------------------------------------------------------------------------
  app.get('/api/map', async (c) => {
    const activeSlot = await storage.getActiveSlot();
    const raw = await storage.loadActive();
    console.log('[GET /api/map]', {
      activeSlot,
      found: raw !== null,
      terrainTiles: raw ? Object.keys(raw.terrain ?? {}).length : 0,
      buildings: raw?.buildings?.length ?? 0,
      mapName: raw?.meta?.name,
    });
    if (raw === null) return c.body(null, 204);
    return c.json(migrateMap(raw, `active (slot-${activeSlot})`));
  });

  // -------------------------------------------------------------------------
  // Procedural default map
  // -------------------------------------------------------------------------
  app.get('/api/map/default', (c) => {
    return c.json(migrateMap(buildDefaultMap(), 'default'));
  });

  // -------------------------------------------------------------------------
  // Slot listing
  // -------------------------------------------------------------------------
  app.get('/api/map/slots', async (c) => {
    const slots = await storage.listSlots();
    return c.json(slots);
  });

  // -------------------------------------------------------------------------
  // Active slot management
  // -------------------------------------------------------------------------
  app.get('/api/map/active', async (c) => {
    const slot = await storage.getActiveSlot();
    return c.json({ slot });
  });

  app.post('/api/map/active', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }
    if (typeof body !== 'object' || body === null || !('slot' in body)) {
      return c.json({ ok: false, error: 'Body must contain "slot" field' }, 400);
    }
    const slot = (body as Record<string, unknown>).slot;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 5) {
      return c.json({ ok: false, error: 'slot must be an integer 1-5' }, 400);
    }
    try {
      await storage.setActiveSlot(slot);
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 400);
    }
    return c.json({ ok: true, slot });
  });

  // -------------------------------------------------------------------------
  // Template management
  // -------------------------------------------------------------------------
  app.get('/api/map/template', async (c) => {
    const template = await storage.loadTemplate();
    if (template === null) return c.body(null, 204);
    return c.json(migrateMap(template, 'template'));
  });

  // -------------------------------------------------------------------------
  // Asset manifest
  // -------------------------------------------------------------------------
  app.get('/api/assets/manifest', (c) => {
    const theme = c.req.query('theme') ?? 'tiny-swords-cc0';
    return c.json(buildAssetManifest(theme));
  });

  // -------------------------------------------------------------------------
  // Parameterized slot routes — MUST be registered AFTER specific routes
  // so that /api/map/slots, /api/map/active, etc. don't match as :slot
  // -------------------------------------------------------------------------
  app.get('/api/map/:slot', async (c) => {
    const slotNum = parseInt(c.req.param('slot'), 10);
    if (isNaN(slotNum) || slotNum < 1 || slotNum > 5) {
      return c.json({ ok: false, error: 'slot must be 1-5' }, 400);
    }
    const map = await storage.loadSlot(slotNum);
    if (map === null) return c.body(null, 204);
    return c.json(migrateMap(map, `slot-${slotNum}`));
  });

  app.post('/api/map/:slot', async (c) => {
    const slotNum = parseInt(c.req.param('slot'), 10);
    if (isNaN(slotNum) || slotNum < 1 || slotNum > 5) {
      return c.json({ ok: false, error: 'slot must be 1-5' }, 400);
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
    }

    const result = validateMap(raw);
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, 400);
    }

    await storage.saveSlot(slotNum, result.map);
    return c.json({ ok: true, updatedAt: Date.now() });
  });

  app.post('/api/map/:slot/reset', async (c) => {
    const slotNum = parseInt(c.req.param('slot'), 10);
    if (isNaN(slotNum) || slotNum < 1 || slotNum > 5) {
      return c.json({ ok: false, error: 'slot must be 1-5' }, 400);
    }

    try {
      await storage.resetSlot(slotNum);
    } catch (err) {
      return c.json({ ok: false, error: String(err) }, 400);
    }
    return c.json({ ok: true });
  });
}
