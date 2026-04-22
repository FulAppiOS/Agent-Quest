import type * as Phaser from 'phaser';
import type { HeroPreview, HeroSpriteConfig, PreloadEntry, StaticAssetEntry, ThemeManifest, UnitColor, UnitType } from './types';

/**
 * Tiny Swords CC0 (Update 010) — bundled redistributable theme.
 *
 * The pack ships one combined PNG per (unit, color) at 192-px frames,
 * laid out as `rows = animation, columns = frame`:
 *   - Warrior (6×8): row 0 idle, row 1 walk, rows 2-4 attack, 5-7 variants
 *   - Pawn    (6×6): row 0 idle, row 1 walk, rows 2-3 work/attack, 4-5 variants
 *   - Archer  (8×7): row 0 idle (cols 0-5), row 1 idle variant, rows 2-6 shoot
 *
 * The archer has NO dedicated walk cycle in this pack — we reuse idle
 * frames for the run animation. Warriors and pawns use row 1 for walk.
 *
 * Fallbacks for missing (unit, color) combos:
 *   Monk  → Warrior (same color)
 *   Black → Purple  (same unit)
 * Combined: (monk, black) → (warrior, purple).
 *
 * Filename quirk: upstream pack ships `Archer/Purple/Archer_Purlple.png`
 * (author typo). Preserved verbatim so future pack updates diff cleanly.
 */

// All CC0 units have dedicated sheets — no aliasing needed.
const resolveUnit = (unit: UnitType): UnitType => unit;

const resolveColor = (color: UnitColor): UnitColor =>
  color === 'black' ? 'purple' : color;

const GOBLIN_UNITS: readonly UnitType[] = ['tnt', 'torch'] as const;
const isGoblin = (u: UnitType): boolean => (GOBLIN_UNITS as readonly UnitType[]).includes(u);

/** Directory (and filename stem) for each goblin unit — note `TNT` is
 * all-caps in the upstream pack, so `cap()` can't derive it. */
const GOBLIN_DIR: Record<'tnt' | 'torch', string> = {
  tnt: 'TNT',
  torch: 'Torch',
};

/** Per-unit sheet shape and animation frame indices (0-based, row-major). */
type UnitSheetSpec = {
  sheetCols: number;
  idleFrames: number;
  runFrames: number;
  idleFrameIndices: number[];
  runFrameIndices: number[];
};

/** Per-unit sheet shape and animation frame indices. */
const SHEET_SPEC: Record<UnitType, UnitSheetSpec> = {
  warrior: {
    sheetCols: 6,
    idleFrames: 6,
    runFrames: 6,
    idleFrameIndices: [0, 1, 2, 3, 4, 5],
    runFrameIndices: [6, 7, 8, 9, 10, 11],
  },
  archer: {
    sheetCols: 8,
    idleFrames: 6,
    // The CC0 archer sheet has row 0 and row 1 as idle variants (same
    // pose, subtle sway) and rows 2-4 as shoot animations with visible
    // arrows — using those for locomotion would make the archer fire
    // while walking. Row 1 at least has subtle frame variation; we reuse
    // it for run so the sprite moves without looking broken. If a later
    // pack revision ships a proper walk cycle, bump runFrameIndices.
    runFrames: 6,
    idleFrameIndices: [0, 1, 2, 3, 4, 5],
    runFrameIndices: [8, 9, 10, 11, 12, 13],
  },
  pawn: {
    sheetCols: 6,
    idleFrames: 6,
    runFrames: 6,
    idleFrameIndices: [0, 1, 2, 3, 4, 5],
    runFrameIndices: [6, 7, 8, 9, 10, 11],
  },
  // Goblins — combined sheets at 192px. tnt and torch sheets are 7 cols
  // × N rows, but per Tiny Swords convention only the first 6 cols of
  // each row are populated (col 6 is padding). Using 7 frames would
  // leave a blank frame per cycle → visible flicker. Use 6.
  tnt: {
    sheetCols: 7,
    idleFrames: 6,
    runFrames: 6,
    idleFrameIndices: [0, 1, 2, 3, 4, 5],
    runFrameIndices: [7, 8, 9, 10, 11, 12],
  },
  torch: {
    sheetCols: 7,
    idleFrames: 6,
    runFrames: 6,
    idleFrameIndices: [0, 1, 2, 3, 4, 5],
    runFrameIndices: [7, 8, 9, 10, 11, 12],
  },
};

const COLORS: UnitColor[] = ['blue', 'yellow', 'red', 'black', 'purple'];
const UNITS: UnitType[] = ['warrior', 'archer', 'pawn', 'tnt', 'torch'];

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

