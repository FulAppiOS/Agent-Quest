import type { AgentActivity, JsonlLine, JsonlToolUse, ToolCall } from '../types';

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
  /** Discriminator: 'tool' from assistant tool_use, 'task' from last-prompt updates. */
  kind?: 'tool' | 'task';
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
}

interface LastPromptLine {
  type: 'last-prompt';
  lastPrompt?: string;
  sessionId: string;
}

function isSlashCommandArtefact(content: string): boolean {
  return content.startsWith('<command-') || content.startsWith('<local-command-');
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

  const userLine = parsed as JsonlLine & { isMeta?: boolean };

  // User-typed prompts (string content). Surfacing these lets the hero react the
  // moment the user hits Enter, instead of waiting for the first assistant
  // response (which on Opus with reasoning can be 30–90s later).
  if (userLine.type === 'user' && userLine.message?.role === 'user' && typeof userLine.message.content === 'string') {
    const content = userLine.message.content;
    if (userLine.isMeta === true || content.length === 0 || isSlashCommandArtefact(content)) {
      return null;
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

  // User-role messages may carry tool_result blocks that signal tool errors.
  if (userLine.type === 'user' && userLine.message?.role === 'user' && Array.isArray(userLine.message.content)) {
    const hasError = userLine.message.content.some((b) => {
      if (typeof b !== 'object' || b === null) return false;
      if (b.type !== 'tool_result') return false;
      const r = b as { is_error?: boolean };
      return r.is_error === true;
    });
    if (!hasError) return null;
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
    };
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
