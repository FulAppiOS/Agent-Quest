# CC0 Folder-Driven Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-curated CC0 asset manifest (~26 entries) with a folder-driven system that surfaces every PNG under `client/public/assets/themes/tiny-swords-cc0/` in the Map Editor palette via a tree sidebar, with static-by-default placement and an opt-in "Animate" toggle for spritesheets.

**Architecture:** Server walks the CC0 theme folder at manifest-build time, applies a central ordered rule set (`cc0-pack-metadata.ts`) to derive per-asset spritesheet dimensions / animations / categories, and returns a `DecorationManifest[]` whose `folderPath` drives a new client `<TileTree>` component. Phaser registers animations from the manifest and the renderer calls `sprite.play(key)` only when the `DecorationInstance.animated === true` flag is set.

**Tech Stack:** Bun 1.1+ (server, tests via `bun test`), Hono, TypeScript strict, React 19, Phaser 4.

**Spec reference:** `docs/specs/2026-04-18-cc0-folder-driven-palette-design.md`

**Branch:** `feat/cc0-folder-driven-palette` (already created from `main`).

**Testing note:** Server tests use `bun test` (built-in). The client has no configured test runner, so client UI is verified manually at the end (Task 15). Do NOT add Vitest just for this feature — YAGNI.

---

## File Structure Overview

**Files created:**
- `server/src/map/png-dimensions.ts` — tiny PNG IHDR reader (sync, no deps)
- `server/src/map/png-dimensions.test.ts`
- `server/src/map/theme-scanner.ts` — recursive folder walker
- `server/src/map/theme-scanner.test.ts`
- `server/src/map/__fixtures__/fake-theme/**` — tiny fixture tree for scanner test
- `server/src/map/cc0-pack-metadata.ts` — ordered rule set + `applyRules()`
- `server/src/map/cc0-pack-metadata.test.ts`
- `client/src/editor/panels/TileTree.tsx` — sidebar tree component
- `client/src/editor/panels/DecorationDetail.tsx` — Animate toggle panel

**Files modified:**
- `server/src/map/types.ts` (add fields to `DecorationManifest` + `DecorationInstance`, add `AnimSpec`)
- `client/src/editor/types/map.ts` (mirror)
- `client/src/editor/types/editor-events.ts` (extend `DecorationBrushPayload`)
- `server/src/map/asset-manifest-cc0.ts` (replace hand list with scanner-driven build)
- `client/src/editor/panels/TilePalette.tsx` (swap tab bar → tree + grid)
- `client/src/editor/state/editor-store.ts` (extend brush setter, optional)
- `client/src/editor/game/scenes/EditorScene.ts` (pass animated fields on placement)
- `client/src/game/data/asset-loader.ts` (register Phaser animations from manifest)
- `client/src/game/terrain/MapConfigRenderer.ts` (play animation when `d.animated`)

---

## Task 1: Extend shared `DecorationManifest` + `DecorationInstance` types

Mirror both copies (`server/src/map/types.ts` and `client/src/editor/types/map.ts`) — the file header explicitly states both must stay in sync.

**Files:**
- Modify: `server/src/map/types.ts` (around lines 54-67 + 130-147)
- Modify: `client/src/editor/types/map.ts` (mirror same ranges)

- [ ] **Step 1: Add `AnimSpec` + extend `DecorationManifest` in `server/src/map/types.ts`**

Insert after line 147 (end of `DecorationManifest`), and replace the existing `DecorationManifest` body:

```ts
/** Animation definition for a decoration spritesheet. frame indices are
 * 0-based into the sheet's frame grid. */
export interface AnimSpec {
  name: string;         // "idle" | "walk" | "attack" | ...
  start: number;
  end: number;
  frameRate?: number;   // default 10 at load time
  repeat?: number;      // default -1 (loop)
}

export interface DecorationManifest {
  key: string;
  label: string;
  path: string;
  category: 'tree' | 'bush' | 'rock' | 'stump' | 'cloud' | 'house' | 'prop' | 'water-rock' | 'water' | 'effect';
  /** UI group label — typically `folderPath.join('/')`. Kept for backward
   * compat with existing palette code that reads `group`. */
  group: string;
  /** Hierarchical path from the theme root, e.g. ["Factions","Knights","Buildings","Castle"].
   * Optional — entries without a folder path render under the tree root as a flat group. */
  folderPath?: string[];
  frameWidth?: number;
  frameHeight?: number;
  /** Derived from sheet dimensions / frame size. Only set for spritesheets. */
  frameCount?: number;
  /** If present, Phaser animations named `${key}:${spec.name}` are registered at load time. */
  animations?: AnimSpec[];
  defaultScale: number;
}
```

Also replace the existing `DecorationInstance`:

```ts
export interface DecorationInstance {
  id: string;
  textureKey: string;
  frame?: number;
  x: number;
  y: number;
  scale: number;
  depth?: number;
  tint?: number;
  /** When true, renderer calls sprite.play(`${textureKey}:${animation}`). Optional for back-compat. */
  animated?: boolean;
  /** Animation name (must match one of the manifest's AnimSpec.name). Defaults to "idle". */
  animation?: string;
}
```

- [ ] **Step 2: Mirror identical changes in `client/src/editor/types/map.ts`**

Same `AnimSpec` export, same `DecorationManifest` body (line ~131-145), same `DecorationInstance` body (line ~73-84). Keep the JSDoc comments identical.

- [ ] **Step 3: Verify TypeScript compiles on both sides**

Run:
```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/server && bun tsc --noEmit
cd /Users/Fulvio/Documents/AppDev/claude-quest/client && bun tsc --noEmit
```
Expected: no errors on both sides. All new fields are optional, so the existing hand-curated `asset-manifest-cc0.ts` and v2 manifest still compile without edits.

- [ ] **Step 4: Commit**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add server/src/map/types.ts client/src/editor/types/map.ts
git commit -m "feat(types): add folderPath + animations to DecorationManifest, animated flag to DecorationInstance

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: PNG IHDR dimension reader utility

A standalone 20-line sync utility that reads the first 24 bytes of a PNG and extracts width/height. Avoids adding the `image-size` npm dep.

**Files:**
- Create: `server/src/map/png-dimensions.ts`
- Test: `server/src/map/png-dimensions.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/map/png-dimensions.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/server && bun test src/map/png-dimensions.test.ts
```
Expected: FAIL with "Cannot find module './png-dimensions'".

- [ ] **Step 3: Implement `png-dimensions.ts`**

Create `server/src/map/png-dimensions.ts`:

