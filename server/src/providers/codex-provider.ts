import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { parseCodexLine, parseCodexSessionMeta } from '../parsers/codex-parser';
import type { ParsedEvent } from '../parsers/session-parser';
import type { AgentSource } from '../types';
import type { ProviderHandlers, SessionProvider } from './types';

export interface CodexProviderOptions {
  /** Defaults to `~/.codex`. */
  codexRoot?: string;
  /** How often to rescan the sessions tree. Default 3s. */
  scanIntervalMs?: number;
  /** Ignore rollout files whose mtime is older than this when first seen. Default 3h. */
  maxAgeMs?: number;
}

interface TrackedFile {
  sessionId: string;
  sessionCwd: string;
  size: number;
}

export class CodexProvider implements SessionProvider {
  readonly source: AgentSource = 'codex';

  private readonly codexRoot: string;
  private readonly scanIntervalMs: number;
  private readonly maxAgeMs: number;
  private handlers: ProviderHandlers | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private tracked = new Map<string, TrackedFile>();

  constructor(opts: CodexProviderOptions = {}) {
    this.codexRoot = opts.codexRoot ?? join(homedir(), '.codex');
    this.scanIntervalMs = opts.scanIntervalMs ?? 3000;
    this.maxAgeMs = opts.maxAgeMs ?? 3 * 60 * 60_000;
  }

  async start(handlers: ProviderHandlers): Promise<void> {
    this.handlers = handlers;

    const rootStat = await stat(this.codexRoot).catch(() => null);
    if (rootStat === null || !rootStat.isDirectory()) {
      console.warn(`[CodexProvider] ${this.codexRoot} not found — Codex threads won't appear.`);
      return;
    }

    await this.scan();
    this.pollInterval = setInterval(() => {
      this.scan().catch((err) => {
        console.error('[CodexProvider] scan error:', err);
      });
    }, this.scanIntervalMs);

    console.log(`[CodexProvider] watching ${this.codexRoot} every ${this.scanIntervalMs}ms`);
  }

  stop(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.handlers = null;
  }

  getConfigDirs(): readonly string[] {
    return [this.codexRoot];
  }

  private async scan(): Promise<void> {
    const sessionsDir = join(this.codexRoot, 'sessions');
    const files = await listRolloutFiles(sessionsDir).catch(() => [] as string[]);
    for (const filePath of files) {
      await this.processFile(filePath);
    }
  }

  private async processFile(filePath: string): Promise<void> {
    const handlers = this.handlers;
    if (handlers === null) return;

    const s = await stat(filePath).catch(() => null);
    if (s === null) return;

    const tracked = this.tracked.get(filePath);
    if (tracked === undefined) {
      // First time we see this file. Skip if too old.
      const age = Date.now() - s.mtimeMs;
      if (age > this.maxAgeMs) {
        // Remember size so we still react if it resumes later, but don't emit a start event.
        this.tracked.set(filePath, { sessionId: '', sessionCwd: '', size: s.size });
        return;
      }

      const contents = await Bun.file(filePath).text();
      const firstLine = contents.split('\n', 1)[0] ?? '';
      const meta = parseCodexSessionMeta(firstLine);
      if (meta === null) {
        // Malformed rollout (no session_meta as first line) — skip for now, recheck next poll.
        return;
      }
      const events: ParsedEvent[] = [];
      for (const line of contents.split('\n')) {
        if (line.trim() === '') continue;
        const ev = parseCodexLine(line, meta.id, meta.cwd);
        if (ev !== null) events.push(ev);
      }
      this.tracked.set(filePath, { sessionId: meta.id, sessionCwd: meta.cwd, size: s.size });
      await handlers.onSessionStart({
        source: this.source,
        sessionId: meta.id,
        configDir: this.codexRoot,
        events,
      });
      return;
    }

    // Follow-up scan: detect growth.
    if (tracked.sessionId === '') return; // stale-on-first-sight file; ignore
    if (s.size <= tracked.size) return;

    const fd = Bun.file(filePath);
    const newBytes = fd.slice(tracked.size, s.size);
    const newContent = await newBytes.text();
    const events: ParsedEvent[] = [];
    for (const line of newContent.split('\n')) {
      if (line.trim() === '') continue;
      const ev = parseCodexLine(line, tracked.sessionId, tracked.sessionCwd);
      if (ev !== null) events.push(ev);
    }
    tracked.size = s.size;
    if (events.length === 0) return;

    handlers.onSessionEvents({
      source: this.source,
      sessionId: tracked.sessionId,
      configDir: this.codexRoot,
      events,
    });
  }
}

async function listRolloutFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 6) return [];
  const entries = await readdir(root).catch(() => [] as string[]);
  const out: string[] = [];
  for (const e of entries) {
    const p = join(root, e);
    const s = await stat(p).catch(() => null);
    if (s === null) continue;
    if (s.isDirectory()) {
      const sub = await listRolloutFiles(p, depth + 1);
      out.push(...sub);
    } else if (e.startsWith('rollout-') && e.endsWith('.jsonl')) {
      out.push(p);
    }
  }
  return out;
}
