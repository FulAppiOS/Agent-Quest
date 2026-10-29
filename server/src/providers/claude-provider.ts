import { FileWatcher } from '../watchers/file-watcher';
import { parseJsonlLine, parseSessionFile } from '../parsers/session-parser';
import { resolveSubagentInfo } from '../parsers/subagent-label';
import type { SubagentInfo } from '../parsers/subagent-label';
import { readConfiguredModel } from './claude-settings';
import { serializeByKey } from './serialize-by-key';
import type { ParsedEvent } from '../parsers/session-parser';
import type { AgentSource } from '../types';
import type { ProviderHandlers, SessionProvider } from './types';
import type { DiscoveryEnvironment } from './config-dirs';

export interface ClaudeProviderOptions {
  claudeDirs?: string[];
  maxAgeMs?: number;
  pollIntervalMs?: number;
  discovery?: DiscoveryEnvironment;
}

export class ClaudeProvider implements SessionProvider {
  readonly source: AgentSource = 'claude';

  private watcher: FileWatcher | null = null;
  private readonly opts: ClaudeProviderOptions;
  /** `settings.json` model per config dir, re-read at most once a minute; concurrent callers share one read. */
  private configuredModels = new Map<string, { value: Promise<string | undefined>; readAt: number }>();
  /** Deliveries for one transcript (discovery, then every incremental batch) run strictly in order. */
  private readonly deliver = serializeByKey();
  /** Subagent facts per transcript path — resolved once, reused for every incremental update. */
  private subagentInfos = new Map<string, Promise<SubagentInfo | undefined>>();

  constructor(opts: ClaudeProviderOptions = {}) {
    this.opts = opts;
  }

  async start(handlers: ProviderHandlers): Promise<void> {
    const watcher = new FileWatcher({
      maxAgeMs: this.opts.maxAgeMs,
      claudeDirs: this.opts.claudeDirs,
      discovery: this.opts.discovery,

      onNewSession: (sessionId, filePath, configDir, contents) => {
        return this.deliver(filePath, async () => {
          const events = parseSessionFile(contents);
          const isSubagent = sessionId.startsWith('agent-');
          const info = isSubagent ? await this.subagentInfoFor(filePath) : undefined;
          const configuredModel = await this.configuredModelFor(configDir);
          await handlers.onSessionStart({
            source: this.source,
            sessionId,
            configDir,
            events,
            nameOverride: info?.label,
            isSubagent,
            parentId: info?.parentId,
            subagentType: info?.agentType,
            isWorkflow: info?.isWorkflow,
            spawnToolUseId: info?.toolUseId,
            configuredModel,
          });
        }).catch((err) => console.error('[ClaudeProvider] session start failed:', err));
      },

      onSessionUpdate: (sessionId, filePath, newContent, configDir) => {
        const events: ParsedEvent[] = [];
        for (const line of newContent.split('\n')) {
          if (line.trim() === '') continue;
          const ev = parseJsonlLine(line);
          if (ev !== null) events.push(ev);
        }
        if (events.length === 0) return;
        const isSubagent = sessionId.startsWith('agent-');
        return this.deliver(filePath, async () => {
          const info = isSubagent ? await this.subagentInfoFor(filePath) : undefined;
          const configuredModel = await this.configuredModelFor(configDir);
          handlers.onSessionEvents({
            source: this.source,
            sessionId,
            configDir,
            events,
            nameOverride: info?.label,
            isSubagent,
            parentId: info?.parentId,
            subagentType: info?.agentType,
            isWorkflow: info?.isWorkflow,
            spawnToolUseId: info?.toolUseId,
            configuredModel,
          });
        }).catch((err) => console.error('[ClaudeProvider] session update failed:', err));
      },
    });

    this.watcher = watcher;
    await watcher.start(this.opts.pollIntervalMs ?? 2000);
  }

  stop(): void {
    this.watcher?.stop();
    this.watcher = null;
  }

  getConfigDirs(): readonly string[] {
    return this.watcher?.getConfigDirs() ?? this.opts.claudeDirs ?? [];
  }

  private subagentInfoFor(filePath: string): Promise<SubagentInfo | undefined> {
    let pending = this.subagentInfos.get(filePath);
    if (pending === undefined) {
      pending = resolveSubagentInfo(filePath).catch(() => undefined);
      this.subagentInfos.set(filePath, pending);
    }
    return pending;
  }

  private configuredModelFor(configDir: string): Promise<string | undefined> {
    const cached = this.configuredModels.get(configDir);
    const now = Date.now();
    if (cached !== undefined && now - cached.readAt < CONFIGURED_MODEL_TTL_MS) return cached.value;
    const value = readConfiguredModel(configDir);
    this.configuredModels.set(configDir, { value, readAt: now });
    return value;
  }
}

const CONFIGURED_MODEL_TTL_MS = 60_000;