```ts
import { readFileSync } from 'node:fs';

/** PNG file signature (first 8 bytes). */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngDimensions {
  width: number;
  height: number;
}

/** Read PNG width/height from the IHDR chunk. Fast sync path: reads only
 * the first 24 bytes. Throws if the file is not a PNG. */
export function readPngDimensions(absPath: string): PngDimensions {
  const fd = readFileSync(absPath, { encoding: null }).subarray(0, 24);
  if (fd.length < 24 || !fd.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error(`not a PNG: ${absPath}`);
  }
  // IHDR starts at byte 8; width = bytes 16..19 BE, height = bytes 20..23 BE.
  const width = fd.readUInt32BE(16);
  const height = fd.readUInt32BE(20);
  return { width, height };
}
```

- [ ] **Step 4: Run test, verify PASS**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/server && bun test src/map/png-dimensions.test.ts
```
Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add server/src/map/png-dimensions.ts server/src/map/png-dimensions.test.ts
git commit -m "feat(server): add sync PNG IHDR dimension reader

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Theme folder scanner

Walks a theme directory and emits a typed list of PNG assets with relative paths, folder segments, and image dimensions. Pure function — no caching.

**Files:**
- Create: `server/src/map/theme-scanner.ts`
- Create: `server/src/map/theme-scanner.test.ts`
- Create fixture tree: `server/src/map/__fixtures__/fake-theme/{Deco/01.png, Deco/02.png, Sub/Nested/03.png, Ignored/readme.txt, Ignored/file.aseprite, .DS_Store}`

- [ ] **Step 1: Create fixture tree**

We need real PNG bytes so `readPngDimensions` works. Copy three small PNGs from the actual CC0 theme as fixtures.

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
mkdir -p server/src/map/__fixtures__/fake-theme/Deco
mkdir -p server/src/map/__fixtures__/fake-theme/Sub/Nested
mkdir -p server/src/map/__fixtures__/fake-theme/Ignored
cp "client/public/assets/themes/tiny-swords-cc0/Deco/01.png" server/src/map/__fixtures__/fake-theme/Deco/01.png
cp "client/public/assets/themes/tiny-swords-cc0/Deco/02.png" server/src/map/__fixtures__/fake-theme/Deco/02.png
cp "client/public/assets/themes/tiny-swords-cc0/Deco/03.png" server/src/map/__fixtures__/fake-theme/Sub/Nested/03.png
touch server/src/map/__fixtures__/fake-theme/Ignored/readme.txt
touch server/src/map/__fixtures__/fake-theme/Ignored/file.aseprite
touch server/src/map/__fixtures__/fake-theme/.DS_Store
```

- [ ] **Step 2: Write failing test**

Create `server/src/map/theme-scanner.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test, verify FAIL**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/server && bun test src/map/theme-scanner.test.ts
```
Expected: FAIL with "Cannot find module './theme-scanner'".

- [ ] **Step 4: Implement `theme-scanner.ts`**

Create `server/src/map/theme-scanner.ts`:

```ts
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { readPngDimensions } from './png-dimensions';

export interface ScannedAsset {
  absPath: string;
  webPath: string;        // URL path served by the dev server
  relPath: string;        // POSIX-style, relative to theme root
  folderPath: string[];   // folder segments (no file name)
  fileName: string;
  fileStem: string;
  imageSize: { width: number; height: number };
}

export interface ScanOptions {
  excludeDirs?: string[];      // matched against any folder segment
  excludeFiles?: RegExp[];     // matched against the file name
}

/** Synchronously walk `themeRootAbs` for PNG files. Returns assets in
 * deterministic alphabetical order (stable across platforms). */
export function scanTheme(
  themeRootAbs: string,
  themeWebRoot: string,
  opts: ScanOptions = {},
): ScannedAsset[] {
  const out: ScannedAsset[] = [];
  const excludeDirs = new Set(opts.excludeDirs ?? []);
  const excludeFiles = opts.excludeFiles ?? [];

  const walk = (dirAbs: string): void => {
    const entries = readdirSync(dirAbs).sort();
    for (const name of entries) {
      const full = join(dirAbs, name);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (excludeDirs.has(name)) continue;
        walk(full);
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

      out.push({
        absPath: full,
        webPath: `${themeWebRoot.replace(/\/$/, '')}/${relPosix}`,
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
```

- [ ] **Step 5: Run test, verify PASS**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/server && bun test src/map/theme-scanner.test.ts
```
Expected: 6 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add server/src/map/theme-scanner.ts server/src/map/theme-scanner.test.ts server/src/map/__fixtures__
git commit -m "feat(server): recursive theme folder scanner with PNG dim lookup

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Measure real CC0 spritesheet dimensions

Run a one-off script that prints the dimensions of every PNG under `Factions/` and `Effects/` so we can build accurate metadata rules. The script is intentionally ad-hoc — it won't be committed to the repo.

- [ ] **Step 1: Run measurement script in a subshell**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/server
bun -e "
import { scanTheme } from './src/map/theme-scanner';
import { join } from 'node:path';
const ROOT = join(process.cwd(), '../client/public/assets/themes/tiny-swords-cc0');
const assets = scanTheme(ROOT, '/assets/themes/tiny-swords-cc0', {
  excludeDirs: ['Terrain'],
  excludeFiles: [/\\\.aseprite\$/, /^\\\.DS_Store\$/],
});
for (const a of assets) console.log(\`\${a.imageSize.width}x\${a.imageSize.height}  \${a.relPath}\`);
"
```
Expected: a few dozen lines like `192x1152  Factions/Knights/Troops/Archer/Blue/Archer_Blue.png`.

- [ ] **Step 2: Record the findings in a temporary note**

Write the output to `/tmp/cc0-dims.txt` (not committed). Infer frame grid per folder — e.g. a `1152x192` sheet with row-major 6-frame idle = frames 0..5, or a stack of rows (idle 0..5, walk 6..13, attack 14..21 for 8 frames each etc.). Common Tiny Swords conventions:

| Folder glob | Sheet size | Frame size | Row layout |
|---|---|---|---|
| `Factions/Knights/Troops/Archer/+(Blue\|Purple\|Red\|Yellow)/*.png` | varies | **192×192** | multi-row (Idle row 0, Walk row 1, Attack row 2, Hurt row 3, Death row 4) |
| `Factions/Knights/Troops/Pawn/...` | varies | **192×192** | multi-row |
| `Factions/Knights/Troops/Warrior/...` | varies | **192×192** | multi-row |
| `Factions/Knights/Troops/Dead/Dead.png` | 192×192 | 192×192 | single frame |
| `Factions/Knights/Troops/Archer/Archer + Bow/*.png` | varies | **192×192** | multi-row |
| `Factions/Knights/Troops/Archer/Arrow/*.png` | small | native | single frame |
| `Factions/Goblins/Troops/Barrel/+(Blue\|Purple\|Red\|Yellow)/*.png` | varies | **192×192** | multi-row |
| `Factions/Goblins/Troops/TNT/+(Blue\|Purple\|Red\|Yellow)/*.png` | varies | **192×192** | multi-row |
| `Factions/Goblins/Troops/TNT/Dynamite/*.png` | small | native | multi-frame sheet |
| `Factions/Goblins/Troops/Torch/+(Blue\|Purple\|Red\|Yellow)/*.png` | varies | **192×192** | multi-row |
| `Effects/Explosion/*.png` | wide | 192×192 | single row |
| `Effects/Fire/*.png` | wide | 192×192 | single row |
| `Resources/Trees/Tree.png` | varies | 192×192 | spritesheet with 4+ frames |
| `Resources/Sheep/*.png` | varies | 128×128 | spritesheet |
| `Resources/Gold Mine/*.png` | varies | 128×128 | spritesheet |
| `Resources/Resources/Resources.png` | large | 128×128 | spritesheet |

