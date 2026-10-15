// --- Hero classes (3 unit types, assigned cyclically) ---
export const HERO_CLASSES = ['warrior', 'archer', 'pawn'] as const;
export type HeroClass = (typeof HERO_CLASSES)[number];

// --- Hero colors (assigned cyclically, independent of class) ---
// Kept in sync with client/src/types/agent.ts — the state manager assigns
// round-robin across the full palette, the client maps each entry to a sprite
// base + optional tint. Add new entries on BOTH sides.
export const HERO_COLORS = [
  'blue', 'yellow', 'red', 'black', 'purple',
  'teal', 'orange', 'green',
] as const;
export type HeroColor = (typeof HERO_COLORS)[number];

// --- Agent source (which external agent produced this session) ---
export const AGENT_SOURCES = ['claude', 'codex'] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

// --- Agent activity (maps to village buildings) ---
export type AgentActivity =
  | 'reading'    // Library: Read, Grep, Glob
  | 'editing'    // Forge: Edit, Write
  | 'thinking'   // Wizard Tower: long text, thinking blocks
  | 'bash'       // Arena: Bash
  | 'idle'       // Tavern: no activity
  | 'git'        // Chapel: git commit/push inside Bash
  | 'debugging'  // Alchemist Shop: fix after errors
  | 'reviewing'; // Watchtower: Agent subagent, review

// --- Tool call record ---
export interface ToolCall {
  id: string;
  name: string;
  timestamp: number;
  input: Record<string, unknown>;
}

// --- Context / skill / plugin telemetry ---
// Kept in sync with client/src/types/agent.ts.

/** Occupancy of the model's context window after the latest response. */
export interface ContextUsage {
  /** Tokens in the context after the latest response (prompt + output). */
  used: number;
  /** Highest `used` observed during the session (survives compactions). */
  peak: number;
  /** Model context window in tokens; null when unknown. */
  window: number | null;
  /** How `window` was determined. */
  windowSource: 'reported' | 'configured' | 'inferred' | 'default';
  /** Context compactions detected (explicit marker or a large drop). */
  compactions: number;
  lastCompactionAt?: number;
  /** Timestamp (ms) of the sample `used` comes from. */
  updatedAt: number;
}

/** A skill whose instructions were loaded into the agent's context. */
export interface SkillUsage {
  /** Canonical name, e.g. `superpowers:brainstorming` or `pdf`. */
  name: string;
  /** Owning plugin when known (e.g. `superpowers`). */
  plugin?: string;
  /** How many times the skill body entered the context. */
  loads: number;
  /** Estimated tokens the skill bodies injected (chars / 4). */
  loadTokens: number;
  /** Assistant messages Claude Code attributed to this skill. */
  attributedMessages: number;
  /** Output tokens of those attributed messages. */
  attributedOutputTokens: number;
  firstUsedAt: number;
  lastUsedAt: number;
}

/** A plugin or MCP server the agent called tools through. */
export interface PluginUsage {
  /** Plugin id (`chrome-devtools-mcp`) or MCP server name. */
  name: string;
  kind: 'plugin' | 'mcp';
  calls: number;
  /** Estimated tokens its tool results pushed into the context (chars / 4). */
  resultTokens: number;
  lastUsedAt: number;
}

/** Skills installed on disk for one provider: how much context they would cost if always loaded. */
export interface SkillInventory {
  count: number;
  tokens: number;
}

/** Estimated token count for a text of `chars` characters (≈ 4 chars per token, rounded up). */
export function estimateTokens(chars: number): number {
  return chars > 0 ? Math.ceil(chars / 4) : 0;
}