function filePath(color: UnitColor, unit: UnitType): string {
  const ru = resolveUnit(unit);
  const rc = resolveColor(color);
  if (isGoblin(ru)) {
    // Goblins live under Factions/Goblins/Troops — no typo quirks. `TNT`
    // is all-caps in the pack (both directory and filename), so we look
    // the directory name up in GOBLIN_DIR rather than derive via cap().
    const unitDir = GOBLIN_DIR[ru as 'tnt' | 'torch'];
    const colorDir = cap(rc);
    return `assets/themes/tiny-swords-cc0/Factions/Goblins/Troops/${unitDir}/${colorDir}/${unitDir}_${colorDir}.png`;
  }
  const unitCap = cap(ru);
  const colorDirCap = cap(rc);
  // Upstream typo: Archer_Purlple.png (not "Purple"). The *directory* name
  // is still "Purple" though — only the file's suffix is misspelled.
  const fileColorCap = ru === 'archer' && rc === 'purple' ? 'Purlple' : colorDirCap;
  return `assets/themes/tiny-swords-cc0/Factions/Knights/Troops/${unitCap}/${colorDirCap}/${unitCap}_${fileColorCap}.png`;
}

const idleKey = (color: UnitColor, unit: UnitType): string =>
  `cc0-${resolveColor(color)}-${resolveUnit(unit)}-idle`;
const runKey = (color: UnitColor, unit: UnitType): string =>
  `cc0-${resolveColor(color)}-${resolveUnit(unit)}-run`;

