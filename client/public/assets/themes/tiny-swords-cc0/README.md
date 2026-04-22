# Tiny Swords (Update 010) — CC0

Bundled pixel-art pack used by the `tiny-swords-cc0` asset theme —
Agent Quest's sole shipped theme.

## Source

- **Author**: Pixel Frog
- **Pack**: Tiny Swords, Update 010 (CC0 edition)
- **Upstream**: <https://pixelfrog-assets.itch.io/tiny-swords>
- **License**: CC0 1.0 Universal — see `LICENSE.txt`
- **Imported**: 2026-04-18

## Pack layout notes

- One combined PNG per (color, unit) pair containing every animation
  (idle, walk, attack, hit, death) packed into rows. The theme loader
  slices rows via explicit frame-index arrays.
- Three unit types ship: Warrior, Archer, Pawn. The theme's NPC
  manifest falls back to Warrior for the Monk slot since the pack
  has no Monk sprite.
- Four colors ship: Blue, Red, Yellow, Purple. The manifest falls
  back to Purple for Black.
- Filename quirk: `Archer/Purple/Archer_Purlple.png` is the upstream
  spelling — preserved verbatim for diff-clean pack updates.

## What's used at runtime

The theme consumes the following subtrees:

- **Heroes**: `Factions/Knights/Troops/{Warrior,Archer,Pawn}/{Blue,Red,Yellow,Purple}/*.png`
- **Terrain**: `Terrain/Ground/Tilemap_Flat.png` (background grass)
- **Functional buildings**: `BuildingsCustom/*.png` — user-authored custom
  art (Castle, Library, Forge, Tavern, Chapel, Tower, Arena, Alchemist)
  overlays the upstream Knights Buildings silhouettes.
- **Decorative houses** (NPC hamlet): `Factions/Knights/Buildings/` subtree
  (House + Construction + Destroyed + Tower variants)
- **Trees**: `Resources/Trees/Tree.png` (atlas sliced at boot into 4 variants)
- **Decorations** (bushes, rocks, stumps): `Deco/01-12.png` remapped onto
  the existing `bush-*/rock-*/stump-*` slots

Unused (shipped for future extensions):
- **Effects**: `Effects/Explosion.png`, `Effects/Fire.png` (per-activity
  VFX is a separate feature, not currently wired)
- **UI**: `UI/{Banners,Buttons,Icons,Pointers,Ribbons}/` (React panels
  are CSS-drawn today)
- **Barrel Goblin troops**: `Factions/Goblins/Troops/Barrel/*` (TNT +
  Torch are wired as NPC brushes; Barrel has no gameplay use yet)
- **Resources**: `Resources/{Gold Mine,Resources,Sheep}/*` (decorative
  economy assets not referenced yet)