Use the measured data to fill in the `CC0_PACK_RULES` in Task 5. If a sheet's `width % frameWidth !== 0` or `height % frameHeight !== 0`, fall back to `frameWidth=imageSize.width, frameHeight=imageSize.height` (single frame static).

- [ ] **Step 3: No commit for this task** — it's a measurement step; findings flow into Task 5.

---

## Task 5: CC0 pack metadata rules + `applyRules` function

Declarative rule set plus a pure function that maps a `ScannedAsset` → `DecorationManifest | null` (null = excluded).

**Files:**
- Create: `server/src/map/cc0-pack-metadata.ts`
- Create: `server/src/map/cc0-pack-metadata.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/src/map/cc0-pack-metadata.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { applyRules, CC0_PACK_RULES } from './cc0-pack-metadata';
import type { ScannedAsset } from './theme-scanner';

function fakeAsset(relPath: string, w = 64, h = 64): ScannedAsset {
  const segs = relPath.split('/');
  const fileName = segs.pop()!;
  return {
    absPath: '/abs/' + relPath,
    webPath: '/assets/themes/tiny-swords-cc0/' + relPath,
    relPath,
    folderPath: segs,
    fileName,
    fileStem: fileName.replace(/\.png$/, ''),
    imageSize: { width: w, height: h },
  };
}

describe('applyRules', () => {
  it('static Deco fallback: no rule matches, default scale + prop category', () => {
    const deco = applyRules(fakeAsset('Deco/13.png'), CC0_PACK_RULES);
    expect(deco).not.toBeNull();
    expect(deco!.category).toBe('prop');
    expect(deco!.folderPath).toEqual(['Deco']);
    expect(deco!.frameWidth).toBeUndefined();
    expect(deco!.animations).toBeUndefined();
    expect(deco!.defaultScale).toBeGreaterThan(0);
  });

  it('Knights Archer Blue → spritesheet with idle/walk/attack anims', () => {
    const deco = applyRules(
      fakeAsset('Factions/Knights/Troops/Archer/Blue/Archer_Blue.png', 1152, 960),
      CC0_PACK_RULES,
    );
    expect(deco).not.toBeNull();
    expect(deco!.frameWidth).toBe(192);
    expect(deco!.frameHeight).toBe(192);
    expect(deco!.animations?.map((a) => a.name)).toEqual(
      expect.arrayContaining(['idle', 'walk', 'attack']),
    );
    expect(deco!.folderPath).toEqual(['Factions', 'Knights', 'Troops', 'Archer', 'Blue']);
  });

  it('Effects/Fire → effect category, looping animation', () => {
    const deco = applyRules(
      fakeAsset('Effects/Fire/Fire.png', 1344, 192),
      CC0_PACK_RULES,
    );
    expect(deco!.category).toBe('effect');
    expect(deco!.animations).toBeDefined();
    expect(deco!.animations![0].repeat).toBe(-1);
  });

  it('Knights building → house category, no animation', () => {
    const deco = applyRules(
      fakeAsset('Factions/Knights/Buildings/Castle/Castle_Blue.png', 384, 256),
      CC0_PACK_RULES,
    );
    expect(deco!.category).toBe('house');
    expect(deco!.animations).toBeUndefined();
  });

  it('exclude rule returns null', () => {
    // We expect UI/Pointers/* to be excluded as non-placeable.
    const deco = applyRules(
      fakeAsset('UI/Pointers/01.png'),
      CC0_PACK_RULES,
    );
    expect(deco).toBeNull();
  });

  it('key is unique and derived from folderPath + fileStem', () => {
    const a = applyRules(fakeAsset('Deco/07.png'), CC0_PACK_RULES)!;
    const b = applyRules(fakeAsset('Resources/Trees/Tree.png', 768, 192), CC0_PACK_RULES)!;
    expect(a.key).not.toBe(b.key);
    expect(a.key.length).toBeGreaterThan(0);
  });

  it('label is human-readable', () => {
    const a = applyRules(fakeAsset('Factions/Goblins/Troops/Barrel/Red/Barrel_Red.png', 1152, 192), CC0_PACK_RULES)!;
    expect(a.label.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/server && bun test src/map/cc0-pack-metadata.test.ts
```
Expected: FAIL with "Cannot find module './cc0-pack-metadata'".

- [ ] **Step 3: Implement `cc0-pack-metadata.ts`**

Create `server/src/map/cc0-pack-metadata.ts`:

```ts
import type { ScannedAsset } from './theme-scanner';
import type { AnimSpec, DecorationManifest } from './types';

export interface PackMetaRule {
  /** Micro-glob against `relPath`. Supported: `*` (no `/`), `**` (any depth),
   * `+(a|b|c)` (alternation). No `?` / `[...]` needed for this codebase. */
  match: string;
  spritesheet?: { frameWidth: number; frameHeight: number };
  animations?: AnimSpec[];
  defaultScale?: number;
  category?: DecorationManifest['category'];
  labelOverride?: (asset: ScannedAsset) => string;
  keyOverride?: (asset: ScannedAsset) => string;
  /** If true, applyRules returns null for matching assets. */
  exclude?: boolean;
}

// -- tiny-swords standard 192×192 unit sheet layout (5 rows, 6 cols each) -------
const UNIT_ANIMS: AnimSpec[] = [
  { name: 'idle',   start: 0,  end: 5,  frameRate: 6,  repeat: -1 },
  { name: 'walk',   start: 6,  end: 11, frameRate: 10, repeat: -1 },
  { name: 'attack', start: 12, end: 17, frameRate: 12, repeat: -1 },
  { name: 'hurt',   start: 18, end: 23, frameRate: 10, repeat: 0 },
  { name: 'death',  start: 24, end: 29, frameRate: 10, repeat: 0 },
];

// -- effects: single-row looping --------------------------------------------
const FX_ANIM_LOOP: AnimSpec[] = [
  { name: 'play', start: 0, end: 6, frameRate: 16, repeat: -1 },
];

export const CC0_PACK_RULES: PackMetaRule[] = [
  // UI — not placeable on the map
  { match: 'UI/**', exclude: true },

  // Knights troops: 192×192 sheets
  {
    match: 'Factions/Knights/Troops/+(Archer|Pawn|Warrior)/+(Blue|Purple|Red|Yellow)/*.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: UNIT_ANIMS,
    defaultScale: 0.5,
    category: 'prop',
  },
  // Archer + Bow preview sheet
  {
    match: 'Factions/Knights/Troops/Archer/Archer + Bow/*.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: UNIT_ANIMS,
    defaultScale: 0.5,
    category: 'prop',
  },
  // Arrow projectile — static
  {
    match: 'Factions/Knights/Troops/Archer/Arrow/*.png',
    defaultScale: 0.5,
    category: 'prop',
  },
  // Dead sprite — single frame
  {
    match: 'Factions/Knights/Troops/Dead/Dead.png',
    defaultScale: 0.5,
    category: 'prop',
  },
  // Goblins troops
  {
    match: 'Factions/Goblins/Troops/+(Barrel|TNT|Torch)/+(Blue|Purple|Red|Yellow)/*.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: UNIT_ANIMS,
    defaultScale: 0.5,
    category: 'prop',
  },
  {
    match: 'Factions/Goblins/Troops/TNT/Dynamite/*.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: [{ name: 'play', start: 0, end: 5, frameRate: 12, repeat: -1 }],
    defaultScale: 0.4,
    category: 'effect',
  },

  // Knights buildings — static, larger default scale
  {
    match: 'Factions/Knights/Buildings/+(Castle|House|Tower)/*.png',
    defaultScale: 0.6,
    category: 'house',
  },
  // Goblins buildings
  {
    match: 'Factions/Goblins/Buildings/+(Wood_House|Wood_Tower)/*.png',
    defaultScale: 0.6,
    category: 'house',
  },

  // Effects
  {
    match: 'Effects/+(Explosion|Fire)/*.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: FX_ANIM_LOOP,
    defaultScale: 0.6,
    category: 'effect',
  },

  // Resources
  {
    match: 'Resources/Trees/Tree.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: [{ name: 'idle', start: 0, end: 3, frameRate: 6, repeat: -1 }],
    defaultScale: 0.85,
    category: 'tree',
  },
  {
    match: 'Resources/Sheep/*.png',
    spritesheet: { frameWidth: 128, frameHeight: 128 },
    animations: [{ name: 'idle', start: 0, end: 7, frameRate: 8, repeat: -1 }],
    defaultScale: 0.5,
    category: 'prop',
  },
  {
    match: 'Resources/Gold Mine/*.png',
    spritesheet: { frameWidth: 128, frameHeight: 128 },
    animations: [{ name: 'idle', start: 0, end: 5, frameRate: 8, repeat: -1 }],
    defaultScale: 0.7,
    category: 'prop',
  },
  {
    match: 'Resources/Resources/Resources.png',
    spritesheet: { frameWidth: 128, frameHeight: 128 },
    defaultScale: 0.6,
    category: 'prop',
  },

  // Deco fallback handled by applyRules() default (no rule match → static prop)
];

// ---------------------------------------------------------------------------
// Glob matching: custom minimal engine (Bun has no dep we need here)
// ---------------------------------------------------------------------------

function globToRegex(glob: string): RegExp {
  // Escape regex specials except our metacharacters
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 2;
      if (glob[i] === '/') i++; // consume trailing slash of **/
      continue;
    }
    if (c === '*') { re += '[^/]*'; i++; continue; }
    if (c === '+' && glob[i + 1] === '(') {
      const close = glob.indexOf(')', i);
      const group = glob.slice(i + 2, close).split('|').map((x) => x.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|');
      re += `(?:${group})`;
      i = close + 1;
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(c)) re += '\\' + c;
    else re += c;
    i++;
  }
  return new RegExp(`^${re}$`);
}

// Cache compiled regexes per rule.
const compiled = new WeakMap<PackMetaRule, RegExp>();
function compiledMatch(rule: PackMetaRule): RegExp {
  let r = compiled.get(rule);
  if (r === undefined) { r = globToRegex(rule.match); compiled.set(rule, r); }
  return r;
}

// ---------------------------------------------------------------------------
// Apply rules to one asset
// ---------------------------------------------------------------------------

function humanize(stem: string): string {
  return stem.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function defaultCategory(folderPath: string[]): DecorationManifest['category'] {
  if (folderPath[0] === 'Effects') return 'effect';
  if (folderPath[0] === 'Deco') return 'prop';
  if (folderPath[0] === 'Resources' && folderPath[1] === 'Trees') return 'tree';
  if (folderPath[0] === 'Factions' && folderPath.includes('Buildings')) return 'house';
  return 'prop';
}

export function applyRules(
  asset: ScannedAsset,
  rules: PackMetaRule[] = CC0_PACK_RULES,
): DecorationManifest | null {
  const matched = rules.find((r) => compiledMatch(r).test(asset.relPath));
  if (matched?.exclude) return null;

  const spritesheet = matched?.spritesheet;
  const frameWidth = spritesheet?.frameWidth;
  const frameHeight = spritesheet?.frameHeight;
  let frameCount: number | undefined;
  if (frameWidth !== undefined && frameHeight !== undefined) {
    const cols = Math.floor(asset.imageSize.width / frameWidth);
    const rows = Math.floor(asset.imageSize.height / frameHeight);
    if (cols > 0 && rows > 0) frameCount = cols * rows;
  }

  // Optional sanity: drop animations that would read past frameCount.
  let animations = matched?.animations;
  if (animations !== undefined && frameCount !== undefined) {
    animations = animations.filter((a) => a.end < frameCount!);
    if (animations.length === 0) animations = undefined;
  }

  const key = matched?.keyOverride?.(asset) ?? deriveKey(asset);
  const label = matched?.labelOverride?.(asset) ?? humanize(asset.fileStem);
  const group = asset.folderPath.join('/');
  const category = matched?.category ?? defaultCategory(asset.folderPath);
  const defaultScale = matched?.defaultScale ?? 0.55;

  return {
    key,
    label,
    path: asset.webPath,
    category,
    group,
    folderPath: asset.folderPath.slice(),
    frameWidth,
    frameHeight,
    frameCount,
    animations,
    defaultScale,
  };
}

/** key format: lowercased folderPath segments + stem, slashes → hyphens. */
function deriveKey(asset: ScannedAsset): string {
  const parts = [...asset.folderPath, asset.fileStem].map((s) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
  );
  return parts.filter((p) => p.length > 0).join('-');
}
```

