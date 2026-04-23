// --- Hero classes (3 unit types, assigned cyclically) ---
export const HERO_CLASSES = ['warrior', 'archer', 'pawn'] as const;
export type HeroClass = (typeof HERO_CLASSES)[number];

// --- Hero colors (5 total, assigned cyclically, independent of class) ---
export const HERO_COLORS = ['blue', 'yellow', 'red', 'black', 'purple'] as const;
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
  name: string;        // slug from JSONL (e.g. "bubbly-waddling-cat")
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
  configDir: string;      // Claude config dir (e.g. ~/.claude, ~/.claude-work) — identifies which installation
  source: AgentSource;    // 'claude' | 'codex' — which CLI produced this session
}

// --- Session metadata from ~/.claude/sessions/<pid>.json ---
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
  };
}

// --- WebSocket event types ---
export type WsEvent =
  | { type: 'agent:update'; agent: AgentState }
  | { type: 'agent:new'; agent: AgentState }
  | { type: 'agent:complete'; id: string }
  | { type: 'activity:log'; agentId: string; action: string; detail: string; timestamp: number }
  | { type: 'snapshot'; agents: AgentState[]; configDirs: string[] };
