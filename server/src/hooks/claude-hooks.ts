import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Install/uninstall of Agent Quest's `Stop` hook in a Claude Code
 * `settings.json`. The pure merge functions (add/remove/detect) are split from
 * the filesystem IO so they can be unit-tested, and so the merge never clobbers
 * a user's existing hooks: we only ever append/remove our own group, identified
 * by our endpoint path appearing in a hook entry's `url` (or `command`).
 */

/** Path fragment that marks a hook entry as ours, regardless of port/transport. */
export const HOOK_PATH = '/api/hooks/claude';

type Json = Record<string, unknown>;

export interface HookDirResult {
  configDir: string;
  settingsPath: string;
  /** True if this dir's settings.json was modified. */
  changed: boolean;
  error?: string;
}

export interface HookDirStatus {
  configDir: string;
  settingsPath: string;
  installed: boolean;
  error?: string;
}

function isObject(v: unknown): v is Json {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function hookEntryIsOurs(entry: unknown): boolean {
  if (!isObject(entry)) return false;
  const url = typeof entry.url === 'string' ? entry.url : '';
  const command = typeof entry.command === 'string' ? entry.command : '';
  return url.includes(HOOK_PATH) || command.includes(HOOK_PATH);
}

function groupHasOurHook(group: unknown): boolean {
  if (!isObject(group)) return false;
  return Array.isArray(group.hooks) && group.hooks.some(hookEntryIsOurs);
}

/** Whether `settings` already contains our Stop hook. */
export function settingsHasOurHook(settings: Json): boolean {
  if (!isObject(settings.hooks)) return false;
  const stop = settings.hooks.Stop;
  return Array.isArray(stop) && stop.some(groupHasOurHook);
}

/** The hook group we write — an `http` POST to our endpoint on every turn end. */
export function buildStopGroup(url: string): Json {
  return { matcher: '', hooks: [{ type: 'http', url }] };
}

/** Append our Stop hook group if absent. Pure; returns the (possibly new) object + whether it changed. */
export function addOurHook(settings: Json, url: string): [Json, boolean] {
  if (settingsHasOurHook(settings)) return [settings, false];
  const next: Json = { ...settings };
  const hooks: Json = isObject(next.hooks) ? { ...next.hooks } : {};
  const stop = Array.isArray(hooks.Stop) ? [...hooks.Stop] : [];
  stop.push(buildStopGroup(url));
  hooks.Stop = stop;
  next.hooks = hooks;
  return [next, true];
}

/** Remove our Stop hook group(s), tidying empty containers. Pure. */
export function removeOurHook(settings: Json): [Json, boolean] {
  if (!isObject(settings.hooks) || !Array.isArray(settings.hooks.Stop)) return [settings, false];
  const stop = settings.hooks.Stop;
  const filtered = stop.filter((g) => !groupHasOurHook(g));
  if (filtered.length === stop.length) return [settings, false];

  const nextHooks: Json = { ...settings.hooks };
  if (filtered.length === 0) delete nextHooks.Stop;
  else nextHooks.Stop = filtered;

  const next: Json = { ...settings };
  if (Object.keys(nextHooks).length === 0) delete next.hooks;
  else next.hooks = nextHooks;
  return [next, true];
}

// --- Filesystem IO -------------------------------------------------------

function settingsPathFor(configDir: string): string {
  return join(configDir, 'settings.json');
}

/**
 * Load and parse a settings.json. A missing file (or empty) yields `{}` (a fresh
 * file we may create); a present-but-malformed file throws, so we abort rather
 * than overwrite and lose the user's data.
 */
async function loadSettings(settingsPath: string): Promise<Json> {
  let raw: string;
  try {
    raw = await readFile(settingsPath, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
  if (raw.trim().length === 0) return {};
  const parsed: unknown = JSON.parse(raw); // malformed → throws, caught per-dir
  if (!isObject(parsed)) throw new Error('settings.json is not a JSON object');
  return parsed;
}

async function writeSettings(settingsPath: string, settings: Json): Promise<void> {
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export async function installHook(configDirs: string[], url: string): Promise<HookDirResult[]> {
  const results: HookDirResult[] = [];
  for (const configDir of configDirs) {
    const settingsPath = settingsPathFor(configDir);
    try {
      const settings = await loadSettings(settingsPath);
      const [next, changed] = addOurHook(settings, url);
      if (changed) await writeSettings(settingsPath, next);
      results.push({ configDir, settingsPath, changed });
    } catch (e) {
      results.push({ configDir, settingsPath, changed: false, error: (e as Error).message });
    }
  }
  return results;
}

export async function uninstallHook(configDirs: string[]): Promise<HookDirResult[]> {
  const results: HookDirResult[] = [];
  for (const configDir of configDirs) {
    const settingsPath = settingsPathFor(configDir);
    try {
      const settings = await loadSettings(settingsPath);
      const [next, changed] = removeOurHook(settings);
      if (changed) await writeSettings(settingsPath, next);
      results.push({ configDir, settingsPath, changed });
    } catch (e) {
      results.push({ configDir, settingsPath, changed: false, error: (e as Error).message });
    }
  }
  return results;
}

export async function hookStatus(configDirs: string[]): Promise<HookDirStatus[]> {
  const out: HookDirStatus[] = [];
  for (const configDir of configDirs) {
    const settingsPath = settingsPathFor(configDir);
    try {
      const settings = await loadSettings(settingsPath);
      out.push({ configDir, settingsPath, installed: settingsHasOurHook(settings) });
    } catch (e) {
      out.push({ configDir, settingsPath, installed: false, error: (e as Error).message });
    }
  }
  return out;
}