- [ ] **Step 4: Run test, verify PASS**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/server && bun test src/map/cc0-pack-metadata.test.ts
```
Expected: 7 pass, 0 fail.

If `UI/Pointers/01.png` test fails because no such file exists, the test is fine — it uses a fake asset and only checks the rule engine.

- [ ] **Step 5: Commit**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add server/src/map/cc0-pack-metadata.ts server/src/map/cc0-pack-metadata.test.ts
git commit -m "feat(server): CC0 pack metadata rules + applyRules engine

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Refactor `asset-manifest-cc0.ts` to scanner-driven

Keep Terrain + NPC definitions as they are; replace `buildCc0Decorations()` (or the hand list) with a call that uses `scanTheme` + `applyRules`.

**Files:**
- Modify: `server/src/map/asset-manifest-cc0.ts`
- Create: `server/src/map/asset-manifest-cc0.test.ts`

- [ ] **Step 1: Read the current file and locate the decorations builder**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
sed -n '1,20p' server/src/map/asset-manifest-cc0.ts  # see imports + exports
```

- [ ] **Step 2: Write smoke test**

Create `server/src/map/asset-manifest-cc0.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { buildAssetManifestCc0 } from './asset-manifest-cc0';

describe('buildAssetManifestCc0', () => {
  const manifest = buildAssetManifestCc0();

  it('returns tilesets unchanged (Flat + Elevation)', () => {
    const keys = manifest.tilesets.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(['terrain-cc0-flat', 'terrain-cc0-elevation']));
  });

  it('exposes all 18 Deco/*.png entries', () => {
    const deco = manifest.decorations.filter((d) => d.folderPath[0] === 'Deco');
    expect(deco.length).toBe(18);
  });

  it('exposes Factions/Knights/Troops entries as spritesheets', () => {
    const troops = manifest.decorations.filter(
      (d) => d.folderPath[0] === 'Factions' && d.folderPath[1] === 'Knights' && d.folderPath[2] === 'Troops',
    );
    expect(troops.length).toBeGreaterThan(0);
    const anySheet = troops.find((d) => d.frameWidth !== undefined);
    expect(anySheet).toBeDefined();
    expect(anySheet!.animations).toBeDefined();
  });

  it('excludes UI', () => {
    const ui = manifest.decorations.filter((d) => d.folderPath[0] === 'UI');
    expect(ui.length).toBe(0);
  });

  it('excludes Terrain (handled as tilesets)', () => {
    const terrain = manifest.decorations.filter((d) => d.folderPath[0] === 'Terrain');
    expect(terrain.length).toBe(0);
  });

  it('every decoration has a non-empty key, label, path', () => {
    for (const d of manifest.decorations) {
      expect(d.key.length).toBeGreaterThan(0);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.path.startsWith('/assets/')).toBe(true);
      expect(d.folderPath.length).toBeGreaterThan(0);
    }
  });

  it('all decoration keys are unique', () => {
    const keys = manifest.decorations.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 3: Refactor `asset-manifest-cc0.ts`**

Locate the current `buildAssetManifestCc0()` function. Replace the decorations builder with a scanner call. Keep the tileset + NPC blocks untouched.

Exact edit: inside `asset-manifest-cc0.ts`, replace the body of `buildAssetManifestCc0()` such that it reads:

```ts
import { join } from 'node:path';
import { scanTheme } from './theme-scanner';
import { applyRules, CC0_PACK_RULES } from './cc0-pack-metadata';
import type { AssetManifest, DecorationManifest } from './types';

const CC0_ABS_ROOT = join(import.meta.dir, '../../../client/public/assets/themes/tiny-swords-cc0');
const CC0_WEB_ROOT = '/assets/themes/tiny-swords-cc0';

export function buildAssetManifestCc0(): AssetManifest {
  return {
    tilesets: buildCc0Tilesets(),                      // keep existing implementation
    decorations: buildCc0DecorationsFromScan(),
    protectedBuildings: [],                            // keep whatever the current file returns
    npcSprites: buildCc0NpcSprites(),                  // keep existing implementation
  };
}

function buildCc0DecorationsFromScan(): DecorationManifest[] {
  const assets = scanTheme(CC0_ABS_ROOT, CC0_WEB_ROOT, {
    excludeDirs: ['Terrain'],
    excludeFiles: [/\.aseprite$/i, /^\.DS_Store$/i, /^LICENSE/i, /^README/i],
  });
  const out: DecorationManifest[] = [];
  for (const asset of assets) {
    const entry = applyRules(asset, CC0_PACK_RULES);
    if (entry !== null) out.push(entry);
  }
  return out;
}
```

Delete the old hand-curated `buildCc0Decorations()` / `buildHouses()` / `buildTrees()` helpers. Keep `buildCc0Tilesets()` and `buildCc0NpcSprites()` as they are.

**Important:** the `npcSprites` builder in the current file may reference decoration keys like `"castle-blue"` — those keys are now generated by `deriveKey()` as e.g. `"factions-knights-buildings-castle-castle-blue"`. If the NPC builder references decoration keys, update those references to match the new deriveKey scheme, or add a `keyOverride` entry in `CC0_PACK_RULES` to preserve the legacy key. Search-and-check:

```bash
grep -n "building-\|castle-\|house-\|tower-" server/src/map/asset-manifest-cc0.ts
```

If any legacy reference breaks, prefer adding a `keyOverride` rule (minimal change) — e.g.:

```ts
// legacy compat — earlier code referenced these keys directly
{
  match: 'Factions/Knights/Buildings/Castle/Castle_Blue.png',
  keyOverride: () => 'castle-blue',
  defaultScale: 0.6,
  category: 'house',
},
```

- [ ] **Step 4: Run the full server test suite**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/server && bun test
```
Expected: new smoke tests pass; no regression in other tests.

- [ ] **Step 5: Verify TypeScript compiles server-wide**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/server && bun tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add server/src/map/asset-manifest-cc0.ts server/src/map/asset-manifest-cc0.test.ts
git commit -m "feat(server): CC0 manifest built from folder scan + metadata rules

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Extend `DecorationBrushPayload` with `animated` + `animation`

**Files:**
- Modify: `client/src/editor/types/editor-events.ts` (line 38-42)

- [ ] **Step 1: Extend the payload interface**

Replace lines 38-42 in `client/src/editor/types/editor-events.ts` with:

```ts
export interface DecorationBrushPayload {
  key: string;
  frame?: number;
  scale: number;
  /** When true, placed instance gets `animated: true`. Default false. */
  animated?: boolean;
  /** Animation name from the manifest's AnimSpec. Defaults to "idle". */
  animation?: string;
}
```

- [ ] **Step 2: Verify TS compiles**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/client && bun tsc --noEmit
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add client/src/editor/types/editor-events.ts
git commit -m "feat(editor): extend DecorationBrushPayload with animated + animation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Register Phaser animations from the manifest during asset load

**Files:**
- Modify: `client/src/game/data/asset-loader.ts`

- [ ] **Step 1: Extend `ensureAssetsLoaded` to register animations after load**