export const tinySwordsCc0Theme: ThemeManifest = {
  id: 'tiny-swords-cc0',
  name: 'Tiny Swords (CC0)',
  // Same frame size as the default theme (192 px) → same scale.
  heroScale: 0.55,

  getHeroPreload(): PreloadEntry[] {
    const entries: PreloadEntry[] = [];
    // De-dupe on RESOLVED (color, unit) so fallbacks don't re-register the
    // same texture twice. Each unique sheet still registers under both an
    // idle and a run key because HeroSprite builds anim keys as
    // `${textureKey}-anim` and needs them distinct.
    const seen = new Set<string>();
    for (const color of COLORS) {
      for (const unit of UNITS) {
        const dedupe = `${resolveColor(color)}-${resolveUnit(unit)}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const path = filePath(color, unit);
        entries.push({ key: idleKey(color, unit), path, frameWidth: 192, frameHeight: 192 });
        entries.push({ key: runKey(color, unit),  path, frameWidth: 192, frameHeight: 192 });
      }
    }
    return entries;
  },

  getHeroConfig(color: UnitColor, unit: UnitType): HeroSpriteConfig {
    const spec = SHEET_SPEC[resolveUnit(unit)];
    return {
      idleKey: idleKey(color, unit),
      runKey: runKey(color, unit),
      idleFrames: spec.idleFrames,
      runFrames: spec.runFrames,
      idleFrameIndices: spec.idleFrameIndices,
      runFrameIndices: spec.runFrameIndices,
      facesLeft: false,
      tint: null,
    };
  },

  getHeroPreview(color: UnitColor, unit: UnitType): HeroPreview {
    const spec = SHEET_SPEC[resolveUnit(unit)];
    return {
      url: `/${filePath(color, unit)}`,
      sheetColumns: spec.sheetCols,
      frameWidth: 192,
      frameHeight: 192,
    };
  },

  terrain: {
    tilesetKey: 'terrain-tileset-cc0',
    path: 'assets/themes/tiny-swords-cc0/Terrain/Ground/Tilemap_Flat.png',
    tileSize: 64,
    // 10×4 grid — left half (cols 0-4) is grass, right half (cols 5-9) is
    // sand. Frame 0 is the plain mid-green grass square used as ground fill.
    grassFrame: 0,
  },

  getBuildingImage(id: string): string {
    return CC0_BUILDINGS[id]?.path ?? `assets/buildings/${id}.png`;
  },

  getBuildingScale(id: string): number | undefined {
    return CC0_BUILDINGS[id]?.scale;
  },

  getStaticAssetPreload(): StaticAssetEntry[] {
    const entries: StaticAssetEntry[] = [];
    const DECO = 'assets/themes/tiny-swords-cc0/Deco';
    const RES_TREES = 'assets/themes/tiny-swords-cc0/Resources/Trees';
    const KNIGHTS_BUILD = 'assets/themes/tiny-swords-cc0/Factions/Knights/Buildings';

    // Bush/Rock/Stump: map each slot to a distinct Deco 64×64 prop.
    // Deco/01-15 are 64×64, 16-17 are 64×128 (signposts/pillars — would
    // render as tall sticks when used as stumps), 18 is 192×192. We keep
    // every slot inside the 64×64 range for consistent scale with the
    // TerrainRenderer.placeBushes / placeStumps code.
    const bushDeco = [1, 2, 3, 4];
    const rockDeco = [9, 10, 11, 12];
    const stumpDeco = [5, 6, 7, 8];
    for (let i = 0; i < 4; i++) {
      entries.push({ key: `bush-${i + 1}`, path: `${DECO}/${String(bushDeco[i]).padStart(2, '0')}.png` });
      entries.push({ key: `rock-${i + 1}`, path: `${DECO}/${String(rockDeco[i]).padStart(2, '0')}.png` });
      entries.push({ key: `stump-${i + 1}`, path: `${DECO}/${String(stumpDeco[i]).padStart(2, '0')}.png` });
    }

    // Trees: Tree.png is a 768×576 atlas (4×3 grid of 192-px frames).
    // Load the whole atlas once; postLoadHook slices frames 0-3 into
    // tree-1..4 textures so existing TerrainRenderer callsites keep
    // working unchanged.
    entries.push({
      key: 'cc0-trees-atlas',
      path: `${RES_TREES}/Tree.png`,
      frameWidth: 192,
      frameHeight: 192,
    });

    // Decorative coloured houses — 5 colours × 4 kinds. CC0 has 4 colours;
    // black falls back to purple. Four "kinds" map to House / House
    // Construction / House Destroyed / Tower of the same colour.
    const colorToCc0: Record<string, UnitColor> = {
      blue: 'blue', yellow: 'yellow', red: 'red', purple: 'purple', black: 'purple',
    };
    for (const logical of ['blue', 'yellow', 'red', 'purple', 'black'] as const) {
      const cc0Color = colorToCc0[logical]!;
      const Cc0 = cap(cc0Color);
      entries.push({ key: `house-${logical}-house1`, path: `${KNIGHTS_BUILD}/House/House_${Cc0}.png` });
      entries.push({ key: `house-${logical}-house2`, path: `${KNIGHTS_BUILD}/House/House_Construction.png` });
      entries.push({ key: `house-${logical}-house3`, path: `${KNIGHTS_BUILD}/House/House_Destroyed.png` });
      entries.push({ key: `house-${logical}-tower`,  path: `${KNIGHTS_BUILD}/Tower/Tower_${Cc0}.png` });
    }

    return entries;
  },

  postLoadHook(scene: Phaser.Scene): void {
    // Slice the tree atlas into 4 separate textures named tree-1..4 so
    // TerrainRenderer.drawForestTrees can pick them at random without
    // knowing we sourced them from a single sheet.
    if (!scene.textures.exists('cc0-trees-atlas')) return;
    const source = scene.textures.get('cc0-trees-atlas').getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    for (let i = 1; i <= 4; i++) {
      const key = `tree-${i}`;
      if (scene.textures.exists(key)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = 192;
      canvas.height = 192;
      const ctx = canvas.getContext('2d');
      if (ctx === null) continue;
      // Draw frame (i-1) of the atlas — row 0, column (i-1).
      ctx.drawImage(source, -(i - 1) * 192, 0);
      scene.textures.addCanvas(key, canvas);
    }
  },
};

/**
 * CC0 building mapping. The pack ships only Castle / House / Tower / Goblin
 * House, so we reuse each artwork across multiple activities by varying
 * the color (House_Blue as Library, House_Red as Forge…) and repurposing
 * the Goblin House for the ramshackle Alchemist feel.
 *
 * Scale overrides:
 *   - Castle is 320×256 native, Tower_Blue is 128×256 native; scales
 *     below are chosen against those sizes.
 *   - Tower_Red → arena is rendered at 0.55 (larger than other towers)
 *     because the sprite silhouette is narrower than a purpose-built
 *     arena — the extra size compensates.
 *   - All four Houses (library/forge/tavern/chapel) share a 128×192
 *     native size but get different scales (0.85 / 0.65 / 0.75 / 0.55)
 *     on purpose, to give a visual hierarchy where library is the
 *     biggest and chapel the smallest.
 */
const CUSTOM_BUILDINGS_BASE = 'assets/themes/tiny-swords-cc0/BuildingsCustom';

const CC0_BUILDINGS: Record<string, { path: string; scale: number }> = {
  // User-authored custom builds — detailed silhouettes replace all eight
  // activity buildings. Scales chosen to approximate the previous rendered
  // footprint; tune per-building in the editor Inspector.
  castle:     { path: `${CUSTOM_BUILDINGS_BASE}/Castle.png`,       scale: 0.45 },
  library:    { path: `${CUSTOM_BUILDINGS_BASE}/Library.png`,      scale: 0.40 },
  forge:      { path: `${CUSTOM_BUILDINGS_BASE}/Forge.png`,        scale: 0.40 },
  tavern:     { path: `${CUSTOM_BUILDINGS_BASE}/Tavern.png`,       scale: 0.40 },
  chapel:     { path: `${CUSTOM_BUILDINGS_BASE}/Chapel.png`,       scale: 0.35 },
  watchtower: { path: `${CUSTOM_BUILDINGS_BASE}/Tower.png`,        scale: 0.35 },
  arena:      { path: `${CUSTOM_BUILDINGS_BASE}/Arena.png`,        scale: 0.35 },
  alchemist:  { path: `${CUSTOM_BUILDINGS_BASE}/Alchemist.png`,    scale: 0.35 },
};
