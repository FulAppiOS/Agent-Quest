import { describe, it, expect } from 'bun:test';
import { buildTree, folderSegments } from './TileTree';
import type { DecorationManifest } from '../types/map';

function deco(partial: Partial<DecorationManifest>): DecorationManifest {
  return {
    key: partial.key ?? 'test',
    label: partial.label ?? 'Test',
    path: partial.path ?? '/assets/test.png',
    category: partial.category ?? 'prop',
    group: partial.group ?? '',
    folderPath: partial.folderPath,
    frameWidth: partial.frameWidth,
    frameHeight: partial.frameHeight,
    defaultScale: partial.defaultScale ?? 0.5,
  };
}

describe('folderSegments', () => {
  it('returns folderPath when populated', () => {
    expect(folderSegments(deco({ folderPath: ['A', 'B'] }))).toEqual(['A', 'B']);
  });

  it('falls back to [group] when folderPath is undefined (v2 back-compat)', () => {
    expect(folderSegments(deco({ group: 'Bushes' }))).toEqual(['Bushes']);
  });

  it('returns empty when both are missing', () => {
    expect(folderSegments(deco({}))).toEqual([]);
  });

  it('treats empty folderPath array like undefined', () => {
    expect(folderSegments(deco({ folderPath: [], group: 'Rocks' }))).toEqual(['Rocks']);
  });
});

describe('buildTree', () => {
  it('creates a single-level tree for v2 flat groups', () => {
    const root = buildTree([
      deco({ key: 'b1', group: 'Bushes' }),
      deco({ key: 'b2', group: 'Bushes' }),
      deco({ key: 'r1', group: 'Rocks' }),
    ]);
    expect(Array.from(root.children.keys())).toEqual(['Bushes', 'Rocks']);
    expect(root.children.get('Bushes')!.assetCount).toBe(2);
    expect(root.children.get('Rocks')!.assetCount).toBe(1);
    expect(root.children.get('Bushes')!.children.size).toBe(0);
  });

  it('builds a nested tree from CC0-style folderPath', () => {
    const root = buildTree([
      deco({ key: 'a', folderPath: ['Factions', 'Knights', 'Troops', 'Archer', 'Blue'] }),
      deco({ key: 'b', folderPath: ['Factions', 'Knights', 'Troops', 'Archer', 'Red'] }),
      deco({ key: 'c', folderPath: ['Factions', 'Knights', 'Buildings', 'Castle'] }),
      deco({ key: 'd', folderPath: ['Deco'] }),
    ]);
    const factions = root.children.get('Factions')!;
    expect(factions).toBeDefined();
    expect(factions.assetCount).toBe(3);
    const knights = factions.children.get('Knights')!;
    expect(knights.children.size).toBe(2);
    expect(knights.children.get('Troops')!.children.get('Archer')!.children.size).toBe(2);
    expect(root.children.get('Deco')!.assetCount).toBe(1);
  });

  it('propagates counts to every ancestor folder', () => {
    const root = buildTree([
      deco({ key: 'a', folderPath: ['A', 'B', 'C'] }),
      deco({ key: 'b', folderPath: ['A', 'B', 'D'] }),
      deco({ key: 'c', folderPath: ['A', 'E'] }),
    ]);
    expect(root.children.get('A')!.assetCount).toBe(3);
    expect(root.children.get('A')!.children.get('B')!.assetCount).toBe(2);
    expect(root.children.get('A')!.children.get('E')!.assetCount).toBe(1);
    expect(root.children.get('A')!.children.get('B')!.children.get('C')!.assetCount).toBe(1);
  });

  it('skips decorations with empty folderSegments', () => {
    const root = buildTree([
      deco({ key: 'orphan' }), // no folderPath, no group
      deco({ key: 'ok', folderPath: ['Deco'] }),
    ]);
    expect(root.children.size).toBe(1);
    expect(root.children.has('Deco')).toBe(true);
  });

  it('mixes v2 and CC0 entries under a single tree', () => {
    const root = buildTree([
      deco({ key: 'v2', group: 'Bushes' }),
      deco({ key: 'cc0', folderPath: ['Deco'] }),
    ]);
    expect(Array.from(root.children.keys())).toEqual(['Bushes', 'Deco']);
  });

  it('fullKey equals the joined folderSegments', () => {
    const root = buildTree([
      deco({ key: 'a', folderPath: ['Factions', 'Knights'] }),
    ]);
    expect(root.children.get('Factions')!.fullKey).toBe('Factions');
    expect(root.children.get('Factions')!.children.get('Knights')!.fullKey).toBe('Factions/Knights');
  });
});
