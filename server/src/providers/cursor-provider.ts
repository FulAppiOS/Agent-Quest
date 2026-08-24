// server/src/providers/cursor-provider.ts
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { parseCursorLine, parseCursorFile, decodeProjectDir } from '../parsers/cursor-parser';
import type { ParsedEvent } from '../parsers/session-parser';
import type { AgentSource } from '../types';
import type { ProviderHandlers, SessionProvider } from './types';

export interface CursorProviderOptions {
  /** Defaults to `~/.cursor`. */
  cursorRoot?: string;
  /** How often to rescan the projects tree. Default 3s. */
  scanIntervalMs?: number;
  /** Ignore transcript files whose mtime is older than this when first seen. Default 3h. */
  maxAgeMs?: number;
}

interface TrackedFile {
  sessionId: string;
  sessionCwd: string;
  size: number;
}

/** Cursor can accumulate hundreds of project dirs; only the most recently
 * modified ones are relevant to live monitoring. */
const MAX_PROJECT_DIRS = 20;

export class CursorProvider implements SessionProvider {
  readonly source: AgentSource = 'cursor';

  private readonly cursorRoot: string;
  private readonly scanIntervalMs: number;
  private readonly maxAgeMs: number;
  private handlers: ProviderHandlers | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private tracked = new Map<string, TrackedFile>();
  /** Set when `start()` confirmed the cursor root directory exists. */
  private rootExists = false;
  /** Re-entrancy guard for `scan()` — mirrors CodexProvider (see its rationale). */
  private scanning = false;

  constructor(opts: CursorProviderOptions = {}) {
    this.cursorRoot = opts.cursorRoot ?? join(homedir(), '.cursor');
    this.scanIntervalMs = opts.scanIntervalMs ?? 3000;
    this.maxAgeMs = opts.maxAgeMs ?? 3 * 60 * 60_000;
  }

  async start(handlers: ProviderHandlers): Promise<void> {
    this.handlers = handlers;

    const rootStat = await stat(this.cursorRoot).catch(() => null);
    if (rootStat === null || !rootStat.isDirectory()) {
      console.log(`[CursorProvider] ${this.cursorRoot} not found — provider inactive`);
      return;
    }
    this.rootExists = true;

    await this.scan();
    this.pollInterval = setInterval(() => {
      this.scan().catch((err) => {
        console.error('[CursorProvider] scan error:', err);
      });
    }, this.scanIntervalMs);

    console.log(`[CursorProvider] watching ${this.cursorRoot} every ${this.scanIntervalMs}ms`);
  }

  stop(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.handlers = null;
  }

  getConfigDirs(): readonly string[] {
    return this.rootExists ? [this.cursorRoot] : [];
  }

  private async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const projectsDir = join(this.cursorRoot, 'projects');
      const entries = await readdir(projectsDir, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);

      // Sort by mtime desc so we only walk the most recently active projects.
      const dirs: { name: string; mtimeMs: number }[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const full = join(projectsDir, entry.name);
        const s = await stat(full).catch(() => null);
        if (s !== null) dirs.push({ name: entry.name, mtimeMs: s.mtimeMs });
      }
      dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const recent = dirs.slice(0, MAX_PROJECT_DIRS);

      for (const { name } of recent) {
        const projectCwd = decodeProjectDir(name);
        const transcriptsDir = join(projectsDir, name, 'agent-transcripts');
        const files = await listTranscriptFiles(transcriptsDir);
        for (const filePath of files) {
          await this.processFile(filePath, projectCwd);
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  private async processFile(filePath: string, projectCwd: string): Promise<void> {
    const handlers = this.handlers;
    if (handlers === null) return;

    const s = await stat(filePath).catch(() => null);
    if (s === null) return;

    const tracked = this.tracked.get(filePath);
    if (tracked === undefined) {
      const age = Date.now() - s.mtimeMs;
      if (age > this.maxAgeMs) {
        // Remember size so we still react if it resumes, but don't emit a start.
        this.tracked.set(filePath, { sessionId: '', sessionCwd: projectCwd, size: s.size });
        return;
      }

      const contents = await Bun.file(filePath).text();
      // The session id is the transcript's own uuid — the file basename.
      const sessionId = filePath.split('/').pop()?.replace(/\.jsonl$/, '') ?? 'cursor-session';
      const events = parseCursorFile(contents, { sessionId, cwd: projectCwd, timestamp: Date.now() });
      this.tracked.set(filePath, { sessionId, sessionCwd: projectCwd, size: s.size });
      await handlers.onSessionStart({
        source: this.source,
        sessionId,
        configDir: this.cursorRoot,
        events,
      });
      return;
    }

    if (s.size <= tracked.size) return;

    // Stale-on-first-sight sentinel that just grew: thread resumed after our
    // grace window. Discard the sentinel and re-run as a fresh discovery
    // (single hop — as in CodexProvider).
    if (tracked.sessionId === '') {
      this.tracked.delete(filePath);
      await this.processFile(filePath, projectCwd);
      return;
    }

    const fd = Bun.file(filePath);
    const newBytes = fd.slice(tracked.size, s.size);
    const newContent = await newBytes.text();

    const lastNlIdx = newContent.lastIndexOf('\n');
    if (lastNlIdx === -1) {
      return; // no complete line yet — wait for next scan
    }
    const complete = newContent.slice(0, lastNlIdx + 1);

    const events: ParsedEvent[] = [];
    for (const line of complete.split('\n')) {
      if (line.trim() === '') continue;
      const ev = parseCursorLine(line, { sessionId: tracked.sessionId, cwd: tracked.sessionCwd, timestamp: s.mtimeMs });
      if (ev !== null) events.push(ev);
    }
    tracked.size += Buffer.byteLength(complete, 'utf8');

    if (events.length === 0) return;

    handlers.onSessionEvents({
      source: this.source,
      sessionId: tracked.sessionId,
      configDir: this.cursorRoot,
      events,
    });
  }
}

async function listTranscriptFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [] as import('node:fs').Dirent[]);
  const out: string[] = [];
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) {
      const sub = await listTranscriptFiles(p, depth + 1);
      out.push(...sub);
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      out.push(p);
    }
  }
  return out;
}