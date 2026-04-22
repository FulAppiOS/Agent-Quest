# CC0 Folder-Driven Palette — Design Spec

**Date:** 2026-04-18
**Branch:** `feat/cc0-folder-driven-palette`
**Status:** Approved for implementation

## Goal

Replace the hand-curated CC0 asset manifest (~26 exposed decorations) with a folder-driven system that surfaces every PNG under `client/public/assets/themes/tiny-swords-cc0/` in the Map Editor palette, while keeping animated spritesheets inert by default and giving the user a hierarchical tree to navigate ~200 assets.

Non-goal for this iteration: touching the Terrain painter or the map JSON schema in a breaking way.

## User-facing outcome

- Map Editor at `/?mode=editor` shows a **tree sidebar** mirroring the `tiny-swords-cc0/` folder structure (Deco, Effects, Factions/Knights/Buildings/Castle, Factions/Goblins/Troops/Barrel/Blue, Resources, UI…). Clicking a leaf folder renders thumbnails of its PNGs on the right.
- Dropping a PNG file into any sub-folder of the CC0 theme makes it appear in the palette on next server start — zero code change for static assets.
- Spritesheets (troops, FX, animated resources) render as **static frame 0** by default. A brush-level `Animate` checkbox + animation dropdown enables looping playback when the sprite is placed.
- Terrain painter unchanged. Tilemap_Flat / Tilemap_Elevation stay explicitly declared.

## Architecture

### Server

```
server/src/map/
├─ theme-scanner.ts          [NEW]  fs recursive walk → typed tree
├─ cc0-pack-metadata.ts      [NEW]  declarative overrides (spritesheet dims, anims)
└─ asset-manifest-cc0.ts     [REFACTOR] terrain stays explicit; decorations via scanner
```

**`theme-scanner.ts`** — pure function, no state, no cache:

```ts
export interface ScannedAsset {
  absPath: string;        // /Users/.../themes/tiny-swords-cc0/Deco/01.png
  webPath: string;        // /assets/themes/tiny-swords-cc0/Deco/01.png
  relPath: string;        // Deco/01.png
  folderPath: string[];   // ["Deco"]
  fileName: string;       // "01.png"
  fileStem: string;       // "01"
  imageSize: { width: number; height: number };
}

export function scanTheme(
  themeRootAbs: string,
  themeWebRoot: string,
  opts: { excludeDirs?: string[]; excludeFiles?: RegExp[] }
): ScannedAsset[];
```

