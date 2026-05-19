import type { AgentSource, SubagentContext } from '../types';
import type { ParsedEvent } from '../parsers/session-parser';

export interface SessionStartPayload {
  source: AgentSource;
  sessionId: string;
  configDir: string;
  events: ParsedEvent[];
  /** Optional name override resolved by the provider (e.g. Claude subagent label). */
  nameOverride?: string;
  /**
   * Subagent context resolved by the provider — `isSubagent` is always set;
   * `parentSessionId` is set only when discoverable from disk layout.
   * Defaults to `{ isSubagent: false }` for main sessions and for providers
   * that have no sub-agent concept (e.g. Codex).
   */
  subagentCtx?: SubagentContext;
}

export interface SessionEventsPayload {
  source: AgentSource;
  sessionId: string;
  configDir: string;
  /** Incremental events since the last update. */
  events: ParsedEvent[];
  /**
   * Subagent context — propagated on updates so that any first-event-on-update
   * path (extremely rare) sees the same metadata. Existing agents already have
   * the fields set from `onSessionStart`.
   */
  subagentCtx?: SubagentContext;
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
