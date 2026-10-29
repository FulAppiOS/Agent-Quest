import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { parseCodexLine, parseCodexSessionMeta } from '../parsers/codex-parser';
import type { ParsedEvent } from '../parsers/session-parser';
import type { AgentSource } from '../types';
import type { ProviderHandlers, SessionProvider } from './types';
import { defaultCodexRoots, existingConfigDirs, type DiscoveryEnvironment } from './config-dirs';
import { isXcodeConfigDir } from '../state/xcode-session';
import { xcodeToolActivity } from '../parsers/xcode-tools';

export interface CodexProviderOptions {
  /** Explicit single-root override, retained for existing callers. */
  codexRoot?: string;
  /** Defaults to ~/.codex plus Xcode's Codex storage on macOS. */
  codexRoots?: string[];
  discovery?: DiscoveryEnvironment;
  /** How often to rescan the sessions tree. Default 3s. */
  scanIntervalMs?: number;
  /** Ignore rollout files whose mtime is older than this when first seen. Default 3h. */
  maxAgeMs?: number;
}

interface TrackedFile {
  sessionId: string;
  sessionCwd: string;
  size: number;
  rawToolCalls?: boolean;
  seenCalls?: Set<string>;
  isSubagent?: boolean;
  parentId?: string;
  nickname?: string;
  subagentType?: string;
}

export class CodexProvider implements SessionProvider {
  readonly source: AgentSource = 'codex';

  private readonly codexRoots: string[];
  private readonly scanIntervalMs: number;
  private readonly maxAgeMs: number;
  private handlers: ProviderHandlers | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private tracked = new Map<string, TrackedFile>();
  private configDirs: string[] = [];
  /** Re-entrancy guard for `scan()`. On machines with thousands of archived
   * rollouts the recursive walk can take longer than `scanIntervalMs`, and
   * overlapping scans race on `this.tracked` — the second scan sees `tracked`
   * still undefined for a file the first one is mid-parsing, re-emits
   * `onSessionStart`, and the state manager ends up with duplicate tool calls. */
  private scanning = false;

  constructor(opts: CodexProviderOptions = {}) {
    this.codexRoots = opts.codexRoots ?? (opts.codexRoot !== undefined ? [opts.codexRoot] : defaultCodexRoots(opts.discovery));
    this.scanIntervalMs = opts.scanIntervalMs ?? 3000;
    this.maxAgeMs = opts.maxAgeMs ?? 3 * 60 * 60_000;
  }

  async start(handlers: ProviderHandlers): Promise<void> {
    this.handlers = handlers;

    await this.scan();
    this.pollInterval = setInterval(() => {
      this.scan().catch((err) => {
        console.error('[CodexProvider] scan error:', err);
      });
    }, this.scanIntervalMs);

    console.log(`[CodexProvider] watching ${this.configDirs.length} config dir(s) every ${this.scanIntervalMs}ms; waiting for new roots`);
  }

  stop(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.handlers = null;
  }

  getConfigDirs(): readonly string[] {
    return this.configDirs;
  }

