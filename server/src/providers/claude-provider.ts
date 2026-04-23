import { FileWatcher } from '../watchers/file-watcher';
import { parseJsonlLine, parseSessionFile } from '../parsers/session-parser';
import { resolveSubagentLabel } from '../parsers/subagent-label';
import type { ParsedEvent } from '../parsers/session-parser';
import type { AgentSource } from '../types';
import type { ProviderHandlers, SessionProvider } from './types';

export interface ClaudeProviderOptions {
  claudeDirs?: string[];
  maxAgeMs?: number;
  pollIntervalMs?: number;
}

export class ClaudeProvider implements SessionProvider {
  readonly source: AgentSource = 'claude';

  private watcher: FileWatcher | null = null;
  private readonly opts: ClaudeProviderOptions;

  constructor(opts: ClaudeProviderOptions = {}) {
    this.opts = opts;
  }

  async start(handlers: ProviderHandlers): Promise<void> {
    const watcher = new FileWatcher({
      maxAgeMs: this.opts.maxAgeMs,
      claudeDirs: this.opts.claudeDirs,

      onNewSession: async (sessionId, filePath, configDir) => {
        const contents = await Bun.file(filePath).text();
        const events = parseSessionFile(contents);
        const nameOverride = sessionId.startsWith('agent-')
          ? await resolveSubagentLabel(filePath).catch(() => undefined)
          : undefined;
        await handlers.onSessionStart({
          source: this.source,
          sessionId,
          configDir,
          events,
          nameOverride,
        });
      },

      onSessionUpdate: (sessionId, _filePath, newContent, configDir) => {
        const events: ParsedEvent[] = [];
        for (const line of newContent.split('\n')) {
          if (line.trim() === '') continue;
          const ev = parseJsonlLine(line);
          if (ev !== null) events.push(ev);
        }
        if (events.length === 0) return;
        handlers.onSessionEvents({
          source: this.source,
          sessionId,
          configDir,
          events,
        });
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
}
