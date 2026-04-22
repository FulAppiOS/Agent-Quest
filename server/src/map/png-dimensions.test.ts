import { describe, it, expect } from 'bun:test';
import { readPngDimensions } from './png-dimensions';
import { join } from 'node:path';

const ASSETS = join(import.meta.dir, '../../../client/public/assets/themes/tiny-swords-cc0');

describe('readPngDimensions', () => {
  it('reads a 64x64 static deco png', () => {
    const dims = readPngDimensions(join(ASSETS, 'Deco/01.png'));
    expect(dims.width).toBe(64);
    expect(dims.height).toBe(64);
  });

  it('reads a tileset png', () => {
    const dims = readPngDimensions(join(ASSETS, 'Terrain/Ground/Tilemap_Flat.png'));
    expect(dims.width).toBeGreaterThan(0);
    expect(dims.height).toBeGreaterThan(0);
  });

  it('throws on non-PNG file', () => {
    expect(() => readPngDimensions(join(ASSETS, 'README.md'))).toThrow(/not a PNG/i);
  });
});
