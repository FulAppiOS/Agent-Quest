// server/src/parsers/codex-parser.ts
import type { AgentActivity, ToolCall } from '../types';
import type { ParsedEvent } from './session-parser';
import type {
  CodexRawLine,
  CodexEventMsgPayload,
  CodexExecCommandEnd,
  CodexPatchApplyEnd,
  CodexTaskComplete,
  CodexUserMessage,
  CodexAgentMessage,
  CodexReasoning,
  CodexWebSearchEnd,
} from './codex-types';

const GIT_COMMAND_PATTERN = /\bgit\s+(commit|push|merge|rebase|cherry-pick)\b/;

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
  if (line.type === 'token_count') return null;
  if (line.type === 'turn_context') return null;
  if (line.type === 'response_item') return null;

  if (line.type !== 'event_msg') return null;
  const payload = line.payload as CodexEventMsgPayload | undefined;
  if (payload === undefined) return null;

  const tsMs = new Date(line.timestamp).getTime();
  // Malformed/missing timestamp would poison lastEvent arithmetic and freeze
  // the hero in 'active' forever — drop the event instead.
  if (!Number.isFinite(tsMs)) return null;

  switch (payload.type) {
    case 'user_message': {
      const p = payload as CodexUserMessage;
      if (typeof p.message !== 'string' || p.message.length === 0) return null;
      return {
        sessionId,
        slug: undefined,
        timestamp: tsMs,
        activity: 'thinking',
        toolCalls: [],
        file: undefined,
        command: undefined,
        cwd: sessionCwd,
        kind: 'task',
        currentTask: p.message,
      };
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

      let activity: AgentActivity = 'bash';
      if (GIT_COMMAND_PATTERN.test(command)) {
        activity = 'git';
      } else if (parsedFirst?.type === 'read' || parsedFirst?.type === 'search' || parsedFirst?.type === 'list_files') {
        activity = 'reading';
      }

      const tc: ToolCall = {
        id: p.call_id ?? `codex-exec-${tsMs}`,
        name: 'Bash',
        timestamp: tsMs,
        input: { command },
      };

      return {
        sessionId,
        slug: undefined,
        timestamp: tsMs,
        activity,
        toolCalls: [tc],
        file: undefined,
        command,
        cwd: p.cwd ?? sessionCwd,
        kind: 'tool',
        isTurnEnd: false,
      };
    }

    case 'patch_apply_end': {
      const p = payload as CodexPatchApplyEnd;
      const paths = extractPatchFiles(p);
      const first = paths[0];
      const toolCalls: ToolCall[] = paths.map((filePath, i) => ({
        id: `${p.call_id ?? `codex-patch-${tsMs}`}-${i}`,
        name: 'Edit',
        timestamp: tsMs,
        input: { file_path: filePath },
      }));
      if (toolCalls.length === 0) {
        // Fallback: emit a single generic edit event without path.
        toolCalls.push({
          id: p.call_id ?? `codex-patch-${tsMs}`,
          name: 'Edit',
          timestamp: tsMs,
          input: {},
        });
      }
      return {
        sessionId,
        slug: undefined,
        timestamp: tsMs,
        activity: 'editing',
        toolCalls,
        file: first,
        command: undefined,
        cwd: sessionCwd,
        kind: 'tool',
        isTurnEnd: false,
      };
    }

    case 'web_search_end': {
      const p = payload as CodexWebSearchEnd;
      return {
        sessionId,
        slug: undefined,
        timestamp: tsMs,
        activity: 'reading',
        toolCalls: [{
          id: p.call_id ?? `codex-web-${tsMs}`,
          name: 'Grep',
          timestamp: tsMs,
          input: { query: p.query ?? '' },
        }],
        file: undefined,
        command: p.query,
        cwd: sessionCwd,
        kind: 'tool',
        isTurnEnd: false,
      };
    }

    case 'task_complete': {
      const p = payload as CodexTaskComplete;
      const msg = typeof p.last_agent_message === 'string' ? p.last_agent_message.slice(0, 300) : undefined;
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

    case 'task_started':
    case 'thread_name_updated':
      return null;

    default:
      return null;
  }
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

/** Extract session meta from the first JSONL line of a rollout file. Returns `null` if absent/malformed. */
export interface CodexSessionHeader {
  id: string;
  cwd: string;
  startedAt: number;
}
export function parseCodexSessionMeta(firstLine: string): CodexSessionHeader | null {
  try {
    const obj = JSON.parse(firstLine) as CodexRawLine;
    if (obj.type !== 'session_meta' || typeof obj.payload !== 'object' || obj.payload === null) return null;
    const p = obj.payload as { id?: unknown; cwd?: unknown; timestamp?: unknown };
    if (typeof p.id !== 'string' || typeof p.cwd !== 'string') return null;
    const startedAt = typeof p.timestamp === 'string' ? new Date(p.timestamp).getTime() : new Date(obj.timestamp).getTime();
    return { id: p.id, cwd: p.cwd, startedAt };
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

function extractPatchFiles(payload: CodexPatchApplyEnd): string[] {
  // Schema is version-tolerant. Check known shapes in order.
  const out: string[] = [];

  const changes = (payload as { changes?: unknown }).changes;
  if (changes !== null && typeof changes === 'object' && !Array.isArray(changes)) {
    for (const k of Object.keys(changes as Record<string, unknown>)) {
      if (typeof k === 'string') out.push(k);
    }
  }

  const files = (payload as { files?: unknown }).files;
  if (Array.isArray(files)) {
    for (const f of files) {
      if (typeof f === 'string') out.push(f);
      else if (typeof f === 'object' && f !== null) {
        const fp = (f as { path?: unknown; file_path?: unknown }).path ?? (f as { file_path?: unknown }).file_path;
        if (typeof fp === 'string') out.push(fp);
      }
    }
  }

  return out;
}