Edit `client/src/game/data/asset-loader.ts`. After the existing `scene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve())` block, register animations for every decoration that has them. Replace the last ~10 lines (from `if (toLoad.length === 0) return;` onwards) with:

```ts
  if (toLoad.length === 0) {
    registerAnimations(scene, manifest);
    return;
  }

  return new Promise<void>((resolve) => {
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      registerAnimations(scene, manifest);
      resolve();
    });
    for (const fn of toLoad) fn();
    scene.load.start();
  });
}

function registerAnimations(scene: Phaser.Scene, manifest: AssetManifest): void {
  for (const deco of manifest.decorations) {
    if (deco.animations === undefined) continue;
    if (!scene.textures.exists(deco.key)) continue;
    for (const anim of deco.animations) {
      const animKey = `${deco.key}:${anim.name}`;
      if (scene.anims.exists(animKey)) continue;
      scene.anims.create({
        key: animKey,
        frames: scene.anims.generateFrameNumbers(deco.key, { start: anim.start, end: anim.end }),
        frameRate: anim.frameRate ?? 10,
        repeat: anim.repeat ?? -1,
      });
    }
  }
}
```

- [ ] **Step 2: Verify TS compiles**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/client && bun tsc --noEmit
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add client/src/game/data/asset-loader.ts
git commit -m "feat(client): register Phaser animations from manifest after texture load

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `MapConfigRenderer` plays animation when `d.animated === true`

**Files:**
- Modify: `client/src/game/terrain/MapConfigRenderer.ts` (decoration loop around lines 73-86)

- [ ] **Step 1: Update sprite instantiation**

Locate the decoration loop. Replace:

```ts
for (const d of map.decorations) {
  if (!scene.textures.exists(d.textureKey)) continue;
  const sprite = d.frame !== undefined
    ? scene.add.sprite(d.x, d.y, d.textureKey, d.frame)
    : scene.add.image(d.x, d.y, d.textureKey);
  sprite.setScale(d.scale);
  if (d.tint !== undefined) sprite.setTint(d.tint);
  const footY = d.y + sprite.displayHeight * 0.5;
  sprite.setDepth(d.depth ?? footY);
}
```

With:

```ts
for (const d of map.decorations) {
  if (!scene.textures.exists(d.textureKey)) continue;
  const needsSprite = d.frame !== undefined || d.animated === true;
  const gameObj = needsSprite
    ? scene.add.sprite(d.x, d.y, d.textureKey, d.frame ?? 0)
    : scene.add.image(d.x, d.y, d.textureKey);
  gameObj.setScale(d.scale);
  if (d.tint !== undefined) gameObj.setTint(d.tint);
  if (d.animated === true && gameObj instanceof Phaser.GameObjects.Sprite) {
    const animName = d.animation ?? 'idle';
    const animKey = `${d.textureKey}:${animName}`;
    if (scene.anims.exists(animKey)) gameObj.play(animKey);
  }
  const footY = d.y + gameObj.displayHeight * 0.5;
  gameObj.setDepth(d.depth ?? footY);
}
```

Ensure `import * as Phaser from 'phaser'` is already present at the top of the file; if not, add it.

- [ ] **Step 2: Verify TS compiles**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/client && bun tsc --noEmit
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add client/src/game/terrain/MapConfigRenderer.ts
git commit -m "feat(renderer): play per-decoration animation when d.animated === true

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `EditorScene` persists `animated` + `animation` on placement

**Files:**
- Modify: `client/src/editor/game/scenes/EditorScene.ts` (around line 696-706 — the `placeDecoration` method)

- [ ] **Step 1: Write `animated` + `animation` into the pushed instance**

Locate the method that does `this.mapConfig.decorations.push(instance)` (near line 706). Replace the `instance` construction with:

```ts
const instance = {
  id: generateId('dec'),   // keep whatever id helper the file already uses
  textureKey: this.decorationBrush.key,
  frame: this.decorationBrush.frame,
  x: worldX,
  y: worldY,
  scale: this.decorationBrush.scale,
  animated: this.decorationBrush.animated,
  animation: this.decorationBrush.animation,
};
```

