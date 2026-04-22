# Asset Themes

Agent Quest renders heroes from a **theme** — a manifest that tells
Phaser which PNGs to preload and how to animate them. Themes are
data-driven, so swapping in a new pack is a matter of dropping files
into `client/public/assets/themes/<theme-id>/` and registering a manifest.

## Active theme

| Id | Display name | License | Location | Distribution |
|---|---|---|---|---|
| `tiny-swords-cc0` | Tiny Swords (CC0) | CC0 1.0 Universal (Pixel Frog) | `client/public/assets/themes/tiny-swords-cc0/` | **Bundled in the repo** — zero setup for the user. |

The theme is fully self-contained: no external downloads, no setup
scripts. Everything BootScene needs ships in the `tiny-swords-cc0`
subtree.

### CC0 fallbacks

The CC0 pack has fewer variants than Agent Quest's 5×4 hero grid:

| Missing | Falls back to | Encoded in |
|---|---|---|
| Monk (unit) | Warrior of the same color | `resolveUnit(unit)` in `tiny-swords-cc0.ts` |
| Black (color) | Purple of the same unit | `resolveColor(color)` |

Combined: `(monk, black)` resolves to `(warrior, purple)`.
`getHeroPreload()` de-dupes on the resolved pair so the same texture
isn't registered twice.

### Frame layout

Combined sheets (one PNG per `(color, unit)`) with 192-px frames,
rows = animation, columns = frame:

| Unit | Sheet | Grid | Idle indices | Walk indices |
|---|---|---|---|---|
| Warrior | `Warrior_{Color}.png` | 6×8 | `[0..5]` | `[6..11]` |
| Pawn    | `Pawn_{Color}.png`    | 6×6 | `[0..5]` | `[6..11]` |
| Archer  | `Archer_{Color}.png`  | 8×7 | `[0..5]` | `[8..13]` (row 1 — no dedicated walk; rows 2-6 are shoot) |

Upstream filename quirk preserved: `Archer/Purple/Archer_Purlple.png`.

## Manifest interface

Defined in `client/src/game/themes/types.ts`:

```ts
interface ThemeManifest {
  id: ThemeId;
  name: string;
  heroScale: number;
  getHeroPreload(): PreloadEntry[];
  getHeroConfig(color, unit): HeroSpriteConfig;
  getHeroPreview(color, unit): HeroPreview;
  terrain?: TerrainConfig;
  getBuildingImage(id: string): string;
  getBuildingScale?(id: string): number | undefined;
  getStaticAssetPreload(): StaticAssetEntry[];
  postLoadHook?(scene: Phaser.Scene): void;
}
```

## Scale rebase

MapConfig saves `settings.heroScale` and per-NPC `scale` as absolute
numbers authored against a `heroScale: 0.5` baseline. `rebaseSavedScale`
is an identity passthrough today (one theme) but stays in place so
future themes with different native sizes Just Work without migrating
every stored map.

## Adding a new theme

1. Drop the pack into `client/public/assets/themes/<theme-id>/`.
2. Create `client/src/game/themes/<theme-id>.ts` exporting a `ThemeManifest`.
3. Register it in `client/src/game/themes/registry.ts` (`THEMES` map).
   Widen `ThemeId` in `client/src/game/themes/types.ts` and
   `server/src/map/types.ts` from the current single literal to a
   union (e.g. `'tiny-swords-cc0' | '<new-id>'`).
4. If the theme should be selectable at runtime, wire a picker in
   `TopBar.tsx`.

## CC0 — building-to-activity mapping

Functional buildings use user-authored custom art in
`client/public/assets/themes/tiny-swords-cc0/BuildingsCustom/` — one
dedicated PNG per activity. See `tiny-swords-cc0.ts:CC0_BUILDINGS`
for paths and per-building scales.

| Activity   | Building id  | PNG                         |
|---|---|---|
| thinking   | castle       | `BuildingsCustom/Castle.png`    |
| reviewing  | watchtower   | `BuildingsCustom/Tower.png`     |
| bash       | arena        | `BuildingsCustom/Arena.png`     |
| reading    | library      | `BuildingsCustom/Library.png`   |
| editing    | forge        | `BuildingsCustom/Forge.png`     |
| idle       | tavern       | `BuildingsCustom/Tavern.png`    |
| git        | chapel       | `BuildingsCustom/Chapel.png`    |
| debugging  | alchemist    | `BuildingsCustom/Alchemist.png` |

## Phase-2 gaps (still open)

- **VFX per activity**: the CC0 pack ships Fire + Explosion sheets but
  the scene has no per-activity VFX hook.
- **UI 9-slice**: React panels are CSS-drawn, so theming them is a
  standalone cosmetic pass.
- **Archer walk cycle**: CC0 archer has no dedicated walk row — idle is
  reused.
- **Goblin troops** (Barrel / TNT / Torch): unused in the current game
  mode.
