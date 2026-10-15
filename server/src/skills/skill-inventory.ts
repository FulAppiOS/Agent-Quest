import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentSource, SkillInventory } from '../types';
import { estimateTokens } from '../types';

/**
 * Skills installed on disk, measured as "what they would cost if every body
 * were always in the context". Skills are loaded on demand (progressive
 * disclosure), so the gap between this figure and the tokens a session
 * actually loaded is the context the skill system saved.
 *
 * Layouts:
 *   Claude Code  <configDir>/skills/<name>/SKILL.md
 *                <configDir>/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md
 *   Codex        <codexRoot>/skills/<name>/SKILL.md
 * Project-local `.claude/skills` dirs are deliberately not scanned: they vary
 * per cwd and would need every project path.
 */

async function listDirs(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** Numeric, segment-wise version compare (`1.10.0` > `1.2.0`); non-numeric segments compare as strings. */
function compareVersions(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  const n = Math.max(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const x = as[i] ?? '0';
    const y = bs[i] ?? '0';
    const xn = Number(x);
    const yn = Number(y);
    if (Number.isFinite(xn) && Number.isFinite(yn)) {
      if (xn !== yn) return xn - yn;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Directories holding `<name>/SKILL.md` for a Claude Code install: user skills + the latest cached version of each plugin. */
export async function claudeSkillRoots(configDir: string): Promise<string[]> {
  const roots = [join(configDir, 'skills')];
  const cache = join(configDir, 'plugins', 'cache');
  for (const marketplace of await listDirs(cache)) {
    for (const plugin of await listDirs(join(cache, marketplace))) {
      const versions = await listDirs(join(cache, marketplace, plugin));
      const latest = versions.sort(compareVersions).at(-1);
      if (latest === undefined) continue;
      roots.push(join(cache, marketplace, plugin, latest, 'skills'));
    }
  }
  return roots;
}

export function codexSkillRoots(codexRoot: string): string[] {
  return [join(codexRoot, 'skills')];
}

/** Count `<root>/<name>/SKILL.md` files across roots and estimate their total tokens. Missing roots are skipped. */
export async function scanSkillInventory(roots: string[]): Promise<SkillInventory> {
  let count = 0;
  let bytes = 0;
  for (const root of roots) {
    for (const name of await listDirs(root)) {
      const s = await stat(join(root, name, 'SKILL.md')).catch(() => null);
      if (s === null || !s.isFile()) continue;
      count += 1;
      bytes += s.size;
    }
  }
  return { count, tokens: estimateTokens(bytes) };
}

/** True when any provider's count or token estimate differs (or a provider appears/disappears). */
export function inventoryChanged(
  prev: Partial<Record<AgentSource, SkillInventory>>,
  next: Partial<Record<AgentSource, SkillInventory>>,
): boolean {
  const sources: AgentSource[] = ['claude', 'codex'];
  return sources.some((s) => {
    const a = prev[s];
    const b = next[s];
    if (a === undefined || b === undefined) return a !== b;
    return a.count !== b.count || a.tokens !== b.tokens;
  });
}
