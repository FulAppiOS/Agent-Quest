import type { AgentActivity, JsonlLine, JsonlToolResult, JsonlToolUse, ToolCall } from '../types';
import { parsePluginTool } from './plugin-tool';

/**
 * First line of the synthetic user message Claude Code injects right after a
 * `Skill` tool call: the skill body that actually enters the context.
 */
export const SKILL_BODY_PREFIX = 'Base directory for this skill: ';

const TOOL_ACTIVITY_MAP: Record<string, AgentActivity> = {
  Read: 'reading',
  Grep: 'reading',
  Glob: 'reading',
  Edit: 'editing',
  Write: 'editing',
  Bash: 'bash',
  NotebookEdit: 'editing',
  // Dispatching a subagent (Task/code review/etc.) → Watchtower.
  Agent: 'reviewing',
};

// Match write-oriented git subcommands anywhere in the Bash command (covers
// `git add … && git commit …`, `cd repo && git push`, heredoc'd commits, etc.).
// Read-only subcommands like `git status`/`log`/`diff` intentionally stay as 'bash'.
const GIT_COMMAND_PATTERN = /\bgit\s+(commit|push|merge|rebase|cherry-pick)\b/;

export function toolNameToActivity(toolName: string): AgentActivity {
  return TOOL_ACTIVITY_MAP[toolName] ?? 'thinking';
}

function asNonNegInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * Parse Claude's `message.usage` block into the four *billable* token buckets.
 * Cache READ tokens (`cache_read_input_tokens`, billed at 0.1× input) and cache
 * WRITE tokens (`cache_creation_input_tokens`, billed at 1.25×–2× input) are kept
 * SEPARATE: writes are 12.5–20× more expensive than reads, so folding them into
 * a single "cached" bucket and pricing it at the read rate massively misprices a
 * session (the old behaviour). Returns undefined when there's no usable usage
 * data so we don't manufacture zero rows.
 */
export function parseUsage(
  usage: unknown,
): { input: number; output: number; cacheRead: number; cacheWrite: number } | undefined {
  if (usage === null || typeof usage !== 'object') return undefined;
  const u = usage as Record<string, unknown>;
  const input = asNonNegInt(u['input_tokens']);
  const output = asNonNegInt(u['output_tokens']);
  const cacheRead = asNonNegInt(u['cache_read_input_tokens']);
  const cacheWrite = asNonNegInt(u['cache_creation_input_tokens']);
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) return undefined;
  return { input, output, cacheRead, cacheWrite };
}

export function extractFileFromToolUse(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  if (toolName === 'Bash') {
    const cmd = input['command'];
    return typeof cmd === 'string' ? cmd : undefined;
  }
  const filePath = input['file_path'];
  return typeof filePath === 'string' ? filePath : undefined;
}

