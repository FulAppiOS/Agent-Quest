import { describe, it, expect } from 'bun:test';
import { scanTheme } from './theme-scanner';
import { join } from 'node:path';

const FIXTURE = join(import.meta.dir, '__fixtures__/fake-theme');

describe('scanTheme', () => {
  const assets = scanTheme(FIXTURE, '/fake', {
    excludeFiles: [/\.aseprite$/, /^\.DS_Store$/, /\.txt$/],
  });

  it('finds exactly 3 PNGs', () => {
    expect(assets.length).toBe(3);
  });

  it('omits .aseprite / .DS_Store / .txt', () => {
    for (const a of assets) {
      expect(a.fileName.endsWith('.png')).toBe(true);
    }
  });

  it('produces relative and web paths with forward slashes', () => {
    const a = assets.find((x) => x.fileName === '01.png')!;
    expect(a.relPath).toBe('Deco/01.png');
    expect(a.webPath).toBe('/fake/Deco/01.png');
    expect(a.folderPath).toEqual(['Deco']);
  });

  it('handles nested folders', () => {
    const a = assets.find((x) => x.fileName === '03.png')!;
    expect(a.folderPath).toEqual(['Sub', 'Nested']);
    expect(a.relPath).toBe('Sub/Nested/03.png');
  });

  it('reports image dimensions', () => {
    const a = assets.find((x) => x.fileName === '01.png')!;
    expect(a.imageSize.width).toBeGreaterThan(0);
    expect(a.imageSize.height).toBeGreaterThan(0);
  });

  it('supports excludeDirs', () => {
    const filtered = scanTheme(FIXTURE, '/fake', {
      excludeDirs: ['Sub'],
      excludeFiles: [/\.aseprite$/, /^\.DS_Store$/, /\.txt$/],
    });
    expect(filtered.length).toBe(2);
    expect(filtered.every((a) => !a.folderPath.includes('Sub'))).toBe(true);
  });
});
