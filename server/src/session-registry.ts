import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { SessionLivenessOracle } from './state/agent-state-manager';

/** Reads `sessionId` out of a `<pid>.json` file. Tolerates noise and missing fields. */
async function readSessionIdFrom(filePath: string): Promise<string | null> {
  try {
    const text = await Bun.file(filePath).text();
    const data = JSON.parse(text) as { sessionId?: unknown };
    if (typeof data.sessionId === 'string' && data.sessionId.length > 0) {
      return data.sessionId;
    }
  } catch {
    // unreadable / not JSON / partially-written — just ignore this file
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
export class SessionRegistry implements SessionLivenessOracle {
  private configDirs: string[];
  private pidAlive: PidLivenessCheck;
  private liveSessionIds = new Set<string>();
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
        const sessionId = await readSessionIdFrom(join(sessionsDir, entry));
        if (sessionId !== null) next.add(sessionId);
      }
    }
    this.liveSessionIds = next;
    this.scanned = true;
  }
}