Uses `fs.readdir(..., { recursive: true })` + `image-size` (already behaves via Phaser? We'll add the npm package `image-size` to `server/`). Filters only `.png`.

Default exclusions for CC0: `Terrain/` (handled separately), any file matching `/\.aseprite$/`, `.DS_Store`.

**`cc0-pack-metadata.ts`** — declarative config, ordered list of rules:

```ts
export interface PackMetaRule {
  match: string; // micromatch glob, relative to theme root
  spritesheet?: { frameWidth: number; frameHeight: number };
  animations?: AnimSpec[];
  defaultScale?: number;
  category?: DecorationManifest['category'];
  groupOverride?: (asset: ScannedAsset) => string;
  labelOverride?: (asset: ScannedAsset) => string;
  exclude?: boolean;
}

export interface AnimSpec {
  name: string;       // "idle" | "walk" | "attack" | ...
  start: number;
  end: number;
  frameRate?: number; // default 10
  repeat?: number;    // default -1 (loop)
}

export const CC0_PACK_RULES: PackMetaRule[];
```

First matching rule wins. Fallback when no rule matches: single-image static sprite, `defaultScale` `0.55`, `category` inferred from `folderPath[0]` (Deco → `prop`, Resources → `prop`, Factions → `house` for Buildings or `prop` for Troops, Effects → `effect`, UI → `prop`).

Rule set ships with entries for:
- `Factions/Knights/Troops/+(Archer|Pawn|Warrior)/+(Blue|Purple|Red|Yellow)/*.png` → spritesheet with `idle` + `walk` + `attack` anims
- `Factions/Goblins/Troops/+(Barrel|TNT|Torch)/+(Blue|Purple|Red|Yellow)/*.png` → spritesheet
- `Factions/Goblins/Troops/TNT/Dynamite/*.png` → spritesheet FX
- `Factions/*/Buildings/**/*.png` → static image, `defaultScale: 0.6`, `category: 'house'`
- `Effects/+(Explosion|Fire)/*.png` → spritesheet, `category: 'effect'`
- `Resources/Trees/Tree.png` → spritesheet 192×192
- `Resources/Sheep/*.png`, `Resources/Gold Mine/*.png`, `Resources/Resources/Resources.png` → spritesheet
- `UI/**/*.png` → static, `defaultScale: 0.5`, excluded from palette if `exclude: true` for any we decide aren't placeable (e.g., cursors)

Exact frame dimensions are measured during implementation by reading PNG size: 192×192 is the standard for Tiny Swords unit frames; tilesets are 64×64.

**`asset-manifest-cc0.ts` refactor:**

```ts
export function buildAssetManifestCc0(): AssetManifest {
  return {
    tilesets: buildCc0Tilesets(),             // unchanged: Flat + Elevation
    decorations: buildCc0DecorationsFromScan(),
    protectedBuildings: [],                    // unchanged
    npcSprites: buildCc0NpcSprites(),          // unchanged
  };
}

function buildCc0DecorationsFromScan(): DecorationManifest[] {
  const assets = scanTheme(CC0_ROOT_ABS, CC0_ROOT_WEB, {
    excludeDirs: ['Terrain'],
    excludeFiles: [/\.aseprite$/, /^\.DS_Store$/],
  });
  return assets
    .map(asset => applyRules(asset, CC0_PACK_RULES))
    .filter((entry): entry is DecorationManifest => entry !== null);
}
```

### Shared types

Extend `DecorationManifest` (`server/src/map/types.ts` + mirror in `client/src/editor/types/map.ts`):

```ts
export interface DecorationManifest {
  key: string;
  label: string;
  path: string;
  category: 'tree' | 'bush' | 'rock' | 'stump' | 'cloud' | 'house' | 'prop' | 'water-rock' | 'water' | 'effect';
  group: string;                    // legacy; now set to folderPath.join('/')
  folderPath: string[];             // NEW: ["Factions","Knights","Buildings","Castle"]
  frameWidth?: number;
  frameHeight?: number;
  frameCount?: number;              // NEW: derived from sheet dims
  animations?: AnimSpec[];          // NEW
  defaultScale: number;
}
```

Extend `DecorationInstance`:

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
  animated?: boolean;               // NEW, optional, default false
  animation?: string;               // NEW, optional, default "idle" if animated
}
```

Both new fields are optional → existing saved maps stay valid.

### Client

```
client/src/editor/panels/
├─ TileTree.tsx              [NEW]  sidebar tree, expand state in localStorage
├─ TilePalette.tsx           [REFACTOR] swap tab bar → tree + thumbnail grid
└─ DecorationDetail.tsx      [NEW]  minimal panel for brush-level animate toggle
```

**`TileTree.tsx`** — builds a tree from `manifest.decorations[].folderPath`:

```tsx
interface TreeNode {
  name: string;
  fullPath: string[];
  children: Map<string, TreeNode>;
  assets: DecorationManifest[];   // leaf assets directly in this folder
}

