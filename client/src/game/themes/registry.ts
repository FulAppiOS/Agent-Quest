import type { ThemeId, ThemeManifest } from './types';
import { tinySwordsCc0Theme } from './tiny-swords-cc0';

const THEMES: Record<ThemeId, ThemeManifest> = {
  'tiny-swords-cc0': tinySwordsCc0Theme,
};

export function getActiveThemeId(): ThemeId {
  return 'tiny-swords-cc0';
}

export function getActiveTheme(): ThemeManifest {
  return THEMES['tiny-swords-cc0'];
}

/**
 * Scale values stored in a MapConfig (hero-scale, per-NPC scale) are
 * absolute numbers authored against the Tiny Swords baseline (0.5).
 * Kept as a passthrough so future themes with different native sizes
 * can rebase without migrating every stored MapConfig.
 */
export function rebaseSavedScale(savedScale: number): number {
  return savedScale;
}
