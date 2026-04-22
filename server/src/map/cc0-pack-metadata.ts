import type { ScannedAsset } from './theme-scanner';
import type { AnimSpec, DecorationManifest } from './types';

/**
 * A declarative rule mapping scanned PNGs to `DecorationManifest` metadata.
 * Rules are matched in array order; the first `match` that hits wins.
 * Assets with no matching rule fall through to the defaults inside
 * `applyRules`.
 */
export interface PackMetaRule {
  /** Micro-glob against `relPath`. Supported: `*` (no `/`), `**` (any depth),
   * `+(a|b|c)` (alternation). */
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

export const CC0_PACK_RULES: PackMetaRule[] = [
  // UI — not placeable on the map
  { match: 'UI/**', exclude: true },
  // Water.png is surfaced as a terrain tileset (buildTilesets), not a decoration.
  { match: 'Terrain/Water/Water.png', exclude: true },

  // --- Knights troops ---------------------------------------------------
  // Archer: 8 cols × 7 rows (56 frames). row 0 idle, row 1 walk, row 2 attack, row 3 hurt, row 4 death.
  {
    match: 'Factions/Knights/Troops/Archer/+(Blue|Purple|Red|Yellow)/*.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: [
      { name: 'idle',   start: 0,  end: 7,  frameRate: 8,  repeat: -1 },
      { name: 'walk',   start: 8,  end: 15, frameRate: 10, repeat: -1 },
      { name: 'attack', start: 16, end: 23, frameRate: 12, repeat: -1 },
      { name: 'hurt',   start: 24, end: 31, frameRate: 10, repeat: 0  },
      { name: 'death',  start: 32, end: 39, frameRate: 8,  repeat: 0  },
    ],
    defaultScale: 0.5,
    category: 'prop',
  },
  // Archer + Bow preview sheets — 192×192 frames, allow frame picking only (dimensions vary between files)
  {
    match: 'Factions/Knights/Troops/Archer/Archer + Bow/*.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    defaultScale: 0.5,
    category: 'prop',
  },
  // Arrow projectile — static
  {
    match: 'Factions/Knights/Troops/Archer/Arrow/*.png',
    defaultScale: 0.5,
    category: 'prop',
  },
  // Dead sprite — static (single-frame variant)
  {
    match: 'Factions/Knights/Troops/Dead/Dead.png',
    defaultScale: 0.5,
    category: 'prop',
  },
  // Pawn: 6 cols × 6 rows (36 frames). idle, walk, attack, hurt, chop, build.
  {
    match: 'Factions/Knights/Troops/Pawn/+(Blue|Purple|Red|Yellow)/*.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: [
      { name: 'idle',   start: 0,  end: 5,  frameRate: 8,  repeat: -1 },
      { name: 'walk',   start: 6,  end: 11, frameRate: 10, repeat: -1 },
      { name: 'attack', start: 12, end: 17, frameRate: 12, repeat: -1 },
      { name: 'hurt',   start: 18, end: 23, frameRate: 10, repeat: 0  },
      { name: 'chop',   start: 24, end: 29, frameRate: 10, repeat: -1 },
      { name: 'build',  start: 30, end: 35, frameRate: 10, repeat: -1 },
    ],
    defaultScale: 0.5,
    category: 'prop',
  },
  // Warrior: 6 cols × 8 rows (48 frames).
  {
    match: 'Factions/Knights/Troops/Warrior/+(Blue|Purple|Red|Yellow)/*.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: [
      { name: 'idle',   start: 0,  end: 5,  frameRate: 8,  repeat: -1 },
      { name: 'walk',   start: 6,  end: 11, frameRate: 10, repeat: -1 },
      { name: 'attack', start: 12, end: 17, frameRate: 12, repeat: -1 },
      { name: 'hurt',   start: 18, end: 23, frameRate: 10, repeat: 0  },
      { name: 'death',  start: 24, end: 29, frameRate: 10, repeat: 0  },
    ],
    defaultScale: 0.5,
    category: 'prop',
  },
  // Knights Buildings — static
  {
    match: 'Factions/Knights/Buildings/+(Castle|House|Tower)/*.png',
    defaultScale: 0.6,
    category: 'house',
  },

  // --- Goblins ----------------------------------------------------------
  // Barrel decoration: intentionally no explicit rule. The barrel PNGs
  // are still discovered by the folder scanner and rendered as static
  // decorations via the generic fallback — they were never flickering in
  // decoration use, and barrel is no longer an NPC unit so it has no
  // animation spec to maintain.
  //
  // TNT: 7 cols × 3 rows (21 frames). Per Tiny Swords convention only
  // cols 0-5 of each row are populated; col 6 is padding, so we cap each
  // animation at `end = start + 5` to avoid a blank frame per cycle.
  {
    match: 'Factions/Goblins/Troops/TNT/+(Blue|Purple|Red|Yellow)/*.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: [
      { name: 'idle',   start: 0,  end: 5,  frameRate: 8,  repeat: -1 },
      { name: 'walk',   start: 7,  end: 12, frameRate: 10, repeat: -1 },
      { name: 'attack', start: 14, end: 19, frameRate: 12, repeat: -1 },
    ],
    defaultScale: 0.5,
    category: 'prop',
  },
  // TNT Dynamite: 6 cols × 1 row @ 64×64
  {
    match: 'Factions/Goblins/Troops/TNT/Dynamite/Dynamite.png',
    spritesheet: { frameWidth: 64, frameHeight: 64 },
    animations: [{ name: 'play', start: 0, end: 5, frameRate: 12, repeat: -1 }],
    defaultScale: 0.4,
    category: 'effect',
  },
  // Torch: 7 cols × 5 rows (35 frames). Same padding caveat as TNT.
  {
    match: 'Factions/Goblins/Troops/Torch/+(Blue|Purple|Red|Yellow)/*.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: [
      { name: 'idle',   start: 0,  end: 5,  frameRate: 8,  repeat: -1 },
      { name: 'walk',   start: 7,  end: 12, frameRate: 10, repeat: -1 },
      { name: 'attack', start: 14, end: 19, frameRate: 12, repeat: -1 },
      { name: 'hurt',   start: 21, end: 26, frameRate: 10, repeat: 0  },
      { name: 'death',  start: 28, end: 33, frameRate: 10, repeat: 0  },
    ],
    defaultScale: 0.5,
    category: 'prop',
  },
  // Goblins Buildings — static
  {
    match: 'Factions/Goblins/Buildings/+(Wood_House|Wood_Tower)/*.png',
    defaultScale: 0.6,
    category: 'house',
  },

  // --- Effects ----------------------------------------------------------
  // Explosion: 9 cols × 1 row. Single-shot.
  {
    match: 'Effects/Explosion/Explosions.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: [{ name: 'play', start: 0, end: 8, frameRate: 16, repeat: 0 }],
    defaultScale: 0.5,
    category: 'effect',
  },
  // Fire: 7 cols × 1 row @ 128×128. Looping.
  {
    match: 'Effects/Fire/Fire.png',
    spritesheet: { frameWidth: 128, frameHeight: 128 },
    animations: [{ name: 'play', start: 0, end: 6, frameRate: 12, repeat: -1 }],
    defaultScale: 0.5,
    category: 'effect',
  },

  // --- Resources --------------------------------------------------------
  // Tree: 4×3 sheet, 192×192 frames, frame-picker only (no auto-anim).
  {
    match: 'Resources/Trees/Tree.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    defaultScale: 0.85,
    category: 'tree',
  },
  // Sheep idle: 8×1 @ 128×128 loop.
  {
    match: 'Resources/Sheep/HappySheep_Idle.png',
    spritesheet: { frameWidth: 128, frameHeight: 128 },
    animations: [{ name: 'idle', start: 0, end: 7, frameRate: 8, repeat: -1 }],
    defaultScale: 0.5,
    category: 'prop',
  },
  // Sheep bouncing: 6×1 @ 128×128 loop.
  {
    match: 'Resources/Sheep/HappySheep_Bouncing.png',
    spritesheet: { frameWidth: 128, frameHeight: 128 },
    animations: [{ name: 'bounce', start: 0, end: 5, frameRate: 10, repeat: -1 }],
    defaultScale: 0.5,
    category: 'prop',
  },
  // Sheep all: 8×2 @ 128×128. Idle row 0, bounce row 1 (6 frames — the sheet has 8 cols but bouncing occupies 6 of them; use 8-13 window to stay safe).
  {
    match: 'Resources/Sheep/HappySheep_All.png',
    spritesheet: { frameWidth: 128, frameHeight: 128 },
    animations: [
      { name: 'idle',   start: 0, end: 7,  frameRate: 8,  repeat: -1 },
      { name: 'bounce', start: 8, end: 13, frameRate: 10, repeat: -1 },
    ],
    defaultScale: 0.5,
    category: 'prop',
  },
  // Gold Mine — static (single-frame 192×128 state images).
  {
    match: 'Resources/Gold Mine/*.png',
    defaultScale: 0.7,
    category: 'prop',
  },
  // Resources idle icons — static 128×128 single frame.
  {
    match: 'Resources/Resources/+(G|M|W)_Idle*.png',
    defaultScale: 0.5,
    category: 'prop',
  },
  // Resources spawn animations — 7×1 @ 128×128 single-shot.
  {
    match: 'Resources/Resources/+(G|M|W)_Spawn.png',
    spritesheet: { frameWidth: 128, frameHeight: 128 },
    animations: [{ name: 'spawn', start: 0, end: 6, frameRate: 10, repeat: 0 }],
    defaultScale: 0.5,
    category: 'prop',
  },

  // --- Terrain (non-tileset) -------------------------------------------
  // Water tile — single 64×64 static image usable as a decoration.
  {
    match: 'Terrain/Water/Water.png',
    defaultScale: 1.0,
    category: 'water',
  },
  // Foam — 8×1 sheet @ 192×192, looping.
  {
    match: 'Terrain/Water/Foam/Foam.png',
    spritesheet: { frameWidth: 192, frameHeight: 192 },
    animations: [{ name: 'idle', start: 0, end: 7, frameRate: 10, repeat: -1 }],
    defaultScale: 1.0,
    category: 'water',
  },
  // Water rocks — 8×1 sheet @ 128×128 per variant, looping bob.
  {
    match: 'Terrain/Water/Rocks/Rocks_*.png',
    spritesheet: { frameWidth: 128, frameHeight: 128 },
    animations: [{ name: 'idle', start: 0, end: 7, frameRate: 8, repeat: -1 }],
    defaultScale: 1.0,
    category: 'water-rock',
  },
  // Bridge — 3×4 atlas of 64×64 tiles. Frame-picker only (static).
  {
    match: 'Terrain/Bridge/Bridge_All.png',
    spritesheet: { frameWidth: 64, frameHeight: 64 },
    defaultScale: 1.0,
    category: 'prop',
  },

  // Deco: no explicit rule — handled by fallback below.
];

