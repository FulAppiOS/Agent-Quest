import * as Phaser from 'phaser';
import type { AssetManifest, MapConfig, PathSegment } from '../../editor/types/map';
import { TILE_SIZE } from '../../editor/types/map';

/**
 * Renders a user-saved MapConfig into a Phaser scene. Used by VillageScene when
 * a custom map was built in the editor. When no MapConfig is present, the
 * scene falls back to the procedural TerrainRenderer instead.
 */

interface Containers {
  base: Phaser.GameObjects.TileSprite;
  terrain: Phaser.GameObjects.Container;
  paths: Phaser.GameObjects.Container;
}

const PATH_STYLES = {
  main:      { fill: 0x7A6548, stroke: 0x4A3A24, strokeAlpha: 0.55, fillAlpha: 0.92 },
  secondary: { fill: 0x8A7858, stroke: 0x5A4A2C, strokeAlpha: 0.5,  fillAlpha: 0.88 },
  trail:     { fill: 0x5C4A30, stroke: 0x3A2A18, strokeAlpha: 0.55, fillAlpha: 0.9  },
  plaza:     { fill: 0x7A6548, stroke: 0x5C4E3A, strokeAlpha: 0.6,  fillAlpha: 0.95 },
} as const;

export function renderMapConfig(
  scene: Phaser.Scene,
  map: MapConfig,
  manifest: AssetManifest,
): Containers {
  const baseInfo = manifest.tilesets.find((t) => t.key === map.baseTileset) ?? manifest.tilesets[0];
  if (baseInfo === undefined) {
    throw new Error(`No tileset available for base rendering`);
  }

  // Base ground layer
  const base = scene.add.tileSprite(
    map.world.width / 2,
    map.world.height / 2,
    map.world.width,
    map.world.height,
    baseInfo.key,
    0, // first frame of the tileset as base fill
  ).setDepth(-1000);

  const terrain = scene.add.container(0, 0).setDepth(-800);
  const paths = scene.add.container(0, 0).setDepth(-400);
  // Decorations are added directly to the scene (not wrapped in a container) so
  // each sprite's Y-based depth can freely interleave with NPCs and heroes for
  // correct perspective sorting. A container would collapse all decorations to
  // a single depth slot, forcing them all above or below every moving entity.

  // Painted terrain cells
  for (const [key, cell] of Object.entries(map.terrain)) {
    const [colStr, rowStr] = key.split(',');
    if (colStr === undefined || rowStr === undefined) continue;
    const col = parseInt(colStr, 10);
    const row = parseInt(rowStr, 10);
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
    if (!scene.textures.exists(cell.tile.set)) continue;
    const sprite = scene.add.sprite(
      col * TILE_SIZE + TILE_SIZE / 2,
      row * TILE_SIZE + TILE_SIZE / 2,
      cell.tile.set,
      cell.tile.frame,
    );
    terrain.add(sprite);
  }

  // Paths
  for (const path of map.paths) {
    drawPath(scene, paths, path);
  }

  // Decorations — added top-level so Y-sorting works against NPCs/heroes.
  // Depth uses the sprite's *foot* Y (bottom edge), not its center: an NPC
  // walking in front of a tree's trunk (NPC Y > tree foot Y) should cover the
  // tree, while an NPC standing behind it (NPC Y < foot Y) stays hidden.
  for (const d of map.decorations) {
    if (!scene.textures.exists(d.textureKey)) continue;
    const needsSprite = d.frame !== undefined || d.animated === true;
    const gameObj = needsSprite
      ? scene.add.sprite(d.x, d.y, d.textureKey, d.frame ?? 0)
      : scene.add.image(d.x, d.y, d.textureKey);
    gameObj.setScale(d.scale);
    if (d.tint !== undefined) gameObj.setTint(d.tint);
    if (d.animated === true && gameObj instanceof Phaser.GameObjects.Sprite) {
      const animKey = `${d.textureKey}:${d.animation ?? 'idle'}`;
      if (scene.anims.exists(animKey)) gameObj.play(animKey);
    }
    const footY = d.y + gameObj.displayHeight * 0.5;
    gameObj.setDepth(d.depth ?? footY);
  }

  return { base, terrain, paths };
}

function drawPath(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  path: PathSegment,
): void {
  const style = PATH_STYLES[path.style];
  if (path.points.length < 2) return;

  const g = scene.add.graphics();
  // outer stroke (shadow)
  g.lineStyle(path.width + 6, style.stroke, style.strokeAlpha * 0.5);
  drawPolyline(g, path.points);
  // main fill
  g.lineStyle(path.width, style.fill, style.fillAlpha);
  drawPolyline(g, path.points);
  // inner highlight
  g.lineStyle(Math.max(2, path.width - 14), style.fill + 0x0a0a0a, Math.min(1, style.fillAlpha + 0.05));
  drawPolyline(g, path.points);
  // border
  g.lineStyle(1.5, style.stroke, style.strokeAlpha);
  drawPolyline(g, path.points);

  container.add(g);
}

function drawPolyline(g: Phaser.GameObjects.Graphics, pts: Array<{ x: number; y: number }>): void {
  if (pts.length < 2) return;
  const first = pts[0];
  if (first === undefined) return;
  g.beginPath();
  g.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p === undefined) continue;
    g.lineTo(p.x, p.y);
  }
  g.strokePath();
}
