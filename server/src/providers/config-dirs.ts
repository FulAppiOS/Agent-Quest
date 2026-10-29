import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Injectable host paths keep discovery tests independent of the user's sessions. */
export interface DiscoveryEnvironment {
  home?: string;
  platform?: NodeJS.Platform;
}

export function defaultCodexRoots(env: DiscoveryEnvironment = {}): string[] {
  const home = env.home ?? homedir();
  return [join(home, '.codex'), ...xcodeRoots('codex', env)];
}

function xcodeRoots(name: string, env: DiscoveryEnvironment): string[] {
  return (env.platform ?? process.platform) === 'darwin'
    ? [join(env.home ?? homedir(), 'Library', 'Developer', 'Xcode', 'CodingAssistant', name)]
    : [];
}

/** Keep display paths, but visit a directory only once even if a profile is a symlink. */
export async function existingConfigDirs(candidates: readonly string[], subdir?: string): Promise<string[]> {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const dir of candidates) {
    const path = subdir === undefined ? dir : join(dir, subdir);
    const s = await stat(path).catch(() => null);
    if (!s?.isDirectory()) continue;
    const identity = await realpath(dir).catch(() => dir);
    if (seen.has(identity)) continue;
    seen.add(identity);
    dirs.push(dir);
  }
  return dirs;
}

export async function discoverClaudeDirs(env: DiscoveryEnvironment = {}): Promise<string[]> {
  const home = env.home ?? homedir();
  const entries = await readdir(home).catch(() => [] as string[]);
  const candidates = entries.filter((entry) => entry.startsWith('.claude')).map((entry) => join(home, entry));
  return existingConfigDirs([...candidates, ...xcodeRoots('ClaudeAgentConfig', env)], 'projects');
}
