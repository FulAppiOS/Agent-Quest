// server/src/parsers/codex-types.ts

/**
 * Wrapper shape. Every line in a Codex rollout-*.jsonl file matches this top level.
 * `payload` shape depends on `type` — we only narrow the payloads we care about.
 */
export interface CodexRawLine {
  timestamp: string;
  type: string; // 'session_meta' | 'event_msg' | 'response_item' | 'token_count' | 'turn_context' | ...
  payload?: unknown;
}

export interface CodexSessionMetaPayload {
  id: string;
  timestamp: string;
  cwd: string;
  originator: string;
  cli_version: string;
  source: string; // e.g. 'vscode'
  model_provider: string;
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
  | { type: string; [key: string]: unknown }; // unknown event types pass through
