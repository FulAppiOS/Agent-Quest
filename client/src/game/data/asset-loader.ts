import * as Phaser from 'phaser';
import type { AssetManifest, MapConfig } from '../../editor/types/map';

/**
 * Ensure all textures referenced by a MapConfig (and the base tileset) are loaded
 * into the scene. Called at VillageScene boot when a custom MapConfig exists,
 * so only the assets actually used by that map are fetched beyond what BootScene
 * already preloaded.
 */
export async function ensureAssetsLoaded(
  scene: Phaser.Scene,
  manifest: AssetManifest,
  map: MapConfig,
): Promise<void> {
  const needed = new Set<string>();

  // base tileset + any tileset referenced by painted cells
  needed.add(map.baseTileset);
  for (const cell of Object.values(map.terrain)) {
    needed.add(cell.tile.set);
  }
  for (const d of map.decorations) {
    needed.add(d.textureKey);
  }
  for (const b of map.buildings) {
    needed.add(`building-${b.id}`);
  }

  const toLoad: Array<() => void> = [];

  for (const key of needed) {
    if (scene.textures.exists(key)) continue;

    // find in manifest
    const tileset = manifest.tilesets.find((t) => t.key === key);
    if (tileset !== undefined) {
      toLoad.push(() => {
        scene.load.spritesheet(key, tileset.path, {
          frameWidth: tileset.tileWidth,
          frameHeight: tileset.tileHeight,
        });
      });
      continue;
    }

    const deco = manifest.decorations.find((d) => d.key === key);
    if (deco !== undefined) {
      if (deco.frameWidth !== undefined && deco.frameHeight !== undefined) {
        toLoad.push(() => {
          scene.load.spritesheet(key, deco.path, {
            frameWidth: deco.frameWidth!,
            frameHeight: deco.frameHeight!,
          });
        });
      } else {
        toLoad.push(() => scene.load.image(key, deco.path));
      }
      continue;
    }

    const build = manifest.protectedBuildings.find((b) => `building-${b.id}` === key);
    if (build !== undefined) {
      toLoad.push(() => scene.load.image(key, build.path));
    }
  }

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

export function registerAnimations(scene: Phaser.Scene, manifest: AssetManifest): void {
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
