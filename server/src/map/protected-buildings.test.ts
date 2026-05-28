import { describe, test, expect } from 'bun:test';
import { DEFAULT_PROTECTED_BUILDINGS } from './protected-buildings';

/**
 * Smoke-test that the server's DEFAULT_PROTECTED_BUILDINGS stays in sync with
 * the client's BUILDING_DEFS (client/src/game/data/building-layout.ts).
 *
 * We cannot import the client module here (different TS project), so we pin
 * the expected values explicitly. When BUILDING_DEFS coordinates change, this
 * test fails immediately — alerting developers to update protected-buildings.ts.
 */
describe('DEFAULT_PROTECTED_BUILDINGS', () => {
  const byId = Object.fromEntries(DEFAULT_PROTECTED_BUILDINGS.map((b) => [b.id, b]));

  test('contains all 8 interactive buildings', () => {
    const ids = ['library', 'castle', 'forge', 'arena', 'alchemist', 'chapel', 'watchtower', 'tavern'];
    for (const id of ids) {
      expect(byId[id], `missing building: ${id}`).toBeDefined();
    }
    expect(DEFAULT_PROTECTED_BUILDINGS).toHaveLength(8);
  });

  test('coordinates match client BUILDING_DEFS defaults', () => {
    // Pin to the values in client/src/game/data/building-layout.ts.
    // Update both files together when repositioning buildings.
    const expected: Record<string, { x: number; y: number }> = {
      library:    { x: 1150, y: 900 },
      castle:     { x: 1300, y: 700 },
      forge:      { x: 1380, y: 880 },
      arena:      { x: 1560, y: 880 },
      alchemist:  { x: 1470, y: 700 },
      chapel:     { x: 1720, y: 560 },
      watchtower: { x: 1600, y: 450 },
      tavern:     { x: 1250, y: 780 },
    };

    for (const [id, coords] of Object.entries(expected)) {
      const building = byId[id];
      expect(building, `missing: ${id}`).toBeDefined();
      expect(building!.x, `${id}.x`).toBe(coords.x);
      expect(building!.y, `${id}.y`).toBe(coords.y);
    }
  });

  test('each building has matching activity field', () => {
    const expectedActivities: Record<string, string> = {
      library:    'reading',
      castle:     'thinking',
      forge:      'editing',
      arena:      'bash',
      alchemist:  'debugging',
      chapel:     'git',
      watchtower: 'reviewing',
      tavern:     'idle',
    };

    for (const [id, activity] of Object.entries(expectedActivities)) {
      expect(byId[id]?.activity, `${id}.activity`).toBe(activity);
    }
  });
});