// ---------------------------------------------------------------------------
// Glob → regex (minimal engine for this codebase's patterns)
// ---------------------------------------------------------------------------

function globToRegex(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 2;
      if (glob[i] === '/') i++;
      continue;
    }
    if (c === '*') { re += '[^/]*'; i++; continue; }
    if (c === '+' && glob[i + 1] === '(') {
      const close = glob.indexOf(')', i);
      const group = glob.slice(i + 2, close)
        .split('|')
        .map((x) => x.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      re += `(?:${group})`;
      i = close + 1;
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(c!)) re += '\\' + c;
    else re += c;
    i++;
  }
  return new RegExp(`^${re}$`);
}

const compiled = new WeakMap<PackMetaRule, RegExp>();
function compiledMatch(rule: PackMetaRule): RegExp {
  let r = compiled.get(rule);
  if (r === undefined) { r = globToRegex(rule.match); compiled.set(rule, r); }
  return r;
}

// ---------------------------------------------------------------------------
// Helpers
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

function deriveKey(asset: ScannedAsset): string {
  const parts = [...asset.folderPath, asset.fileStem].map((s) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
  );
  return parts.filter((p) => p.length > 0).join('-');
}

// ---------------------------------------------------------------------------
// Apply rules
// ---------------------------------------------------------------------------

export function applyRules(
  asset: ScannedAsset,
  rules: PackMetaRule[] = CC0_PACK_RULES,
): DecorationManifest | null {
  const matched = rules.find((r) => compiledMatch(r).test(asset.relPath));
  if (matched?.exclude === true) return null;

  const spritesheet = matched?.spritesheet;
  const frameWidth = spritesheet?.frameWidth;
  const frameHeight = spritesheet?.frameHeight;
  let frameCount: number | undefined;
  let sheetColumns: number | undefined;
  if (frameWidth !== undefined && frameHeight !== undefined) {
    const cols = Math.floor(asset.imageSize.width / frameWidth);
    const rows = Math.floor(asset.imageSize.height / frameHeight);
    if (cols > 0 && rows > 0) {
      frameCount = cols * rows;
      sheetColumns = cols;
    }
  }

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
    sheetColumns,
    animations,
    defaultScale,
  };
}
