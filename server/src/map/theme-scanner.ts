import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readPngDimensions } from './png-dimensions';

export interface ScannedAsset {
  absPath: string;
  webPath: string;
  relPath: string;
  folderPath: string[];
  fileName: string;
  fileStem: string;
  imageSize: { width: number; height: number };
}

export interface ScanOptions {
  excludeDirs?: string[];
  excludeFiles?: RegExp[];
}

/** Synchronously walk `themeRootAbs` for PNG files. Returns assets in
 * deterministic alphabetical order (stable across platforms).
 *
 * `excludeDirs` entries are matched two ways: bare names (e.g. `"UI"`)
 * skip *any* directory with that name anywhere in the tree, while entries
 * containing a slash (e.g. `"Terrain/Ground"`) are treated as paths
 * relative to `themeRootAbs` and only skip that one directory. Use the
 * latter form when a parent folder holds a mix of kept and excluded
 * subfolders (as with CC0 `Terrain/` — Water/Bridge kept, Ground dropped). */
export function scanTheme(
  themeRootAbs: string,
  themeWebRoot: string,
  opts: ScanOptions = {},
): ScannedAsset[] {
  const out: ScannedAsset[] = [];
  const excludeDirs = new Set(opts.excludeDirs ?? []);
  const excludeFiles = opts.excludeFiles ?? [];

  const walk = (dirAbs: string, relPath: string = ''): void => {
    const entries = readdirSync(dirAbs).sort();
    for (const name of entries) {
      const full = join(dirAbs, name);
      const stat = statSync(full);
      const childRel = relPath === '' ? name : `${relPath}/${name}`;
      if (stat.isDirectory()) {
        if (excludeDirs.has(name) || excludeDirs.has(childRel)) continue;
        walk(full, childRel);
        continue;
      }
      if (!stat.isFile()) continue;
      if (!name.toLowerCase().endsWith('.png')) continue;
      if (excludeFiles.some((re) => re.test(name))) continue;

      const rel = relative(themeRootAbs, full);
      const relPosix = rel.split(sep).join('/');
      const segs = relPosix.split('/');
      const fileName = segs.pop()!;
      const fileStem = fileName.replace(/\.png$/i, '');
      // URL-encode each segment: Vite dev server (and some proxies) treat
      // `+` as space in paths and don't accept literal `(` / `)`. spaces
      // encoded automatically by browsers, but `+` and parens need manual
      // escaping to survive the round trip.
      const encodedRel = relPosix.split('/').map(encodeURIComponent).join('/');

      out.push({
        absPath: full,
        webPath: `${themeWebRoot.replace(/\/$/, '')}/${encodedRel}`,
        relPath: relPosix,
        folderPath: segs,
        fileName,
        fileStem,
        imageSize: readPngDimensions(full),
      });
    }
  };

  walk(themeRootAbs);
  return out;
}