(Read the file first with `sed -n '690,720p' client/src/editor/game/scenes/EditorScene.ts` to copy the exact id generation pattern — don't guess.)

- [ ] **Step 2: Also play the animation on the editor preview sprite**

Inside the same file's decoration rendering loop (around line 316-324, where it does `this.add.image(d.x, d.y, d.textureKey, d.frame ?? 0)`), change to mirror `MapConfigRenderer`:

```ts
const needsSprite = d.frame !== undefined || d.animated === true;
const obj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image = needsSprite
  ? this.add.sprite(d.x, d.y, d.textureKey, d.frame ?? 0)
  : this.add.image(d.x, d.y, d.textureKey, d.frame ?? 0);
obj.setScale(d.scale);
if (d.animated === true && obj instanceof Phaser.GameObjects.Sprite) {
  const animKey = `${d.textureKey}:${d.animation ?? 'idle'}`;
  if (this.anims.exists(animKey)) obj.play(animKey);
}
obj.setData('decorationId', d.id);
this.decorationContainer.add(obj);
this.decorationSprites.set(d.id, obj);
```

(The type of `decorationSprites` map may need widening from `Map<string, Phaser.GameObjects.Image>` to `Map<string, Phaser.GameObjects.Sprite | Phaser.GameObjects.Image>` — adjust line 111 if TS complains.)

- [ ] **Step 3: Verify TS compiles**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/client && bun tsc --noEmit
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add client/src/editor/game/scenes/EditorScene.ts
git commit -m "feat(editor): persist animated flag + play anim on preview sprite

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `TileTree` sidebar component

**Files:**
- Create: `client/src/editor/panels/TileTree.tsx`

- [ ] **Step 1: Implement the component**

```tsx
import { useMemo, useState } from 'react';
import type { DecorationManifest } from '../types/map';

interface TreeNode {
  name: string;
  fullKey: string;            // joined folderPath up to here
  children: Map<string, TreeNode>;
  assetCount: number;         // count of leaf assets in this subtree
}

interface Props {
  decorations: DecorationManifest[];
  selected: string;           // folderPath.join('/') of currently selected folder
  onSelect(folderKey: string): void;
}

export function TileTree({ decorations, selected, onSelect }: Props) {
  const root = useMemo(() => buildTree(decorations), [decorations]);
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded());

  const toggle = (key: string): void => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key); else next.add(key);
    setExpanded(next);
    saveExpanded(next);
  };

  return (
    <div className="tile-tree">
      {Array.from(root.children.values()).map((child) => (
        <TreeRow
          key={child.fullKey}
          node={child}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle(key: string): void;
  selected: string;
  onSelect(key: string): void;
}

function TreeRow({ node, depth, expanded, onToggle, selected, onSelect }: RowProps) {
  const hasChildren = node.children.size > 0;
  const isExpanded = expanded.has(node.fullKey);
  const isSelected = selected === node.fullKey;
  const pad = depth * 12 + 4;
  return (
    <>
      <button
        type="button"
        className={`tile-tree-row${isSelected ? ' is-selected' : ''}`}
        style={{ paddingLeft: pad }}
        onClick={(e) => {
          if (hasChildren && (e.detail === 2 || (e.target as HTMLElement).dataset.role === 'chevron')) {
            onToggle(node.fullKey);
          } else {
            onSelect(node.fullKey);
            if (hasChildren && !isExpanded) onToggle(node.fullKey);
          }
        }}
      >
        {hasChildren && (
          <span data-role="chevron" className="tile-tree-chevron">
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
        <span className="tile-tree-name">{node.name}</span>
        <span className="tile-tree-count">{node.assetCount}</span>
      </button>
      {hasChildren && isExpanded && Array.from(node.children.values()).map((child) => (
        <TreeRow
          key={child.fullKey}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function buildTree(decorations: DecorationManifest[]): TreeNode {
  const root: TreeNode = { name: '', fullKey: '', children: new Map(), assetCount: 0 };
  for (const d of decorations) {
    let cursor = root;
    const segs = d.folderPath ?? [];
    if (segs.length === 0) continue; // ungrouped v2 entries stay flat at root (handled by caller)
    for (let i = 0; i < segs.length; i++) {
      const name = segs[i];
      const fullKey = segs.slice(0, i + 1).join('/');
      let next = cursor.children.get(name);
      if (next === undefined) {
        next = { name, fullKey, children: new Map(), assetCount: 0 };
        cursor.children.set(name, next);
      }
      cursor = next;
    }
  }
  // Populate assetCount by second pass so that each folder's count includes leaves down the tree.
  const countsByKey = new Map<string, number>();
  for (const d of decorations) {
    for (let i = 1; i <= d.folderPath.length; i++) {
      const key = d.folderPath.slice(0, i).join('/');
      countsByKey.set(key, (countsByKey.get(key) ?? 0) + 1);
    }
  }
  const visit = (node: TreeNode): void => {
    node.assetCount = countsByKey.get(node.fullKey) ?? 0;
    node.children.forEach(visit);
  };
  root.children.forEach(visit);
  return root;
}

const LS_KEY = 'cc0.tree.expanded';
function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw !== null) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}
function saveExpanded(set: Set<string>): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(Array.from(set))); } catch { /* ignore */ }
}
```

- [ ] **Step 2: Add styling to `client/src/editor/editor.css`**

Append:

```css
.tile-tree {
  width: 200px;
  overflow-y: auto;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
}
.tile-tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  background: transparent;
  color: #d8dee9;
  border: none;
  padding: 3px 6px;
  cursor: pointer;
  text-align: left;
}
.tile-tree-row:hover { background: rgba(255,255,255,0.05); }
.tile-tree-row.is-selected { background: rgba(97, 175, 239, 0.18); color: #fff; }
.tile-tree-chevron { width: 10px; color: #888; }
.tile-tree-name { flex: 1; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.tile-tree-count { color: #667; font-size: 10px; }
```

- [ ] **Step 3: Verify TS compiles**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/client && bun tsc --noEmit
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add client/src/editor/panels/TileTree.tsx client/src/editor/editor.css
git commit -m "feat(editor): TileTree sidebar component + styles

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: `DecorationDetail` panel — Animate toggle

**Files:**
- Create: `client/src/editor/panels/DecorationDetail.tsx`

- [ ] **Step 1: Implement the panel**

```tsx
import { editorStore, useEditorStore } from '../state/editor-store';
import type { DecorationManifest } from '../types/map';

interface Props {
  decoration: DecorationManifest;
}

export function DecorationDetail({ decoration }: Props) {
  const brush = useEditorStore((s) => s.decorationBrush);
  const animated = brush?.animated ?? false;
  const chosen = brush?.animation ?? decoration.animations?.[0]?.name ?? 'idle';

  if (decoration.animations === undefined || decoration.animations.length === 0) return null;

  const updateBrush = (patch: Partial<NonNullable<typeof brush>>): void => {
    if (brush === null) return;
    editorStore.setDecorationBrush({ ...brush, ...patch });
  };

  return (
    <div className="decoration-detail">
      <label className="decoration-detail-row">
        <input
          type="checkbox"
          checked={animated}
          onChange={(e) => updateBrush({ animated: e.target.checked })}
        />
        <span>Animate on place</span>
      </label>
      {animated && (
        <label className="decoration-detail-row">
          <span>Animation</span>
          <select
            value={chosen}
            onChange={(e) => updateBrush({ animation: e.target.value })}
          >
            {decoration.animations.map((a) => (
              <option key={a.name} value={a.name}>{a.name}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add minimal CSS**

Append to `client/src/editor/editor.css`:

```css
.decoration-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid rgba(255,255,255,0.08);
  font-size: 12px;
}
.decoration-detail-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.decoration-detail-row select {
  flex: 1;
  background: #222;
  color: #ddd;
  border: 1px solid #333;
  padding: 2px 4px;
}
```

- [ ] **Step 3: Verify TS compiles**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/client && bun tsc --noEmit
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add client/src/editor/panels/DecorationDetail.tsx client/src/editor/editor.css
git commit -m "feat(editor): DecorationDetail panel with Animate toggle

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Refactor `TilePalette` to use `TileTree` + thumbnail grid

This is the biggest UI change: swap the tab-bar grouping (the `listDecorationGroups()` loop) for a two-pane layout.

**Files:**
- Modify: `client/src/editor/panels/TilePalette.tsx`

- [ ] **Step 1: Read current file to understand existing sub-components**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
sed -n '1,60p' client/src/editor/panels/TilePalette.tsx
```

Note the exports of `DecoFrames` (lines ~179-241) — keep that helper; it renders multi-frame thumbnails.

- [ ] **Step 2: Replace the decorations section with tree + grid**

Inside `TilePalette.tsx`:

1. Import `TileTree` and `DecorationDetail`:
   ```ts
   import { TileTree } from './TileTree';
   import { DecorationDetail } from './DecorationDetail';
   ```
2. Remove the `listDecorationGroups()` helper (lines ~11-20) and any `decorationGroup` tab-bar rendering.
3. Replace the decorations rendering block with:
   ```tsx
   {tool === 'decoration' && manifest !== null && (
     <div className="palette-decorations-layout">
       <TileTree
         decorations={manifest.decorations}
         selected={decorationGroup}
         onSelect={(key) => editorStore.setDecorationGroup(key)}
       />
       <div className="palette-decorations-grid">
         {manifest.decorations
           .filter((d) => (d.folderPath ?? []).join('/') === decorationGroup)
           .map((d) => (
             <DecoButton key={d.key} deco={d} onClick={() => onDecoClick(d)} />
           ))}
         {decorationGroup === '' && (
           <p className="palette-hint">Select a folder on the left to see assets.</p>
         )}
       </div>
     </div>
   )}
   ```