export interface ParsedEvent {
  sessionId: string;
  slug: string | undefined;
  timestamp: number;
  activity: AgentActivity;
  toolCalls: ToolCall[];
  file: string | undefined;
  command: string | undefined;
  cwd: string | undefined;
  lastMessage?: string;
  /**
   * Discriminator: 'tool' from assistant tool_use, 'task' from user prompts /
   * last-prompt updates, 'telemetry' for lines that only carry accounting data
   * (tool results, skill bodies, token counts, compaction markers). Telemetry
   * events never touch status, activity or lifecycle timers.
   */
  kind?: 'tool' | 'task' | 'telemetry';
  /** Skill/plugin Claude Code attributes this assistant line to. */
  attribution?: { skill?: string; plugin?: string };
  /** Skills invoked on this line (Claude `Skill` tool, Codex `SKILL.md` reads). */
  skillInvocations?: string[];
  /** A skill body that entered the context: its on-disk path (when known) and size. */
  skillLoad?: { name?: string; path?: string; chars: number };
  /** Plugin / MCP tool calls on this line; `resultChars` when the result is already known (Codex). */
  pluginCalls?: Array<{ name: string; kind: 'plugin' | 'mcp'; toolUseId?: string; resultChars?: number }>;
  /** Tool results carried by a user line, with their text size in characters. */
  toolResults?: Array<{ toolUseId: string; chars: number }>;
  /** Context-window sample: tokens in use and/or the model's window size. */
  contextSample?: { used?: number; window?: number };
  /** True when this line marks a context compaction. */
  isCompaction?: boolean;
  /** Result of a background subagent delivered to the parent as a task-notification. */
  taskNotification?: { toolUseId: string; resultChars: number };
  /** Current user prompt — populated on 'task' events only. */
  currentTask?: string;
  /** True when assistant message has only text blocks (turn ended, awaiting user). */
  isTurnEnd?: boolean;
  /** True when this user-message line carried at least one tool_result with is_error:true. */
  hasError?: boolean;
  /**
   * True when this event was synthesized from a session-state dump (e.g. `last-prompt`)
   * rather than a timestamped user/assistant message. The state manager must not use it
   * to create agents or advance `lastEvent` — those dumps are re-appended by Claude Code
   * to historical JSONLs on resume and would otherwise resurrect long-dead sessions.
   */
  isResumeHint?: boolean;
  /**
   * Model id from `message.model` on Claude assistant lines (e.g. `claude-opus-4-6`).
   * Populated only on assistant events; the state manager carries forward the last
   * seen value so a mid-session model change is reflected.
   */
  model?: string;
  /**
   * Token usage from a Claude assistant line's `message.usage`. Per-message and
   * additive across the session (each turn's `input` re-bills the context — that
   * is the real cost basis, so the state manager sums these). Undefined for
   * lines without usage and for Codex (which doesn't report tokens).
   */
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /**
   * The assistant `message.id`. Claude splits one logical assistant message
   * across several JSONL lines (one per content block) that all repeat the same
   * `usage`, so the state manager dedupes token accounting by this id to avoid
   * counting a message's tokens 2-3×.
   */
  usageMessageId?: string;
}

interface LastPromptLine {
  type: 'last-prompt';
  lastPrompt?: string;
  sessionId: string;
}

function isSlashCommandArtefact(content: string): boolean {
  return content.startsWith('<command-') || content.startsWith('<local-command-');
}

const TASK_NOTIFICATION_PREFIX = '<task-notification>';

/**
 * Parse the `<task-notification>` block Claude Code enqueues as a user message
 * when a background subagent finishes. Returns the parent's `Agent` tool_use id
 * and the size of the `<result>` text (what re-enters the parent context).
 */
export function parseTaskNotification(text: string): { toolUseId: string; resultChars: number } | null {
  if (!text.startsWith(TASK_NOTIFICATION_PREFIX)) return null;
  const idMatch = text.match(/<tool-use-id>([^<]+)<\/tool-use-id>/);
  if (idMatch === null || idMatch[1] === undefined) return null;
  const resultMatch = text.match(/<result>([\s\S]*?)<\/result>/);
  const resultChars = resultMatch?.[1]?.length ?? 0;
  return { toolUseId: idMatch[1], resultChars };
}

/** Size in characters of a tool_result's text content (image/other blocks don't count). */
function toolResultChars(content: JsonlToolResult['content']): number {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const block of content) {
    if (typeof block === 'object' && block !== null && typeof block.text === 'string') total += block.text.length;
  }
  return total;
}

/** Build an event that carries only accounting data (see `ParsedEvent.kind`). */
function telemetryEvent(line: JsonlLine, extra: Partial<ParsedEvent>): ParsedEvent {
  return {
    sessionId: line.sessionId,
    slug: line.slug,
    timestamp: new Date(line.timestamp).getTime(),
    activity: 'idle',
    toolCalls: [],
    file: undefined,
    command: undefined,
    cwd: line.cwd,
    kind: 'telemetry',
    ...extra,
  };
}