function TileTree({ decorations, selectedFolder, onSelectFolder }) {
  const tree = useMemo(() => buildTree(decorations), [decorations]);
  const [expanded, setExpanded] = useLocalStorage('cc0.tree.expanded', new Set<string>());
  // recursive render with ▶ / ▼ affordances, click folder → onSelectFolder
}
```

Sidebar width: `200px` fixed. Indent per level: `12px`. Empty folders hidden. Search input on top — filters by label case-insensitive; while searching, auto-expand matching branches.

**`TilePalette.tsx` refactor:**

- Replace current tab bar (lines 138–158 area) with two-pane layout: `<TileTree>` on left, thumbnail grid on right.
- Thumbnail grid renders only decorations whose `folderPath.join('/') === selectedFolder.join('/')`.
- Keep single-image `<img src={d.path}>` rendering; for spritesheets (when `frameWidth`/`frameHeight` set), reuse the existing `DecoFrames` CSS-clip approach to show frame 0 as thumbnail.
- Scale slider stays on selected brush (existing behaviour).

**`DecorationDetail.tsx`** (new, minimal — panel appears below scale slider when `decorationBrush !== null`):

```
┌──────────────────────┐
│ Brush: knights-archer-blue │
│ Scale: [━━━●━━━] 0.55  │
│ [ ] Animate           │   ← only when animations.length > 0
│ Animation: [idle ▼]   │   ← only when Animate checked
└──────────────────────┘
```

Writes to `editorStore.decorationBrush` → `{ key, scale, animated, animation }`. Placement reads these and writes them into the `DecorationInstance`.

Post-placement editing of Animate on an already-placed sprite is **out of scope** for this iteration; added later if needed.

### Phaser rendering

**`client/src/game/data/asset-loader.ts`** — unchanged logic (already handles `load.spritesheet` vs `load.image` based on `frameWidth`/`frameHeight`). Need to additionally **register Phaser animations** once per scene when a decoration has `animations` defined:

```ts
for (const deco of manifest.decorations) {
  if (!deco.animations) continue;
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
```

Runs after preload completes, before the map is rendered.

**`client/src/game/terrain/MapConfigRenderer.ts` update** (lines 79–85):

```ts
for (const d of map.decorations) {
  if (!scene.textures.exists(d.textureKey)) continue;
  const sprite = d.frame !== undefined || d.animated
    ? scene.add.sprite(d.x, d.y, d.textureKey, d.frame ?? 0)
    : scene.add.image(d.x, d.y, d.textureKey);
  sprite.setScale(d.scale);
  if (d.tint !== undefined) sprite.setTint(d.tint);
  if (d.animated && 'play' in sprite) {
    const animKey = `${d.textureKey}:${d.animation ?? 'idle'}`;
    if (scene.anims.exists(animKey)) sprite.play(animKey);
  }
  const footY = d.y + sprite.displayHeight * 0.5;
  sprite.setDepth(d.depth ?? footY);
}
```

## Data flow

1. Server start → `buildAssetManifestCc0()` on request.
2. `scanTheme` walks `client/public/assets/themes/tiny-swords-cc0/` (excluding `Terrain/`, `.aseprite`, `.DS_Store`).
3. `applyRules` maps each `ScannedAsset` → `DecorationManifest` with metadata overrides.
4. Client fetches `/api/assets/manifest?theme=tiny-swords-cc0`.
5. `asset-loader` registers textures (`load.image` or `load.spritesheet`) + animations.
6. `TilePalette` + `TileTree` render the manifest; user interacts.
7. Placed decoration persisted to `server/data/maps/*.json` with optional `animated` / `animation`.
8. On load, `MapConfigRenderer` instantiates sprites, plays animation when `animated: true`.

## Testing

Per TDD discipline:

- **`theme-scanner.test.ts`** — fixtures folder with a toy theme structure; assert output shape, exclusion of `Terrain`/`.aseprite`/`.DS_Store`, correct `folderPath` + `relPath`.
- **`cc0-pack-metadata.test.ts`** — given a `ScannedAsset`, `applyRules` returns the expected `DecorationManifest` (spritesheet dims, animations, category). Cover: rule matches, fallback when no rule, exclude rule drops entry.
- **`asset-manifest-cc0.test.ts`** — smoke test: calling `buildAssetManifestCc0()` against the real asset folder returns at least N decorations across each expected top-level folder.
- **Type tests** — compile-time check that extended `DecorationManifest` and `DecorationInstance` are backward compatible (existing map JSON still parses).

Client-side UI verification is manual: start dev server, open `/?mode=editor`, confirm tree renders, expand a few folders, place an animated troop with Animate on/off, save + reload map, confirm animation state persists.

## Rollout

Single branch `feat/cc0-folder-driven-palette`. No migrations. Existing saved maps keep working because:
- `folderPath` on `DecorationManifest` is server-derived; client re-reads it from the manifest on load.
- `animated`/`animation` on `DecorationInstance` are optional, default undefined → static rendering path.

Does *not* affect `tiny-swords` v2 (`buildAssetManifestDefault()` untouched).

## Risks & mitigations

- **Wrong frame dimensions in metadata** — a spritesheet mis-measured renders garbled frames. Mitigation: during implementation, log + fail the build for any `animations.end >= frameCount`; visually verify the 4–5 unit archetypes.
- **Performance** — ~200 textures would bloat initial load if preloaded eagerly. Mitigation: preload only decorations referenced by the current map; palette thumbnails use plain `<img>` (browser cache), not Phaser textures.
- **Filesystem case-sensitivity** — production runs on macOS/Linux; we normalize folder names as-disk (keep original casing, no lowercasing).
- **`image-size` dependency** — add to `server/package.json`. Alternative: read PNG IHDR chunk manually (~10 lines) to avoid a dep. Decision in plan phase.

## Out of scope

- Post-placement Animate toggle on already-placed sprites (phase 2).
- Per-sprite animation speed slider.
- Auto-categorizing `Factions/*/Troops` visually by faction colour in the palette.
- Extending the folder-driven approach to `tiny-swords` v2.
- UI polish of the tree (icons, animations).