4. `DecoButton` is a small inline component that renders a thumbnail (reuse existing `<img>` / `<DecoFrames>` logic from the old palette). Put it as a function at the bottom of the file.
5. Below the grid — after the existing `ScaleSlider` block — render `<DecorationDetail>` when a brush is active:
   ```tsx
   {decorationBrush !== null && selectedDecoration !== undefined && (
     <DecorationDetail decoration={selectedDecoration} />
   )}
   ```
   Where `selectedDecoration = manifest?.decorations.find(d => d.key === decorationBrush.key)`.

6. `onDecoClick(d)` must now initialize `animated: false`:
   ```ts
   editorStore.setDecorationBrush({
     key: d.key,
     scale: d.defaultScale,
     frame: d.frameWidth !== undefined ? 0 : undefined,
     animated: false,
     animation: d.animations?.[0]?.name ?? 'idle',
   });
   ```

- [ ] **Step 3: Add CSS for the two-pane layout**

Append to `client/src/editor/editor.css`:

```css
.palette-decorations-layout {
  display: flex;
  height: 100%;
  min-height: 300px;
}
.palette-decorations-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 6px;
  overflow-y: auto;
  align-content: start;
}
.palette-hint {
  grid-column: 1 / -1;
  color: #8b92a5;
  font-style: italic;
  padding: 12px;
}
```

- [ ] **Step 4: Verify TS compiles**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/client && bun tsc --noEmit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add client/src/editor/panels/TilePalette.tsx client/src/editor/editor.css
git commit -m "refactor(editor): swap palette tab-bar for TileTree + grid

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Full-stack integration smoke — server compiles + tests pass

**Files:** none — verification only.

- [ ] **Step 1: Full server test run**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/server && bun test
```
Expected: all green (png-dimensions, theme-scanner, cc0-pack-metadata, asset-manifest-cc0 smoke, plus whatever existed before).

- [ ] **Step 2: Server tsc**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/server && bun tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Client tsc**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/client && bun tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Client production build**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest/client && bun run build
```
Expected: build succeeds.

- [ ] **Step 5: No commit** — if all green, proceed to manual verification in Task 15. If any step fails, fix the cause (do NOT suppress errors) and re-run.

---

## Task 15: Manual UI verification

**Files:** none — smoke-test the browser UI end-to-end.

- [ ] **Step 1: Start the dev stack**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest && bun start
```
Expected: server on `localhost:4444`, client on `localhost:4445`, both without errors.

- [ ] **Step 2: Open the map editor**

Navigate to `http://localhost:4445/?mode=editor`. Verify:
- Theme selector shows CC0 as default (it already does before this change — should stay that way).
- Left palette now shows a **tree** (Deco, Effects, Factions, Resources — NOT UI/Terrain).
- Clicking "Deco" selects it; the right grid shows **18** thumbnails (01.png–18.png).
- Clicking "Factions" expands; then "Knights" → "Troops" → "Archer" → "Blue" reveals Archer spritesheet preview(s).
- Clicking a troop thumbnail activates the brush; the scale slider appears; the **Animate toggle** + animation dropdown appear below.
- Placing a troop with Animate OFF shows a static frame-0 sprite.
- Toggling Animate ON + selecting "walk" + placing another troop shows a looping walk animation.

- [ ] **Step 3: Save + reload**

Hit Save (Cmd-S or the toolbar button). Reload the page. Verify:
- Animated troops still animate after reload.
- Static troops remain static.
- Counts in the layer panel match what was placed.

- [ ] **Step 4: Regression check — Tiny Swords v2 still works**

Switch the theme selector to `tiny-swords` (v2). Verify:
- The palette switches layout back to tab-bar style (the default theme still uses the old `group` tabs) — **or** if the tree works for it too, the existing tabs still resolve to sensible folder groupings. If v2 looks broken in the tree layout, gate the new layout on `theme === 'tiny-swords-cc0'`:
  ```tsx
  const useTree = manifest.decorations.some((d) => d.folderPath !== undefined && d.folderPath.length > 0);
  ```
  (v2 `DecorationManifest` entries constructed by the hand-curated builder currently have no `folderPath`; setting `folderPath: []` in those entries keeps the tree code safe, and the fallback selector can show v2 in a single "All" folder.)

- [ ] **Step 5: Document any regression findings + address**

If a regression appears, create a follow-up commit that fixes it minimally. Prefer narrowing the scope of v2 manifest: quickly add `folderPath: [d.group.split('/')[0] ?? 'Decorations']` to each v2 entry so the tree still renders something sensible.

- [ ] **Step 6: Final commit (only if follow-up fixes were needed)**

```bash
cd /Users/Fulvio/Documents/AppDev/claude-quest
git add -A && git status
# review, then:
git commit -m "fix(editor): keep theme working with tree layout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Stop the dev stack**

`Ctrl-C` in the terminal running `bun start`.

- [ ] **Step 8: Report status to the user**

Do NOT merge. Leave the branch `feat/cc0-folder-driven-palette` for user review. Summarize: commits made, test pass counts, UI verified behaviours, any known limitations (e.g. frame layouts that looked off and need adjustment).

---

## Self-Review Checklist (for the plan author, before handing off)

1. **Spec coverage** — every spec section has a task:
   - Architecture/theme-scanner → Task 3 ✓
   - cc0-pack-metadata → Task 5 ✓
   - asset-manifest-cc0 refactor → Task 6 ✓
   - Shared types → Task 1, Task 7 ✓
   - TileTree → Task 11 ✓
   - TilePalette refactor → Task 13 ✓
   - DecorationDetail → Task 12 ✓
   - Phaser animation registration → Task 8 ✓
   - MapConfigRenderer play() → Task 9 ✓
   - Placement persists animated → Task 10 ✓
   - Testing → Tasks 2, 3, 5, 6 ✓
   - Manual verification → Task 15 ✓
2. **Placeholder scan** — no TODO / TBD / "implement later" left.
3. **Type consistency** — `DecorationManifest` fields referenced in metadata, manifest, loader, renderer all match (`key`, `label`, `path`, `folderPath`, `frameWidth`, `frameHeight`, `animations`, `defaultScale`). Brush payload extended in Task 7 matches usage in Tasks 12, 13. `DecorationInstance.animated` extended in Task 1 matches usage in Tasks 9, 10.
4. **Ambiguity** — `keyOverride` mechanism for legacy-compat keys is documented. Frame-layout table in Task 4 lists assumed conventions; Task 15 covers verification + adjustment if wrong.

Plan is ready to execute.
