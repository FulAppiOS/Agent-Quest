// server/src/parsers/codex-types.ts

/**
 * Wrapper shape. Every line in a Codex rollout-*.jsonl file matches this top level.
 * `payload` shape depends on `type` — we only narrow the payloads we care about.
 *
 * Top-level `type` values seen across Codex versions:
 *   'session_meta' | 'event_msg' | 'response_item' | 'turn_context' | 'compacted'
 *   | 'token_usage_record' | 'world_state' | ...
 */
export interface CodexRawLine {
  timestamp: string;
  type: string;
  payload?: unknown;
}

export interface CodexSessionMetaPayload {
  id: string;
  timestamp: string;
  cwd: string;
  originator: string;
  cli_version: string;
  /** Legacy: a plain string ('vscode'); ≥ 0.150: an object, e.g. `{ subagent: { thread_spawn: {...} } }`. */
  source: unknown;
  model_provider: string;
  /** 'user' | 'subagent' | 'voice_chat' (≥ 0.150). */
  thread_source?: string;
  /** Parent rollout id for subagent threads (≥ 0.150). */
  parent_thread_id?: string;
  agent_nickname?: string;
  agent_path?: string;
  // base_instructions/dynamic_tools intentionally omitted — huge, irrelevant
}

export interface CodexParsedCmdEntry {
  type: 'read' | 'search' | 'list_files' | 'unknown' | string;
  cmd?: string;
}

export interface CodexExecCommandEnd {
  type: 'exec_command_end';
  call_id?: string;
  process_id?: string;
  turn_id?: string;
  command: string[];         // ["/bin/zsh", "-lc", "git status"]
  cwd?: string;
  parsed_cmd?: CodexParsedCmdEntry[];
  stdout?: string;
  stderr?: string;
  aggregated_output?: string;
  exit_code?: number;
  duration?: { secs: number; nanos: number };
}

export interface CodexPatchApplyEnd {
  type: 'patch_apply_end';
  call_id?: string;
  turn_id?: string;
  success?: boolean;
  // Payload is version-tolerant: may carry `changes` (map path→op) or `files` (array).
  // Keep loose typing; extract in the parser.
  [key: string]: unknown;
}

export interface CodexUserMessage {
  type: 'user_message';
  message: string;
  kind?: string;
}

export interface CodexAgentMessage {
  type: 'agent_message';
  message: string;
}

export interface CodexTaskStarted {
  type: 'task_started';
  turn_id?: string;
  /** Model context window in tokens (≥ 0.120). */
  model_context_window?: number;
}

export interface CodexTaskComplete {
  type: 'task_complete';
  turn_id?: string;
  last_agent_message?: string;
  completed_at?: number;
  duration_ms?: number;
}

export interface CodexTurnAborted {
  type: 'turn_aborted';
  turn_id?: string;
  reason?: string;
}

export interface CodexWebSearchEnd {
  type: 'web_search_end';
  call_id?: string;
  query?: string;
}

export interface CodexReasoning {
  type: 'reasoning';
  text?: string;
}

export interface CodexThreadNameUpdated {
  type: 'thread_name_updated';
  name?: string;
}

/** Per-response token accounting; `info` is null on rate-limit-only updates. */
export interface CodexTokenCount {
  type: 'token_count';
  info?: {
    total_token_usage?: CodexTokenUsage;
    last_token_usage?: CodexTokenUsage;
    model_context_window?: number;
  } | null;
  rate_limits?: unknown;
}

export interface CodexTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

/**
 * Codex ≥ 0.160 wraps every completed item (user message, command, file change,
 * MCP call, …) in this event; the legacy per-kind events above no longer appear.
 * `item.type` is one of: UserMessage | AgentMessage | Reasoning | CommandExecution
 * | FileChange | WebSearch | Extension | McpToolCall | ImageView | SubAgentActivity
 * | CollabAgentToolCall | ContextCompaction | FunctionCallOutput.
 */
export interface CodexItemCompleted {
  type: 'item_completed';
  thread_id?: string;
  turn_id?: string;
  item?: unknown;
  started_at_ms?: number;
  completed_at_ms?: number;
}

export type CodexEventMsgPayload =
  | CodexUserMessage
  | CodexAgentMessage
  | CodexTaskStarted
  | CodexTaskComplete
  | CodexTurnAborted
  | CodexExecCommandEnd
  | CodexPatchApplyEnd
  | CodexWebSearchEnd
  | CodexReasoning
  | CodexThreadNameUpdated
  | CodexTokenCount
  | CodexItemCompleted
  | { type: string; [key: string]: unknown }; // unknown event types pass through
