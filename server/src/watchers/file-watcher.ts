import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverClaudeDirs, type DiscoveryEnvironment } from '../providers/config-dirs';

export interface WatcherCallbacks {
  onNewSession: (sessionId: string, projectPath: string, configDir: string, contents: string) => void | Promise<void>;
  onSessionUpdate: (sessionId: string, projectPath: string, newContent: string, configDir: string) => void | Promise<void>;
}

export interface WatcherOptions extends WatcherCallbacks {
  /** Skip JSONL files whose mtime is older than this (ms). Default: 30 minutes. */
  maxAgeMs?: number;
  /** If omitted, discovers ~/.claude* and Xcode's Claude storage on macOS. */
  claudeDirs?: string[];
  discovery?: DiscoveryEnvironment;
}

export class FileWatcher {
  private claudeDirs: string[];
  private fileSizes = new Map<string, number>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private callbacks: WatcherCallbacks;
  private maxAgeMs: number;
  private readonly autoDiscover: boolean;
  private readonly discovery: DiscoveryEnvironment;
  private scanning = false;

  constructor(opts: WatcherOptions) {
    this.callbacks = opts;
    this.maxAgeMs = opts.maxAgeMs ?? 30 * 60 * 1000;
    this.claudeDirs = opts.claudeDirs ?? [];
    this.autoDiscover = this.claudeDirs.length === 0;
    this.discovery = opts.discovery ?? {};
  }

  static async autoDiscoverDirs(env: DiscoveryEnvironment = {}): Promise<string[]> {
    return discoverClaudeDirs(env);
  }

  async start(intervalMs = 2000): Promise<void> {
    await this.scan();

    this.pollInterval = setInterval(() => {
      this.scan().catch((err) => {
        console.error('[ClaudeProvider] scan error:', err);
      });
    }, intervalMs);

    if (this.claudeDirs.length === 0) {
      // Per-provider diagnostic only. If *both* providers end up empty, the
      // bootstrap in index.ts prints a single aggregated warning.
      console.log('[ClaudeProvider] no session storage yet — waiting for Claude or Xcode');
    } else {
      console.log(`[ClaudeProvider] watching ${this.claudeDirs.length} config dir(s) every ${intervalMs}ms:`);
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
    if (this.scanning) return;
    this.scanning = true;
    try {
      if (this.autoDiscover) this.claudeDirs = await FileWatcher.autoDiscoverDirs(this.discovery);
      for (const claudeDir of this.claudeDirs) {
        await this.scanConfigDir(claudeDir);
      }
    } finally {
      this.scanning = false;
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
          if (subFile.endsWith('.jsonl')) {
            await this.processJsonlFile(join(subagentsDir, subFile), subFile.replace('.jsonl', ''), claudeDir);
            continue;
          }

          // Ultra mode (Workflow tool) nests agent JSONLs one level deeper:
          // <sessionId>/subagents/workflows/wf_<runId>/agent-*.jsonl
          // (alongside agent-*.meta.json and an orchestration journal.jsonl)
          if (subFile !== 'workflows') continue;
          await this.scanWorkflowsDir(join(subagentsDir, subFile), claudeDir);
        }
      }
    }
  }

  private async scanWorkflowsDir(workflowsDir: string, claudeDir: string): Promise<void> {
    const runDirs = await readdir(workflowsDir).catch(() => null);
    if (runDirs === null) return;

    for (const runDir of runDirs) {
      const runPath = join(workflowsDir, runDir);
      const runStat = await stat(runPath).catch(() => null);
      if (runStat === null || !runStat.isDirectory()) continue;

      const runFiles = await readdir(runPath).catch(() => null);
      if (runFiles === null) continue;

      for (const runFile of runFiles) {
        // Only agent transcripts — skips journal.jsonl and agent-*.meta.json
        if (!runFile.startsWith('agent-') || !runFile.endsWith('.jsonl')) continue;
        await this.processJsonlFile(join(runPath, runFile), runFile.replace('.jsonl', ''), claudeDir);
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
      // Capture exactly the complete lines delivered to the provider. Re-reading
      // asynchronously could include an append that the next scan delivers twice.
      const contents = await Bun.file(filePath).slice(0, currentSize).text();
      const complete = contents.slice(0, contents.lastIndexOf('\n') + 1);
      if (complete.length === 0) return;
      this.fileSizes.set(filePath, Buffer.byteLength(complete));
      await this.callbacks.onNewSession(sessionId, filePath, claudeDir, complete);
    } else if (currentSize > previousSize) {
      // File grew — read only the new bytes
      const fd = Bun.file(filePath);
      const newBytes = fd.slice(previousSize, currentSize);
      const newContent = await newBytes.text();
      const complete = newContent.slice(0, newContent.lastIndexOf('\n') + 1);
      if (complete.length === 0) return;
      this.fileSizes.set(filePath, previousSize + Buffer.byteLength(complete));
      await this.callbacks.onSessionUpdate(sessionId, filePath, complete, claudeDir);
    }
  }
}
