// server/src/parsers/codex-parser.ts
import type { AgentActivity, ToolCall } from '../types';
import type { ParsedEvent } from './session-parser';
import type {
  CodexRawLine,
  CodexEventMsgPayload,
  CodexExecCommandEnd,
  CodexPatchApplyEnd,
  CodexTaskComplete,
  CodexTaskStarted,
  CodexTokenCount,
  CodexUserMessage,
  CodexWebSearchEnd,
  CodexItemCompleted,
  CodexParsedCmdEntry,
} from './codex-types';

const GIT_COMMAND_PATTERN = /\bgit\s+(commit|push|merge|rebase|cherry-pick)\b/;

/** A shell command that reads a skill body: `cat ~/.codex/skills/<name>/SKILL.md`. */
export const SKILL_FILE_PATTERN = /skills\/([A-Za-z0-9_.-]+)\/SKILL\.md/;

interface LineContext {
  sessionId: string;
  sessionCwd: string;
  tsMs: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Codex sometimes JSON-encodes nested values as strings; accept both forms. */
function asJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v) as unknown; } catch { return v; }
}

function asStringArray(v: unknown): string[] {
  const parsed = asJson(v);
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
}

function asRecordArray(v: unknown): Record<string, unknown>[] {
  const parsed = asJson(v);
  return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
}

/** Codex writes `cwd`/`path` as `file://` URLs in item_completed events. */
function fileUrlToPath(s: string): string {
  if (!s.startsWith('file://')) return s;
  try {
    return decodeURIComponent(new URL(s).pathname);
  } catch {
    return s;
  }
}

