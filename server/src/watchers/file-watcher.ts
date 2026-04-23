import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface WatcherCallbacks {
  onNewSession: (sessionId: string, projectPath: string, configDir: string) => void;
  onSessionUpdate: (sessionId: string, projectPath: string, newContent: string, configDir: string) => void;
}

export interface WatcherOptions extends WatcherCallbacks {
  /** Skip JSONL files whose mtime is older than this (ms). Default: 30 minutes. */
  maxAgeMs?: number;
  /** Claude config directories to watch. If omitted, auto-discovers ~/.claude* dirs with a projects/ subdir. */
  claudeDirs?: string[];
}

export class FileWatcher {
  private claudeDirs: string[];
  private fileSizes = new Map<string, number>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private callbacks: WatcherCallbacks;
  private maxAgeMs: number;

  constructor(opts: WatcherOptions) {
    this.callbacks = opts;
    this.maxAgeMs = opts.maxAgeMs ?? 30 * 60 * 1000;
    this.claudeDirs = opts.claudeDirs ?? [];
  }

  /** Find every ~/.claudeXXX directory that contains a projects/ subdir. */
  static async autoDiscoverDirs(): Promise<string[]> {
    const home = homedir();
    let entries: string[];
    try {
      entries = await readdir(home);
    } catch {
      return [];
    }
    const dirs: string[] = [];
    for (const entry of entries) {
      if (!entry.startsWith('.claude')) continue;
      const full = join(home, entry);
      const s = await stat(full).catch(() => null);
      if (s === null || !s.isDirectory()) continue;
      const projects = join(full, 'projects');
      const ps = await stat(projects).catch(() => null);
      if (ps !== null && ps.isDirectory()) {
        dirs.push(full);
      }
    }
    return dirs;
  }

  async start(intervalMs = 2000): Promise<void> {
    if (this.claudeDirs.length === 0) {
      this.claudeDirs = await FileWatcher.autoDiscoverDirs();
    }

    await this.scan();

    this.pollInterval = setInterval(() => {
      this.scan().catch((err) => {
        console.error('[FileWatcher] scan error:', err);
      });
    }, intervalMs);

    if (this.claudeDirs.length === 0) {
      // Per-provider diagnostic only. If *both* providers end up empty, the
      // bootstrap in index.ts prints a single aggregated warning.
      console.log('[ClaudeProvider] no ~/.claude* dir — provider inactive');
    } else {
      console.log(`[FileWatcher] watching ${this.claudeDirs.length} config dir(s) every ${intervalMs}ms:`);
      for (const d of this.claudeDirs) console.log(`  - ${d}`);
    }
  }

  /** Config dirs currently being watched. Populated after start() completes. */
  getConfigDirs(): readonly string[] {
    return this.claudeDirs;
  }

  stop(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async scan(): Promise<void> {
    for (const claudeDir of this.claudeDirs) {
      await this.scanConfigDir(claudeDir);
    }
  }

  private async scanConfigDir(claudeDir: string): Promise<void> {
    const projectsDir = join(claudeDir, 'projects');
    let projectDirs: string[];
    try {
      projectDirs = await readdir(projectsDir);
    } catch {
      return; // projects/ may not exist yet
    }

    for (const projectDir of projectDirs) {
      const projectPath = join(projectsDir, projectDir);
      const projectStat = await stat(projectPath).catch(() => null);
      if (projectStat === null || !projectStat.isDirectory()) continue;

      let files: string[];
      try {
        files = await readdir(projectPath);
      } catch {
        continue;
      }

      for (const file of files) {
        if (file.endsWith('.jsonl')) {
          await this.processJsonlFile(join(projectPath, file), file.replace('.jsonl', ''), claudeDir);
          continue;
        }

        // Per-session subdirectories may contain subagent JSONLs at <sessionId>/subagents/agent-*.jsonl
        const subagentsDir = join(projectPath, file, 'subagents');
        const subStat = await stat(subagentsDir).catch(() => null);
        if (subStat === null || !subStat.isDirectory()) continue;

        const subFiles = await readdir(subagentsDir).catch(() => null);
        if (subFiles === null) continue;

        for (const subFile of subFiles) {
          if (!subFile.endsWith('.jsonl')) continue;
          await this.processJsonlFile(join(subagentsDir, subFile), subFile.replace('.jsonl', ''), claudeDir);
        }
      }
    }
  }

  private async processJsonlFile(filePath: string, sessionId: string, claudeDir: string): Promise<void> {
    const fileStat = await stat(filePath).catch(() => null);
    if (fileStat === null) return;

    const previousSize = this.fileSizes.get(filePath);
    const currentSize = fileStat.size;

    if (previousSize === undefined) {
      // Skip stale session files (not modified recently)
      const ageMs = Date.now() - fileStat.mtimeMs;
      if (ageMs > this.maxAgeMs) {
        // Remember the size so we don't re-check every poll,
        // but still react if the file grows later (session resumes)
        this.fileSizes.set(filePath, currentSize);
        return;
      }
      // New session file
      this.fileSizes.set(filePath, currentSize);
      this.callbacks.onNewSession(sessionId, filePath, claudeDir);
    } else if (currentSize > previousSize) {
      // File grew — read only the new bytes
      const fd = Bun.file(filePath);
      const newBytes = fd.slice(previousSize, currentSize);
      const newContent = await newBytes.text();
      this.fileSizes.set(filePath, currentSize);
      this.callbacks.onSessionUpdate(sessionId, filePath, newContent, claudeDir);
    }
  }
}