// --- Core agent state ---
export interface AgentState {
  id: string;          // sessionId
  name: string;        // slug from JSONL (e.g. "bubbly-waddling-cat")
  heroClass: HeroClass;
  heroColor: HeroColor;
  status: 'active' | 'waiting' | 'idle' | 'completed' | 'error';
  currentActivity: AgentActivity;
  currentFile?: string;
  currentCommand?: string;
  tokenUsage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: number;
  sessionStart: number;   // timestamp ms
  toolCalls: ToolCall[];
  errors: string[];
  filesModified: string[];
  lastEvent: number;      // timestamp ms
  lastMessage?: string;   // last text output from agent
  lastErrorAt?: number;   // timestamp ms of last tool_result with is_error:true
  busy?: boolean;         // true when agent is mid-turn (user prompt or tool_use without isTurnEnd)
  currentTask?: string;   // current user prompt (from JSONL last-prompt) — what the agent is working on
  cwd: string;            // project working directory
  configDir: string;      // Config dir of the provider that produced the session (e.g. ~/.claude,
                          // ~/.claude-work, ~/.codex) — identifies which installation
  source: AgentSource;    // 'claude' | 'codex' — which CLI produced this session
  /**
   * Model id as emitted by Claude Code in `message.model` of assistant lines
   * (e.g. `claude-opus-4-6`, `claude-sonnet-4-20250514`). Undefined for Codex
   * sessions and for Claude sessions whose JSONL predates the field.
   */
  model?: string;
  /**
   * True for subagents: Claude Code ones spawned via the Agent/Task tool
   * (filename-derived `agent-` id) and Codex ones spawned via `spawn_agent`
   * (rollouts with `thread_source: 'subagent'`). Drives the subagent lifecycle
   * and lets the client suppress per-subagent notifications.
   */
  isSubagent: boolean;
  /** Context-window occupancy; undefined until the first usage sample. */
  context?: ContextUsage;
  /** Skills loaded this session, most recently used last. */
  skills: SkillUsage[];
  /** Plugins / MCP servers called this session. */
  plugins: PluginUsage[];
  /** Skill the latest assistant message was attributed to (Claude) or the last one loaded in the turn (Codex). */
  activeSkill?: string;
  /** Session id of the parent agent, for subagents. */
  parentId?: string;
  /** Subagent role, e.g. `Explore`, `general-purpose`, or a Codex agent path basename. */
  subagentType?: string;
  /** Estimated tokens the subagent's final result pushed into the parent context. */
  returnedTokens?: number;
}

// --- Session metadata from ~/.claude/sessions/<pid>.json
//     (Claude Code only — Codex has no equivalent pidfile) ---
export interface SessionMeta {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind: string;
  entrypoint: string;
}

// --- JSONL line structures ---
export interface JsonlToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  caller?: { type: string };
}

export interface JsonlToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: string; text?: string }>;
}

export interface JsonlLine {
  type: string;
  subtype?: string;
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  sessionId: string;
  cwd?: string;
  slug?: string;
  message?: {
    role: 'user' | 'assistant' | 'system';
    content: string | Array<JsonlToolUse | JsonlToolResult | { type: string; text?: string }>;
    /** API message id — present on assistant lines; one id spans several JSONL lines. */
    id?: string;
    /** Model id — present on `type: 'assistant'` lines produced by Claude Code. */
    model?: string;
    /** Token usage — present on Claude assistant lines. Shape is read defensively. */
    usage?: unknown;
  };
  /** Skill Claude Code attributes this assistant line to (e.g. `superpowers:brainstorming`). */
  attributionSkill?: string;
  /** Plugin Claude Code attributes this assistant line to (e.g. `superpowers`). */
  attributionPlugin?: string;
  /** True on the user line that carries the post-compaction summary. */
  isCompactSummary?: boolean;
  /** True on synthetic user lines injected by Claude Code (skill bodies, reminders). */
  isMeta?: boolean;
}

// --- WebSocket event types ---
export type WsEvent =
  | { type: 'agent:update'; agent: AgentState }
  | { type: 'agent:new'; agent: AgentState }
  | { type: 'agent:complete'; id: string }
  | { type: 'activity:log'; agentId: string; action: string; detail: string; timestamp: number }
  | {
      type: 'snapshot';
      agents: AgentState[];
      configDirs: string[];
      /** Skills installed on disk per provider (what they would cost if always loaded). */
      skillInventory?: Partial<Record<AgentSource, SkillInventory>>;
    }
  /** Pushed after a rescan finds the installed skills changed (new plugin, new skill). */
  | { type: 'inventory:update'; skillInventory: Partial<Record<AgentSource, SkillInventory>> };