/** Join the text blocks of a message content (array of `{type, text}`) or return a plain string. */
function joinText(content: unknown): string {
  const parsed = asJson(content);
  if (typeof parsed === 'string') return parsed;
  if (!Array.isArray(parsed)) return '';
  const parts: string[] = [];
  for (const block of parsed) {
    if (isRecord(block) && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

/** Size of an MCP tool result as it enters the context: text blocks when present, else the JSON. */
function mcpResultChars(result: unknown): number {
  const parsed = asJson(result);
  if (typeof parsed === 'string') return parsed.length;
  if (isRecord(parsed) && Array.isArray(parsed.content)) {
    let total = 0;
    for (const block of parsed.content) {
      if (isRecord(block) && typeof block.text === 'string') total += block.text.length;
    }
    return total;
  }
  return parsed === undefined || parsed === null ? 0 : JSON.stringify(parsed).length;
}

function telemetry(ctx: LineContext, extra: Partial<ParsedEvent>): ParsedEvent {
  return {
    sessionId: ctx.sessionId,
    slug: undefined,
    timestamp: ctx.tsMs,
    activity: 'idle',
    toolCalls: [],
    file: undefined,
    command: undefined,
    cwd: ctx.sessionCwd,
    kind: 'telemetry',
    ...extra,
  };
}

function toolEvent(ctx: LineContext, activity: AgentActivity, toolCalls: ToolCall[], extra: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    sessionId: ctx.sessionId,
    slug: undefined,
    timestamp: ctx.tsMs,
    activity,
    toolCalls,
    file: undefined,
    command: undefined,
    cwd: ctx.sessionCwd,
    kind: 'tool',
    isTurnEnd: false,
    ...extra,
  };
}

function taskEvent(ctx: LineContext, text: string): ParsedEvent {
  return {
    sessionId: ctx.sessionId,
    slug: undefined,
    timestamp: ctx.tsMs,
    activity: 'thinking',
    toolCalls: [],
    file: undefined,
    command: undefined,
    cwd: ctx.sessionCwd,
    kind: 'task',
    currentTask: text,
  };
}

function commandActivity(command: string, parsedFirst: CodexParsedCmdEntry | Record<string, unknown> | undefined): AgentActivity {
  if (GIT_COMMAND_PATTERN.test(command)) return 'git';
  const t = parsedFirst?.type;
  if (t === 'read' || t === 'search' || t === 'list_files') return 'reading';
  return 'bash';
}

/** Parse one line of a Codex rollout JSONL file. `null` when the line is noise or malformed. */
export function parseCodexLine(raw: string, sessionId: string, sessionCwd: string): ParsedEvent | null {
  let line: CodexRawLine;
  try {
    line = JSON.parse(raw) as CodexRawLine;
  } catch {
    return null;
  }

  // Noise we drop outright.
  if (line.type === 'session_meta') return null;
  if (line.type === 'response_item') return null;
  if (line.type === 'token_usage_record') return null;
  if (line.type === 'world_state') return null;

  const tsMs = new Date(line.timestamp).getTime();
  // Malformed/missing timestamp would poison lastEvent arithmetic and freeze
  // the hero in 'active' forever — drop the event instead.
  if (!Number.isFinite(tsMs)) return null;
  const ctx: LineContext = { sessionId, sessionCwd, tsMs };

  // Codex rewrote the history: the context just shrank.
  if (line.type === 'compacted') return telemetry(ctx, { isCompaction: true });

  // Per-turn settings carry the model id (Codex has no per-message model field).
  if (line.type === 'turn_context') {
    const model = isRecord(line.payload) && typeof line.payload.model === 'string' && line.payload.model.length > 0
      ? line.payload.model
      : undefined;
    return model !== undefined ? telemetry(ctx, { model }) : null;
  }

  if (line.type !== 'event_msg') return null;
  const payload = line.payload as CodexEventMsgPayload | undefined;
  if (payload === undefined) return null;

  switch (payload.type) {
    case 'token_count': {
      const info = (payload as CodexTokenCount).info;
      if (!isRecord(info)) return null;
      const last = isRecord(info.last_token_usage) ? info.last_token_usage : undefined;
      const input = typeof last?.input_tokens === 'number' ? last.input_tokens : 0;
      const output = typeof last?.output_tokens === 'number' ? last.output_tokens : 0;
      const window = typeof info.model_context_window === 'number' && info.model_context_window > 0
        ? info.model_context_window
        : undefined;
      if (last === undefined && window === undefined) return null;
      const sample: NonNullable<ParsedEvent['contextSample']> = {};
      // Right after a compaction Codex emits an all-zero `last_token_usage`;
      // folding that in would flash the bar to 0% and fake a drop.
      if (last !== undefined && input + output > 0) sample.used = input + output;
      if (window !== undefined) sample.window = window;
      if (sample.used === undefined && sample.window === undefined) return null;
      return telemetry(ctx, { contextSample: sample });
    }

    case 'task_started': {
      const window = (payload as CodexTaskStarted).model_context_window;
      return typeof window === 'number' && window > 0
        ? telemetry(ctx, { contextSample: { window } })
        : null;
    }

    case 'item_completed':
      return parseCodexItem((payload as CodexItemCompleted).item, ctx);

    // --- Legacy (Codex < 0.160) per-kind events ---------------------------

    case 'user_message': {
      const p = payload as CodexUserMessage;
      if (typeof p.message !== 'string' || p.message.length === 0) return null;
      return taskEvent(ctx, p.message);
    }

    // `agent_message` and `reasoning` fire INTERLEAVED with tool events during
    // a Codex turn (reasoning happens between every tool call; agent_message
    // is the final answer chunk). Emitting them as ParsedEvents with
    // `activity: 'thinking'` would override the tool activity mid-turn and
    // make the hero ping-pong between the Wizard Tower and the tool buildings.
    //
    // Drop both:
    //  - The "Reply" line in the activity feed is already populated from
    //    `task_complete.last_agent_message`, so no information is lost.
    //  - While Codex is silently reasoning between tool calls, the hero stays
    //    in the last tool building — same UX as Claude's assistant-with-
    //    thinking-blocks-between-tool-uses path.
    case 'agent_message':
    case 'reasoning':
      return null;

    case 'exec_command_end': {
      const p = payload as CodexExecCommandEnd;
      const command = Array.isArray(p.command) && p.command.length > 0
        ? stripShellWrapper(p.command)
        : '';
      const parsedFirst = Array.isArray(p.parsed_cmd) && p.parsed_cmd.length > 0 ? p.parsed_cmd[0] : undefined;
      const tc: ToolCall = {
        id: p.call_id ?? `codex-exec-${tsMs}`,
        name: 'Bash',
        timestamp: tsMs,
        input: { command },
      };
      return toolEvent(ctx, commandActivity(command, parsedFirst), [tc], { command, cwd: p.cwd ?? sessionCwd });
    }

    case 'patch_apply_end': {
      const p = payload as CodexPatchApplyEnd;
      return fileChangeEvent(ctx, extractChangedPaths(p), p.call_id ?? `codex-patch-${tsMs}`);
    }

    case 'web_search_end': {
      const p = payload as CodexWebSearchEnd;
      return webSearchEvent(ctx, p.query, p.call_id ?? `codex-web-${tsMs}`);
    }

    case 'task_complete': {
      const p = payload as CodexTaskComplete;
      const msg = typeof p.last_agent_message === 'string' ? p.last_agent_message : undefined;
      return {
        sessionId,
        slug: undefined,
        timestamp: tsMs,
        activity: 'idle',
        toolCalls: [],
        file: undefined,
        command: undefined,
        cwd: sessionCwd,
        kind: 'tool',
        lastMessage: msg,
        isTurnEnd: true,
      };
    }

    case 'turn_aborted': {
      return {
        sessionId,
        slug: undefined,
        timestamp: tsMs,
        activity: 'idle',
        toolCalls: [],
        file: undefined,
        command: undefined,
        cwd: sessionCwd,
        kind: 'tool',
        isTurnEnd: true,
      };
    }

    case 'thread_name_updated':
    case 'thread_settings_applied':
      return null;

    default:
      return null;
  }
}

/**
 * Map one `item_completed` item (Codex ≥ 0.160) onto the same ParsedEvent
 * shapes the legacy per-kind events produce, plus skill/plugin telemetry.
 */
function parseCodexItem(item: unknown, ctx: LineContext): ParsedEvent | null {
  if (!isRecord(item) || typeof item.type !== 'string') return null;
  const id = typeof item.id === 'string' && item.id.length > 0 ? item.id : `codex-item-${ctx.tsMs}`;

  switch (item.type) {
    case 'UserMessage': {
      const text = joinText(item.content);
      return text.length > 0 ? taskEvent(ctx, text) : null;
    }

    case 'CommandExecution': {
      const cmdParts = asStringArray(item.command);
      const command = cmdParts.length > 0 ? stripShellWrapper(cmdParts) : '';
      const parsedFirst = asRecordArray(item.parsed_cmd)[0];
      const cwd = typeof item.cwd === 'string' && item.cwd.length > 0 ? fileUrlToPath(item.cwd) : ctx.sessionCwd;
      const tc: ToolCall = { id, name: 'Bash', timestamp: ctx.tsMs, input: { command } };
      const extra: Partial<ParsedEvent> = { command, cwd };
      const skill = SKILL_FILE_PATTERN.exec(command);
      if (skill !== null && skill[1] !== undefined) {
        const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
        extra.skillInvocations = [skill[1]];
        extra.skillLoad = { name: skill[1], chars: output.length };
      }
      return toolEvent(ctx, commandActivity(command, parsedFirst), [tc], extra);
    }

    case 'FileChange':
      return fileChangeEvent(ctx, extractChangedPaths(item), id);

    case 'WebSearch':
      return webSearchEvent(ctx, typeof item.query === 'string' ? item.query : undefined, id);

    case 'Extension':
      if (item.kind !== 'web.search') return null;
      return webSearchEvent(ctx, typeof item.query === 'string' ? item.query : undefined, id);

    case 'McpToolCall': {
      const server = typeof item.server === 'string' ? item.server : 'mcp';
      const tool = typeof item.tool === 'string' ? item.tool : 'call';
      const pluginId = typeof item.pluginId === 'string' && item.pluginId.length > 0
        ? item.pluginId.split('@')[0] ?? item.pluginId
        : undefined;
      const tc: ToolCall = {
        id,
        name: `${server}.${tool}`,
        timestamp: ctx.tsMs,
        input: isRecord(item.arguments) ? item.arguments : {},
      };
      const activity: AgentActivity = item.readOnlyHint === true ? 'reading' : 'bash';
      return toolEvent(ctx, activity, [tc], {
        pluginCalls: [{
          name: pluginId ?? server,
          kind: pluginId !== undefined ? 'plugin' : 'mcp',
          toolUseId: id,
          resultChars: mcpResultChars(item.result),
        }],
      });
    }

    case 'SubAgentActivity': {
      if (item.kind !== 'started') return null;
      const tc: ToolCall = {
        id,
        name: 'Agent',
        timestamp: ctx.tsMs,
        input: {
          agent_path: typeof item.agent_path === 'string' ? item.agent_path : undefined,
          agent_thread_id: typeof item.agent_thread_id === 'string' ? item.agent_thread_id : undefined,
        },
      };
      return toolEvent(ctx, 'reviewing', [tc]);
    }

    case 'ImageView': {
      const path = typeof item.path === 'string' ? fileUrlToPath(item.path) : undefined;
      const tc: ToolCall = { id, name: 'Read', timestamp: ctx.tsMs, input: { file_path: path } };
      return toolEvent(ctx, 'reading', [tc], { file: path });
    }

    case 'ContextCompaction':
      return telemetry(ctx, { isCompaction: true });

    // Reasoning, AgentMessage, CollabAgentToolCall, FunctionCallOutput, …: no
    // hero movement and no accounting we can attribute — see the legacy note on
    // agent_message/reasoning above.
    default:
      return null;
  }
}

function fileChangeEvent(ctx: LineContext, paths: string[], baseId: string): ParsedEvent {
  const toolCalls: ToolCall[] = paths.map((filePath, i) => ({
    id: `${baseId}-${i}`,
    name: 'Edit',
    timestamp: ctx.tsMs,
    input: { file_path: filePath },
  }));
  if (toolCalls.length === 0) {
    // Fallback: emit a single generic edit event without path.
    toolCalls.push({ id: baseId, name: 'Edit', timestamp: ctx.tsMs, input: {} });
  }
  return toolEvent(ctx, 'editing', toolCalls, { file: paths[0] });
}

function webSearchEvent(ctx: LineContext, query: string | undefined, id: string): ParsedEvent {
  const tc: ToolCall = { id, name: 'Grep', timestamp: ctx.tsMs, input: { query: query ?? '' } };
  return toolEvent(ctx, 'reading', [tc], { command: query });
}

export function parseCodexFile(contents: string, sessionId: string, sessionCwd: string): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const line of contents.split('\n')) {
    if (line.trim() === '') continue;
    const ev = parseCodexLine(line, sessionId, sessionCwd);
    if (ev !== null) out.push(ev);
  }
  return out;
}

