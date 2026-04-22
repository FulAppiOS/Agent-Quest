import type { AssetManifest } from './types';
import { buildAssetManifestCc0 } from './asset-manifest-cc0';

export type ThemeId = 'tiny-swords-cc0';

/**
 * Returns the asset manifest the map editor consumes. The project ships
 * with a single bundled theme; unknown `theme` strings fall through to
 * the same manifest.
 */
export function buildAssetManifest(_theme: ThemeId | string = 'tiny-swords-cc0'): AssetManifest {
  return buildAssetManifestCc0();
}
