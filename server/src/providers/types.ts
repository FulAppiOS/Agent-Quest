import type { AgentSource } from '../types';
import type { ParsedEvent } from '../parsers/session-parser';

export interface SessionStartPayload {
  source: AgentSource;
  sessionId: string;
  configDir: string;
  events: ParsedEvent[];
  /** Optional name override resolved by the provider (e.g. Claude subagent label). */
  nameOverride?: string;
}

export interface SessionEventsPayload {
  source: AgentSource;
  sessionId: string;
  configDir: string;
  /** Incremental events since the last update. */
  events: ParsedEvent[];
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
