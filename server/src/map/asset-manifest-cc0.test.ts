import { describe, it, expect } from 'bun:test';
import { buildAssetManifestCc0 } from './asset-manifest-cc0';

describe('buildAssetManifestCc0', () => {
  const manifest = buildAssetManifestCc0();

  it('returns tilesets (Flat + Elevation)', () => {
    expect(manifest.tilesets.length).toBeGreaterThanOrEqual(2);
  });

  it('exposes all 18 Deco/*.png entries', () => {
    const deco = manifest.decorations.filter((d) => d.folderPath?.[0] === 'Deco');
    expect(deco.length).toBe(18);
  });

  it('exposes Knights Archer troops as spritesheets with animations', () => {
    const archers = manifest.decorations.filter(
      (d) => d.folderPath?.slice(0, 4).join('/') === 'Factions/Knights/Troops/Archer'
            && ['Blue', 'Purple', 'Red', 'Yellow'].includes(d.folderPath[4] ?? ''),
    );
    expect(archers.length).toBe(4);
    for (const a of archers) {
      expect(a.frameWidth).toBe(192);
      expect(a.frameHeight).toBe(192);
      expect(a.animations?.some((an) => an.name === 'idle')).toBe(true);
    }
  });

  it('excludes UI', () => {
    const ui = manifest.decorations.filter((d) => d.folderPath?.[0] === 'UI');
    expect(ui.length).toBe(0);
  });

  it('excludes Terrain/Ground (tileset atlases) but keeps Water + Bridge', () => {
    const ground = manifest.decorations.filter(
      (d) => d.folderPath?.[0] === 'Terrain' && d.folderPath[1] === 'Ground',
    );
    expect(ground.length).toBe(0);

    const water = manifest.decorations.filter(
      (d) => d.folderPath?.[0] === 'Terrain' && d.folderPath[1] === 'Water',
    );
    expect(water.length).toBeGreaterThan(0);

    const bridge = manifest.decorations.filter(
      (d) => d.folderPath?.[0] === 'Terrain' && d.folderPath[1] === 'Bridge',
    );
    expect(bridge.length).toBeGreaterThan(0);

    // Foam + Water rocks should carry looping animations, Bridge stays static.
    const foam = manifest.decorations.find((d) => d.key === 'terrain-water-foam-foam');
    expect(foam?.animations?.some((a) => a.name === 'idle')).toBe(true);
    const rock = manifest.decorations.find((d) => d.key === 'terrain-water-rocks-rocks-01');
    expect(rock?.animations?.some((a) => a.name === 'idle')).toBe(true);
  });

  it('every decoration has a non-empty key/label/path and starts with /assets/', () => {
    for (const d of manifest.decorations) {
      expect(d.key.length).toBeGreaterThan(0);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.path.startsWith('/assets/')).toBe(true);
    }
  });

  it('folder-driven (non-legacy) decorations have a folderPath', () => {
    const visible = manifest.decorations.filter((d) => !d.label.endsWith('(legacy)'));
    for (const d of visible) {
      expect((d.folderPath ?? []).length).toBeGreaterThan(0);
    }
  });

  it('all decoration keys are unique', () => {
    const keys = manifest.decorations.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('emits goblin NPC sprites (tnt, torch) across all 5 logical colors', () => {
    const goblinUnits = new Set(['tnt', 'torch']);
    const goblins = manifest.npcSprites.filter((n) => goblinUnits.has(n.unit));
    // 2 goblin units × 5 logical colors (black falls back to purple path) = 10.
    expect(goblins.length).toBe(10);
    // Every goblin entry should point under Factions/Goblins/Troops/…
    for (const g of goblins) {
      expect(g.idlePath.includes('/Factions/Goblins/Troops/')).toBe(true);
      expect(g.runPath).toBe(g.idlePath);
    }
    // And the knight entries should still be present (3 units × 5 colors).
    const knightUnits = new Set(['warrior', 'archer', 'pawn']);
    const knights = manifest.npcSprites.filter((n) => knightUnits.has(n.unit));
    expect(knights.length).toBe(15);
    // TNT directory segment is all-caps in the upstream pack — verify we
    // preserve that instead of capitalising only the first letter.
    const tnt = goblins.find((g) => g.unit === 'tnt' && g.color === 'blue');
    expect(tnt?.idlePath.includes('/TNT/')).toBe(true);
    expect(tnt?.idlePath.endsWith('TNT_Blue.png')).toBe(true);
  });

  it('legacy aliases cover pre-branch CC0 keys so old maps still render', () => {
    const keys = new Set(manifest.decorations.map((d) => d.key));
    // bush/rock/stump 1–4 + tree 1–4 + 5 colours × 4 house variants = 32 aliases
    for (const prefix of ['bush', 'rock', 'stump', 'tree']) {
      for (let i = 1; i <= 4; i++) {
        expect(keys.has(`${prefix}-${i}`)).toBe(true);
      }
    }
    for (const color of ['blue', 'yellow', 'red', 'purple', 'black']) {
      for (const variant of ['house1', 'house2', 'house3', 'tower']) {
        expect(keys.has(`house-${color}-${variant}`)).toBe(true);
      }
    }
  });
});