/** Session header from the first JSONL line of a rollout file. `null` if absent/malformed. */
export interface CodexSessionHeader {
  id: string;
  cwd: string;
  startedAt: number;
  /** True for rollouts spawned by `spawn_agent` (`thread_source: 'subagent'`). */
  isSubagent: boolean;
  /** Rollout id of the parent thread, for subagents. */
  parentThreadId?: string;
  /** Human-readable name Codex gives the subagent (e.g. `Copernicus`). */
  agentNickname?: string;
  /** Agent path, e.g. `/root/audit_project_docs` — its basename is the role. */
  agentPath?: string;
}

export function parseCodexSessionMeta(firstLine: string): CodexSessionHeader | null {
  try {
    const obj = JSON.parse(firstLine) as CodexRawLine;
    if (obj.type !== 'session_meta' || !isRecord(obj.payload)) return null;
    const p = obj.payload;
    if (typeof p.id !== 'string' || typeof p.cwd !== 'string') return null;
    const startedAt = typeof p.timestamp === 'string' ? new Date(p.timestamp).getTime() : new Date(obj.timestamp).getTime();

    // Parent linkage: top-level `parent_thread_id`, or nested in `source.subagent.thread_spawn`.
    let parentThreadId = typeof p.parent_thread_id === 'string' && p.parent_thread_id.length > 0 ? p.parent_thread_id : undefined;
    let agentPath = typeof p.agent_path === 'string' && p.agent_path.length > 0 ? p.agent_path : undefined;
    if (isRecord(p.source) && isRecord(p.source.subagent) && isRecord(p.source.subagent.thread_spawn)) {
      const spawn = p.source.subagent.thread_spawn;
      if (parentThreadId === undefined && typeof spawn.parent_thread_id === 'string') parentThreadId = spawn.parent_thread_id;
      if (agentPath === undefined && typeof spawn.agent_path === 'string') agentPath = spawn.agent_path;
    }
    const agentNickname = typeof p.agent_nickname === 'string' && p.agent_nickname.length > 0 ? p.agent_nickname : undefined;
    const isSubagent = p.thread_source === 'subagent' || parentThreadId !== undefined;

    return { id: p.id, cwd: p.cwd, startedAt, isSubagent, parentThreadId, agentNickname, agentPath };
  } catch {
    return null;
  }
}

function stripShellWrapper(cmd: string[]): string {
  // Codex serializes every command as ["/bin/zsh", "-lc", "<cmd>"] — unwrap when possible.
  if (cmd.length === 3 && /\/zsh$|\/bash$|\/sh$/.test(cmd[0] ?? '') && cmd[1] === '-lc') {
    return cmd[2] ?? '';
  }
  return cmd.join(' ');
}

/** Changed file paths from a patch/file-change payload. Schema is version-tolerant. */
function extractChangedPaths(payload: Record<string, unknown>): string[] {
  const out: string[] = [];

  const changes = asJson(payload.changes);
  if (isRecord(changes)) {
    for (const k of Object.keys(changes)) out.push(fileUrlToPath(k));
  }

  const files = asJson(payload.files);
  if (Array.isArray(files)) {
    for (const f of files) {
      if (typeof f === 'string') out.push(fileUrlToPath(f));
      else if (isRecord(f)) {
        const fp = f.path ?? f.file_path;
        if (typeof fp === 'string') out.push(fileUrlToPath(fp));
      }
    }
  }

  return out;
}
