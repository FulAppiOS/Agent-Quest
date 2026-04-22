/**
 * Shared categorisation for asset-load failures. Used by BootScene (fatal
 * error screen) and EditorBootScene (non-blocking banner) so both surfaces
 * show the same labels and counts.
 *
 * Categories are chosen to map to user intent: "did I break heroes, buildings,
 * terrain, or decorations?" — which is far more actionable than a raw list of
 * 40 missing PNG paths.
 */

export interface AssetCategorySummary {
  /** Stable id used by callers that want to style categories differently. */
  id: 'hero' | 'building' | 'terrain' | 'decoration' | 'ui' | 'other';
  /** Human-readable label for the boot screen / editor banner. */
  label: string;
  count: number;
}

export interface GroupedMissingAssets {
  total: number;
  categories: AssetCategorySummary[];
  /** Relative paths (public-root-relative when possible) for sampling. */
  samples: string[];
}

/**
 * Strip the origin and leading slash from a loader URL so samples display
 * as `assets/themes/...` rather than `http://localhost:4445/assets/themes/...`.
 */
function normalisePath(raw: string): string {
  try {
    const u = new URL(raw);
    return u.pathname.replace(/^\//, '');
  } catch {
    return raw.replace(/^\//, '');
  }
}

function classify(path: string): AssetCategorySummary['id'] {
  const p = path.toLowerCase();
  if (p.includes('/troops/')) return 'hero';
  if (p.includes('/buildingscustom/') || p.includes('/buildings/')) return 'building';
  if (p.includes('/terrain/')) return 'terrain';
  if (p.includes('/deco/') || p.includes('/resources/') || p.includes('/trees/')) return 'decoration';
  if (p.includes('/ui/') || p.endsWith('logo.png')) return 'ui';
  return 'other';
}

const CATEGORY_ORDER: AssetCategorySummary['id'][] = [
  'hero',
  'building',
  'terrain',
  'decoration',
  'ui',
  'other',
];

const CATEGORY_LABEL: Record<AssetCategorySummary['id'], string> = {
  hero: 'Hero sprites',
  building: 'Buildings',
  terrain: 'Terrain tiles',
  decoration: 'Decorations (trees, rocks, bushes)',
  ui: 'UI / logo',
  other: 'Other',
};

export function groupMissingByCategory(rawPaths: readonly string[]): GroupedMissingAssets {
  const normalised = rawPaths.map(normalisePath);
  const counts = new Map<AssetCategorySummary['id'], number>();
  for (const p of normalised) {
    const id = classify(p);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  // Preserve a consistent display order and drop empty buckets so the UI
  // only shows categories that were actually affected.
  const categories: AssetCategorySummary[] = CATEGORY_ORDER
    .filter((id) => (counts.get(id) ?? 0) > 0)
    .map((id) => ({ id, label: CATEGORY_LABEL[id], count: counts.get(id)! }));

  return {
    total: normalised.length,
    categories,
    samples: normalised,
  };
}