  private async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      this.configDirs = await existingConfigDirs(this.codexRoots);
      for (const configDir of this.configDirs) {
        const files = await listRolloutFiles(join(configDir, 'sessions'));
        for (const filePath of files) {
          await this.processFile(filePath, configDir);
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  private async processFile(filePath: string, configDir: string): Promise<void> {
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

      const contents = await Bun.file(filePath).slice(0, s.size).text();
      const complete = contents.slice(0, contents.lastIndexOf('\n') + 1);
      const firstLine = complete.split('\n', 1)[0] ?? '';
      const meta = parseCodexSessionMeta(firstLine);
      if (meta === null) {
        // Malformed rollout (no session_meta as first line) — skip for now, recheck next poll.
        return;
      }
      const subagentType = meta.agentPath !== undefined ? basename(meta.agentPath) : undefined;
      const next: TrackedFile = {
        sessionId: meta.id,
        sessionCwd: meta.cwd,
        size: Buffer.byteLength(complete),
        rawToolCalls: meta.originator === 'Xcode' || isXcodeConfigDir(configDir),
        seenCalls: new Set(),
        isSubagent: meta.isSubagent,
        parentId: meta.parentThreadId,
        nickname: meta.agentNickname,
        subagentType,
      };
      const events = parseEvents(complete, next);
      this.tracked.set(filePath, next);
      await handlers.onSessionStart({
        source: this.source,
        sessionId: meta.id,
        configDir,
        events,
        isSubagent: meta.isSubagent,
        parentId: meta.parentThreadId,
        // Codex names its subagents (e.g. "Copernicus"); the main thread keeps the cwd-derived name.
        nameOverride: meta.agentNickname,
        subagentType,
      });
      return;
    }

    // Follow-up scan.
    if (s.size <= tracked.size) return;

    // Stale-on-first-sight sentinel that just grew: the thread resumed after
    // our grace window. Discard the sentinel and re-run as a fresh discovery
    // (single hop, no infinite recursion — second call always finds a non-empty
    // tracked entry OR a real sessionId).
    if (tracked.sessionId === '') {
      this.tracked.delete(filePath);
      await this.processFile(filePath, configDir);
      return;
    }

    const fd = Bun.file(filePath);
    const newBytes = fd.slice(tracked.size, s.size);
    const newContent = await newBytes.text();

    // Guard against partial JSONL writes: if polling catches Codex mid-write,
    // the tail will not end with '\n'. Process only up to the last newline; hold
    // back the trailing partial bytes until the next scan completes the line.
    const lastNlIdx = newContent.lastIndexOf('\n');
    if (lastNlIdx === -1) {
      // No complete line yet — wait for next scan, don't advance.
      return;
    }
    const complete = newContent.slice(0, lastNlIdx + 1);

    const events = parseEvents(complete, tracked);
    // Advance by the BYTE length of the processed chunk (not char length) —
    // required for UTF-8 content, safe for pure ASCII. `\n` is always 1 byte
    // so the offset lines up exactly with the file position.
    tracked.size += Buffer.byteLength(complete, 'utf8');

    if (events.length === 0) return;

    handlers.onSessionEvents({
      source: this.source,
      sessionId: tracked.sessionId,
      configDir,
      events,
      isSubagent: tracked.isSubagent,
      parentId: tracked.parentId,
      nameOverride: tracked.nickname,
      subagentType: tracked.subagentType,
    });
  }
}

/** Xcode can emit both an invocation and a completion for the same call.
 * Keep completion telemetry without counting the work or changing lifecycle twice. */
function parseEvents(contents: string, tracked: TrackedFile): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const seen = tracked.seenCalls ??= new Set<string>();
  for (const line of contents.split('\n')) {
    if (line.trim() === '') continue;
    let event = parseCodexLine(line, tracked.sessionId, tracked.sessionCwd, { rawToolCalls: tracked.rawToolCalls });
    if (event === null) continue;
    const calls = event.toolCalls;
    if (calls.length > 0 && (tracked.rawToolCalls || calls.every((tc) => xcodeToolActivity(tc.name) !== undefined))) {
      const fresh = calls.filter((tc) => !seen.has(tc.id));
      if (fresh.length === 0) {
        const chars = event.pluginCalls?.[0]?.resultChars;
        if (chars === undefined && !event.skillLoad) continue;
        event = { ...event, kind: 'telemetry', activity: 'idle', toolCalls: [], pluginCalls: undefined,
          toolResults: chars === undefined ? undefined : [{ toolUseId: calls[0]!.id, chars }], isTurnEnd: undefined };
      } else {
        event.toolCalls = fresh;
        for (const tc of fresh) seen.add(tc.id);
        while (seen.size > 4096) seen.delete(seen.values().next().value!);
      }
    }
    events.push(event);
  }
  return events;
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
