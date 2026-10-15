import type { AgentSource } from '../types';
import type { ParsedEvent } from '../parsers/session-parser';

export interface SessionStartPayload {
  source: AgentSource;
  sessionId: string;
  configDir: string;
  events: ParsedEvent[];
  /** Optional name override resolved by the provider (e.g. Claude subagent label, Codex agent nickname). */
  nameOverride?: string;
  /** True for subagent sessions (Claude `agent-*` transcripts, Codex `thread_source: 'subagent'` rollouts). */
  isSubagent?: boolean;
  /** Session id of the parent agent, when the provider can derive it. */
  parentId?: string;
  /** Subagent role: Claude meta.json `agentType`, or the basename of a Codex agent path. */
  subagentType?: string;
  /** True for ultra-mode Workflow agents (transcripts under `subagents/workflows/wf_<runId>`). */
  isWorkflow?: boolean;
  /** The parent's `Agent` tool_use id that spawned this subagent (Claude meta.json). */
  spawnToolUseId?: string;
  /** Model configured in the provider's settings (e.g. `claude-fable-5-1[1m]`) — hints the context window. */
  configuredModel?: string;
}

export interface SessionEventsPayload {
  source: AgentSource;
  sessionId: string;
  configDir: string;
  /** Incremental events since the last update. */
  events: ParsedEvent[];
  /**
   * Same session facts as on start. A file first seen as too old and later
   * resumed only ever flows through this payload, so providers repeat the
   * facts here for the state manager to create the agent correctly.
   */
  nameOverride?: string;
  isSubagent?: boolean;
  parentId?: string;
  subagentType?: string;
  isWorkflow?: boolean;
  spawnToolUseId?: string;
  configuredModel?: string;
}

export interface ProviderHandlers {
  onSessionStart: (payload: SessionStartPayload) => void | Promise<void>;
  onSessionEvents: (payload: SessionEventsPayload) => void;
}

export interface SessionProvider {
  readonly source: AgentSource;
  start(handlers: ProviderHandlers): Promise<void>;
  stop(): void;
  /** Directories currently being monitored (for the WS snapshot). */
  getConfigDirs(): readonly string[];
}
