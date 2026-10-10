// server/src/parsers/cursor-parser.ts
//
// Parses Cursor (IDE) agent-chat transcripts, discovered under
// `~/.cursor/projects/<encoded-project-path>/agent-transcripts/<uuid>/<uuid>.jsonl`.
//
// Format (verified empirically on a real install, 2026-08-24):
//   - message lines:  {"role":"user"|"assistant","message":{"content":[blocks]}}
//       blocks are {type:"text"} or {type:"tool_use", name, input} (no `id`, no
//       tool_result blocks, no per-line timestamp).
//   - turn-end lines: {"type":"turn_ended","status":"success"|"error"[,"error":...]}
//
// Cursor transcripts carry no timestamps, no token usage, no model id and no
// subagent markers, so events are stamped by the provider (file mtime / Date.now()
// at read time) and the token/model/subagent fields are left undefined.
import { existsSync } from 'node:fs';
import type { AgentActivity, ToolCall } from '../types';
import type { ParsedEvent } from './session-parser';

const READING_TOOLS = new Set(['Read', 'ReadFile', 'Grep', 'Glob', 'rg']);
const EDITING_TOOLS = new Set(['Write', 'StrReplace', 'Edit', 'ApplyPatch', 'Delete']);
const REVIEWING_TOOLS = new Set(['Task', 'Subagent']);
const GIT_COMMAND_PATTERN = /\bgit\s+(commit|push|merge|rebase|cherry-pick)\b/;

export interface CursorLineMeta {
  sessionId: string;
  cwd: string;
  /** Wall-clock stamped by the provider — Cursor lines carry no timestamp. */
  timestamp: number;
}

interface CursorRawLine {
  role?: unknown;
  type?: unknown;
  status?: unknown;
  message?: { content?: unknown };
}

interface CursorTextBlock { type: 'text'; text?: unknown }
interface CursorToolUseBlock {
  type: 'tool_use';
  name?: unknown;
  input?: unknown;
}
type CursorContentBlock = CursorTextBlock | CursorToolUseBlock;

function toolNameToActivity(name: string, input: Record<string, unknown>): AgentActivity {
  if (READING_TOOLS.has(name)) return 'reading';
  if (EDITING_TOOLS.has(name)) return 'editing';
  if (REVIEWING_TOOLS.has(name)) return 'reviewing';
  if (name === 'Shell' || name === 'Bash') {
    const cmd = input['command'];
    if (typeof cmd === 'string' && GIT_COMMAND_PATTERN.test(cmd)) return 'git';
    return 'bash';
  }
  return 'thinking';
}

/** Extract a human-readable detail string from a tool_use block, if any. */
function toolDetail(name: string, input: Record<string, unknown>): string | undefined {
  if (name === 'Shell' || name === 'Bash') {
    const cmd = input['command'];
    return typeof cmd === 'string' ? cmd : undefined;
  }
  const filePath = input['path'] ?? input['file_path'];
  return typeof filePath === 'string' ? filePath : undefined;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function extractTexts(blocks: CursorContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
      parts.push(b.text);
    }
  }
  return parts.join('\n');
}

/** Pull the innermost `<user_query>` body out of a user message, if present. */
function extractUserQuery(text: string): string | undefined {
  const m = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
  return m?.[1];
}

/** Decode a Cursor project dir name (`path` with `/` → `-`) back into an absolute cwd. */
export function decodeProjectDir(
  name: string,
  exists: (p: string) => boolean = existsSync,
): string {
  const parts = name.split('-');
  let current = '/';
  let i = 0;
  while (i < parts.length) {
    let matched = false;
    // Greedy: try the longest dash-joined prefix that exists on disk.
    for (let j = parts.length; j > i; j--) {
      const candidate = current + parts.slice(i, j).join('-');
      if (exists(candidate) && j > i) {
        current = candidate + '/';
        i = j;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // No further existing segment — treat the remaining parts as one
      // opaque (unverifiable) tail and stop.
      current += parts.slice(i).join('-');
      break;
    }
  }
  return current.replace(/\/$/, '');
}

export function parseCursorLine(raw: string, meta: CursorLineMeta): ParsedEvent | null {
  let line: CursorRawLine;
  try {
    line = JSON.parse(raw) as CursorRawLine;
  } catch {
    return null;
  }

  // Turn-end marker.
  if (line.type === 'turn_ended') {
    return {
      sessionId: meta.sessionId,
      slug: undefined,
      timestamp: meta.timestamp,
      activity: 'idle',
      toolCalls: [],
      file: undefined,
      command: undefined,
      cwd: meta.cwd,
      kind: 'tool',
      isTurnEnd: true,
      hasError: line.status !== 'success',
    };
  }

  // Message line. Requirements: `role` and `message.content` present.
  if (typeof line.role !== 'string') return null;
  const msg = line.message;
  if (msg === undefined || msg === null || typeof msg !== 'object') return null;
  if (!Array.isArray(msg.content)) return null;

  const blocks = msg.content as CursorContentBlock[];
  const role = line.role;

  if (role === 'user') {
    const text = extractTexts(blocks);
    if (text.length === 0) return null;
    const currentTask = extractUserQuery(text) ?? text;
    return {
      sessionId: meta.sessionId,
      slug: undefined,
      timestamp: meta.timestamp,
      activity: 'thinking',
      toolCalls: [],
      file: undefined,
      command: undefined,
      cwd: meta.cwd,
      kind: 'task',
      currentTask,
    };
  }

  if (role === 'assistant') {
    const toolBlocks = blocks.filter((b): b is CursorToolUseBlock => b.type === 'tool_use');
    const text = extractTexts(blocks);

    if (toolBlocks.length === 0) {
      // Text-only assistant line: a partial reply. Track lastMessage only.
      const lastMessage = text.length > 0 ? text : undefined;
      if (lastMessage === undefined) return null;
      return {
        sessionId: meta.sessionId,
        slug: undefined,
        timestamp: meta.timestamp,
        activity: 'thinking',
        toolCalls: [],
        file: undefined,
        command: undefined,
        cwd: meta.cwd,
        kind: 'tool',
        lastMessage,
      };
    }

    const first = toolBlocks[0]!;
    const firstInput = asRecord(first.input);
    const firstName = typeof first.name === 'string' ? first.name : 'unknown';
    const activity = toolNameToActivity(firstName, firstInput);

    const toolCalls: ToolCall[] = toolBlocks.map((tb, index) => {
      const name = typeof tb.name === 'string' ? tb.name : 'unknown';
      const input = asRecord(tb.input);
      return {
        id: `cursor-${meta.timestamp}-${index}`,
        name,
        timestamp: meta.timestamp,
        input,
      };
    });

    const detail = toolDetail(firstName, firstInput);
    const event: ParsedEvent = {
      sessionId: meta.sessionId,
      slug: undefined,
      timestamp: meta.timestamp,
      activity,
      toolCalls,
      file: undefined,
      command: undefined,
      cwd: meta.cwd,
      kind: 'tool',
    };
    if (detail !== undefined) {
      if (firstName === 'Shell' || firstName === 'Bash') {
        event.command = detail;
      } else {
        event.file = detail;
      }
    }
    return event;
  }

  return null;
}

export function parseCursorFile(contents: string, meta: CursorLineMeta): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const line of contents.split('\n')) {
    if (line.trim() === '') continue;
    const ev = parseCursorLine(line, meta);
    if (ev !== null) out.push(ev);
  }
  return out;
}