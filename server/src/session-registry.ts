import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { SessionDisplayNameOracle, SessionLivenessOracle } from './state/agent-state-manager';

/** Reads `sessionId` and `jobId` out of a `<pid>.json` file. Tolerates noise and missing fields. */
async function readSessionMetaFrom(filePath: string): Promise<{ sessionId: string; jobId: string | null } | null> {
  try {
    const text = await Bun.file(filePath).text();
    const data = JSON.parse(text) as { sessionId?: unknown; jobId?: unknown };
    if (typeof data.sessionId === 'string' && data.sessionId.length > 0) {
      const jobId = typeof data.jobId === 'string' && data.jobId.length > 0 ? data.jobId : null;
      return { sessionId: data.sessionId, jobId };
    }
  } catch {
    // unreadable / not JSON / partially-written — just ignore this file
  }
  return null;
}

/**
 * Reads the human-friendly display name out of `<configDir>/jobs/<jobId>/state.json`.
 * This is the same `name` field that Claude Code's `claude agents` view renders in
 * the left column — see `~/.claude/rules/session-display-name.md`. Returns null
 * when the file is missing, unparseable, or omits the field.
 */
async function readDisplayNameFrom(filePath: string): Promise<string | null> {
  try {
    const text = await Bun.file(filePath).text();
    const data = JSON.parse(text) as { name?: unknown };
    if (typeof data.name === 'string' && data.name.length > 0) {
      return data.name;
    }
  } catch {
    // missing / unreadable / not JSON — fall back to slug/cwd at the caller.
  }
  return null;
}

/** Dependency-injectable liveness check; real impl uses `process.kill(pid, 0)`. */
export type PidLivenessCheck = (pid: number) => boolean;

const defaultPidAlive: PidLivenessCheck = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export interface SessionRegistryOptions {
  /** Claude Code config dirs to watch (each scanned under `<dir>/sessions/*.json`).
   * Registry is Claude-only by design — the pidfile oracle is a Claude-specific
   * signal. Codex liveness is inferred purely from rollout-file activity. */
  configDirs: string[];
  /** Override for tests. Defaults to a real `process.kill(pid, 0)` probe. */
  pidAlive?: PidLivenessCheck;
}

/**
 * Periodically snapshots `<configDir>/sessions/<pid>.json` and keeps the set of
 * Claude Code sessionIds whose pid is still running. Used to filter out phantom
 * agents whose JSONLs were touched by Claude Code resume/hook machinery but
 * whose real process has long since exited.
 */
export class SessionRegistry implements SessionLivenessOracle, SessionDisplayNameOracle {
  private configDirs: string[];
  private pidAlive: PidLivenessCheck;
  private liveSessionIds = new Set<string>();
  private displayNames = new Map<string, string>();
  private scanned = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(opts: SessionRegistryOptions) {
    this.configDirs = opts.configDirs;
    this.pidAlive = opts.pidAlive ?? defaultPidAlive;
  }

  /** Replace the watched set (e.g. after FileWatcher auto-discovers new dirs). */
  setConfigDirs(dirs: readonly string[]): void {
    this.configDirs = [...dirs];
  }

  hasAnyLive(): boolean {
    return this.scanned && this.liveSessionIds.size > 0;
  }

  isLive(sessionId: string): boolean {
    return this.liveSessionIds.has(sessionId);
  }

  /**
   * Returns the user-set display name for a live Claude session, or undefined
   * when the session has no jobId, no state.json, or the file omits the field.
   * Callers fall back to slug/cwd in that case.
   */
  getDisplayName(sessionId: string): string | undefined {
    return this.displayNames.get(sessionId);
  }

  /** Current live session IDs (copy, for debugging/snapshots). */
  snapshot(): string[] {
    return [...this.liveSessionIds];
  }

  async start(intervalMs = 10_000): Promise<void> {
    await this.scan();
    this.pollInterval = setInterval(() => {
      this.scan().catch((err) => {
        console.error('[SessionRegistry] scan error:', err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async scan(): Promise<void> {
    const next = new Set<string>();
    const nextNames = new Map<string, string>();
    for (const configDir of this.configDirs) {
      const sessionsDir = join(configDir, 'sessions');
      let entries: string[];
      try {
        entries = await readdir(sessionsDir);
      } catch {
        continue; // sessions/ may not exist for this install
      }
      for (const entry of entries) {
        const pidMatch = entry.match(/^(\d+)\.json$/);
        if (pidMatch === null) continue;
        const pid = Number.parseInt(pidMatch[1]!, 10);
        if (!Number.isFinite(pid) || pid <= 0) continue;
        if (!this.pidAlive(pid)) continue;
        const meta = await readSessionMetaFrom(join(sessionsDir, entry));
        if (meta === null) continue;
        next.add(meta.sessionId);
        if (meta.jobId !== null) {
          const statePath = join(configDir, 'jobs', meta.jobId, 'state.json');
          const displayName = await readDisplayNameFrom(statePath);
          if (displayName !== null) nextNames.set(meta.sessionId, displayName);
        }
      }
    }
    this.liveSessionIds = next;
    this.displayNames = nextNames;
    this.scanned = true;
  }
}
