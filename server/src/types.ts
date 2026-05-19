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

// --- Core agent state ---
export interface AgentState {
  id: string;          // sessionId
  /**
   * Label rendered above the hero. Starts as the JSONL slug or cwd basename
   * (see `derivedName`), and is overlaid with the user-set display title
   * whenever a `SessionDisplayNameOracle` returns one. Falls back to
   * `derivedName` the moment the oracle drops the title — otherwise a deleted
   * `state.json` would freeze a stale label on the sprite forever.
   */
  name: string;
  /**
   * Slug/cwd-derived label that survives oracle gaps. Recomputed on every
   * non-subagent JSONL event so a renamed cwd or a slug surfacing late still
   * lands here without waiting for the oracle to come back.
   */
  derivedName: string;
  heroClass: HeroClass;
  heroColor: HeroColor;
  status: 'active' | 'waiting' | 'idle' | 'completed' | 'error';
  currentActivity: AgentActivity;
  currentFile?: string;
  currentCommand?: string;
  tokenUsage: { input: number; output: number; cacheRead: number };
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
   * True when this session was spawned by another session as a sub-agent
   * (e.g. Claude Code `Agent` / Task tool). Server computes from file-system
   * layout (subagents/ directory) — client never inspects sessionId patterns
   * directly. Defaults to false for main sessions and for Codex sessions
   * (Codex has no sub-agent concept).
   */
  isSubagent: boolean;
  /**
   * Parent session id when this session is a sub-agent and the parent is
   * known. Undefined for main sessions and for orphan sub-agents whose
   * parent jsonl could not be located.
   */
  parentSessionId?: string;
}

// --- Subagent context (anti-corruption boundary) ---
/**
 * Carries server-domain knowledge about whether a JSONL file represents a
 * sub-agent session, plus the parent session id when discoverable. The
 * file-watcher computes this from disk layout once; downstream layers
 * (provider, state manager) never inspect file paths or sessionId patterns.
 */
export interface SubagentContext {
  isSubagent: boolean;
  parentSessionId?: string;
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
    /** Model id — present on `type: 'assistant'` lines produced by Claude Code. */
    model?: string;
  };
}

// --- WebSocket event types ---
export type WsEvent =
  | { type: 'agent:update'; agent: AgentState }
  | { type: 'agent:new'; agent: AgentState }
  | { type: 'agent:complete'; id: string }
  | { type: 'activity:log'; agentId: string; action: string; detail: string; timestamp: number }
  | { type: 'snapshot'; agents: AgentState[]; configDirs: string[] };