export function parseJsonlLine(raw: string): ParsedEvent | null {
  let parsed: JsonlLine | LastPromptLine;
  try {
    parsed = JSON.parse(raw) as JsonlLine | LastPromptLine;
  } catch {
    return null;
  }

  if (parsed.type === 'last-prompt') {
    const p = parsed as LastPromptLine;
    if (typeof p.lastPrompt !== 'string' || p.lastPrompt.length === 0) return null;
    // Sentinel timestamp 0 + isResumeHint flag: Claude Code re-appends this line to
    // historical JSONL files on resume, so trusting Date.now() here would make
    // long-dead sessions look freshly active. The real user prompt arrives via a
    // properly-timestamped `type:'user'` line.
    return {
      sessionId: p.sessionId,
      slug: undefined,
      timestamp: 0,
      activity: 'idle',
      toolCalls: [],
      file: undefined,
      command: undefined,
      cwd: undefined,
      kind: 'task',
      currentTask: p.lastPrompt,
      isResumeHint: true,
    };
  }

  const userLine = parsed as JsonlLine;

  // Compaction markers: the system boundary line and the user line carrying the
  // post-compaction summary. Neither is activity — the summary text is not a prompt.
  if (userLine.type === 'system') {
    return userLine.subtype === 'compact_boundary' ? telemetryEvent(userLine, { isCompaction: true }) : null;
  }
  if (userLine.type === 'user' && userLine.isCompactSummary === true) {
    return telemetryEvent(userLine, { isCompaction: true });
  }

  // User-typed prompts (string content). Surfacing these lets the hero react the
  // moment the user hits Enter, instead of waiting for the first assistant
  // response (which on Opus with reasoning can be 30–90s later).
  if (userLine.type === 'user' && userLine.message?.role === 'user' && typeof userLine.message.content === 'string') {
    const content = userLine.message.content;
    if (userLine.isMeta === true || content.length === 0 || isSlashCommandArtefact(content)) {
      return null;
    }
    // A background subagent finishing is delivered as a user message: accounting
    // data for the parent, not something the user typed.
    const notification = parseTaskNotification(content);
    if (notification !== null) {
      return telemetryEvent(userLine, { taskNotification: notification });
    }
    return {
      sessionId: userLine.sessionId,
      slug: userLine.slug,
      timestamp: new Date(userLine.timestamp).getTime(),
      activity: 'thinking',
      toolCalls: [],
      file: undefined,
      command: undefined,
      cwd: userLine.cwd,
      kind: 'task',
      currentTask: content,
    };
  }

  // User-role messages with block content: tool results (sizes feed plugin and
  // subagent accounting; errors flag debugging) or a synthetic skill body.
  if (userLine.type === 'user' && userLine.message?.role === 'user' && Array.isArray(userLine.message.content)) {
    const blocks = userLine.message.content;
    const toolResults: Array<{ toolUseId: string; chars: number }> = [];
    let hasError = false;
    for (const b of blocks) {
      if (typeof b !== 'object' || b === null || b.type !== 'tool_result') continue;
      const r = b as JsonlToolResult & { is_error?: boolean };
      if (r.is_error === true) hasError = true;
      toolResults.push({ toolUseId: r.tool_use_id, chars: toolResultChars(r.content) });
    }
    if (hasError) {
      return {
        sessionId: userLine.sessionId,
        slug: userLine.slug,
        timestamp: new Date(userLine.timestamp).getTime(),
        activity: 'debugging',
        toolCalls: [],
        file: undefined,
        command: undefined,
        cwd: userLine.cwd,
        kind: 'tool',
        hasError: true,
        toolResults,
      };
    }
    if (toolResults.length > 0) {
      return telemetryEvent(userLine, { toolResults });
    }
    if (userLine.isMeta === true) {
      const first = blocks[0] as { type?: string; text?: unknown } | undefined;
      const text = first !== undefined && typeof first.text === 'string' ? first.text : undefined;
      if (text !== undefined && text.startsWith(SKILL_BODY_PREFIX)) {
        const pathEnd = text.indexOf('\n');
        const path = text.slice(SKILL_BODY_PREFIX.length, pathEnd === -1 ? undefined : pathEnd).trim();
        return telemetryEvent(userLine, { skillLoad: { path, chars: text.length } });
      }
    }
    return null;
  }

  const asst = parsed as JsonlLine;
  if (asst.type !== 'assistant' || asst.message?.role !== 'assistant') {
    return null;
  }

  const content = asst.message.content;
  if (!Array.isArray(content)) {
    return null;
  }

  const toolCalls: ToolCall[] = [];
  const skillInvocations: string[] = [];
  const pluginCalls: NonNullable<ParsedEvent['pluginCalls']> = [];
  let activity: AgentActivity = 'thinking';
  let file: string | undefined;
  let command: string | undefined;

  // Extract last text content from assistant message
  let lastMessage: string | undefined;
  for (const block of content) {
    if (typeof block === 'object' && block !== null && block.type === 'text' && 'text' in block) {
      const textBlock = block as { type: string; text: string };
      lastMessage = textBlock.text;
    }
  }

  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;

    if (block.type === 'tool_use') {
      const tu = block as unknown as JsonlToolUse;
      const ts = new Date(asst.timestamp).getTime();

      toolCalls.push({
        id: tu.id,
        name: tu.name,
        timestamp: ts,
        input: tu.input,
      });

      if (tu.name === 'Skill' && typeof tu.input['skill'] === 'string' && tu.input['skill'].length > 0) {
        skillInvocations.push(tu.input['skill']);
      }
      const plugin = parsePluginTool(tu.name);
      if (plugin !== null) {
        pluginCalls.push({ name: plugin.name, kind: plugin.kind, toolUseId: tu.id });
      }

      // Determine activity — git detection overrides Bash
      if (
        tu.name === 'Bash' &&
        typeof tu.input['command'] === 'string' &&
        GIT_COMMAND_PATTERN.test(tu.input['command'])
      ) {
        activity = 'git';
        command = tu.input['command'];
      } else {
        const mapped = toolNameToActivity(tu.name);
        // Only override if we haven't already set a more specific activity
        if (activity === 'thinking') {
          activity = mapped;
        }
      }

      const extracted = extractFileFromToolUse(tu.name, tu.input);
      if (extracted !== undefined) {
        if (tu.name === 'Bash') {
          command = extracted;
        } else {
          file = extracted;
        }
      }
    }
  }

  // Turn end: assistant message has text output but no tool_use → awaiting user input.
  const isTurnEnd = toolCalls.length === 0 && lastMessage !== undefined;

  const model = typeof asst.message.model === 'string' && asst.message.model.length > 0
    ? asst.message.model
    : undefined;

  const usage = parseUsage(asst.message.usage);
  const usageMessageId = typeof asst.message.id === 'string' && asst.message.id.length > 0
    ? asst.message.id
    : undefined;

  const attributionSkill = typeof asst.attributionSkill === 'string' && asst.attributionSkill.length > 0
    ? asst.attributionSkill
    : undefined;
  const attributionPlugin = typeof asst.attributionPlugin === 'string' && asst.attributionPlugin.length > 0
    ? asst.attributionPlugin
    : undefined;
  const attribution = attributionSkill !== undefined || attributionPlugin !== undefined
    ? { skill: attributionSkill, plugin: attributionPlugin }
    : undefined;

  return {
    sessionId: asst.sessionId,
    slug: asst.slug,
    timestamp: new Date(asst.timestamp).getTime(),
    activity,
    toolCalls,
    file,
    command,
    cwd: asst.cwd,
    lastMessage,
    kind: 'tool',
    isTurnEnd,
    model,
    usage,
    usageMessageId,
    attribution,
    skillInvocations: skillInvocations.length > 0 ? skillInvocations : undefined,
    pluginCalls: pluginCalls.length > 0 ? pluginCalls : undefined,
  };
}

/**
 * Parse an entire JSONL file contents and return all events in order.
 */
export function parseSessionFile(contents: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  for (const line of contents.split('\n')) {
    if (line.trim() === '') continue;
    const event = parseJsonlLine(line);
    if (event !== null) {
      events.push(event);
    }
  }
  return events;
}
