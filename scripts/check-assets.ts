#!/usr/bin/env bun
/**
 * Static verification that every asset path referenced by the active theme
 * + building layout actually exists under client/public/. Run in CI or
 * pre-commit to catch renames / missing files before a user sees the boot
 * error screen.
 *
 * Usage:
 *   bun run check:assets
 *
 * Exit codes:
 *   0 — all expected assets present
 *   1 — one or more missing
 */
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tinySwordsCc0Theme } from '../client/src/game/themes/tiny-swords-cc0';
import { BUILDING_DEFS } from '../client/src/game/data/building-layout';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'client', 'public');

interface Expected {
  path: string;    // public-root-relative
  source: string;  // for error output
}

function collectExpected(): Expected[] {
  const out: Expected[] = [];
  const theme = tinySwordsCc0Theme;

  out.push({ path: 'assets/logo.png', source: 'BootScene logo' });

  for (const def of BUILDING_DEFS) {
    out.push({ path: theme.getBuildingImage(def.id), source: `building:${def.id}` });
  }

  for (const e of theme.getHeroPreload()) {
    out.push({ path: e.path, source: `hero:${e.key}` });
  }

  if (theme.terrain !== undefined) {
    out.push({ path: theme.terrain.path, source: `terrain:${theme.terrain.tilesetKey}` });
  }

  for (const e of theme.getStaticAssetPreload()) {
    out.push({ path: e.path, source: `static:${e.key}` });
  }

  return out;
}

function main(): number {
  const expected = collectExpected();

  const seen = new Set<string>();
  const missing: Expected[] = [];
  let checked = 0;

  for (const e of expected) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    checked++;
    const full = join(PUBLIC_DIR, e.path);
    if (!existsSync(full)) missing.push(e);
  }

  if (missing.length === 0) {
    console.log(`ok — ${checked} asset path${checked === 1 ? '' : 's'} verified under client/public/`);
    return 0;
  }

  console.error(`FAIL — ${missing.length} of ${checked} expected assets missing:\n`);
  for (const m of missing) {
    console.error(`  [${m.source}] ${m.path}`);
  }
  console.error('\nRestore with:  git checkout -- client/public/assets/themes/tiny-swords-cc0/');
  return 1;
}

process.exit(main());
