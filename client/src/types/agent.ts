export const HERO_CLASSES = ['warrior', 'archer', 'pawn'] as const;
export type HeroClass = (typeof HERO_CLASSES)[number];

export const HERO_COLORS = ['blue', 'yellow', 'red', 'black', 'purple'] as const;
export type HeroColor = (typeof HERO_COLORS)[number];

export const AGENT_SOURCES = ['claude', 'codex'] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

/**
 * Badge color used wherever we render a source pill (Phaser label, Party Bar,
 * Detail Panel). Must be **6-char hex** — PartyBar/DetailPanel build the
 * translucent border/background by concatenating an alpha suffix
 * (`${color}80` / `${color}14`), which only works on 6-char hex.
 */
export const SOURCE_BADGE_COLOR: Record<AgentSource, string> = {
  claude: '#FF9F4A', // orange
  codex:  '#7ED9CF', // teal
};

/**
 * Hero color tinted for text labels on dark backgrounds (Phaser name tag,
 * Party Bar, feed rows). Bright enough to read against #1a1a2e. Keep in sync
 * with the Minimap palette if you ever want the two to visually match.
 */
export const HERO_LABEL_COLOR: Record<HeroColor, string> = {
  blue:   '#88BBFF',
  yellow: '#FFD700',
  red:    '#FF8866',
  black:  '#B8B8D0',
  purple: '#C48BE8',
};

export type AgentActivity =
  | 'reading'
  | 'editing'
  | 'thinking'
  | 'bash'
  | 'idle'
  | 'git'
  | 'debugging'
  | 'reviewing';

export interface ToolCall {
  id: string;
  name: string;
  timestamp: number;
  input: Record<string, unknown>;
}

export interface AgentState {
  id: string;
  name: string;
  heroClass: HeroClass;
  heroColor: HeroColor;
  status: 'active' | 'waiting' | 'idle' | 'completed' | 'error';
  currentActivity: AgentActivity;
  currentFile?: string;
  currentCommand?: string;
  tokenUsage: { input: number; output: number; cacheRead: number };
  cost: number;
  sessionStart: number;
  toolCalls: ToolCall[];
  errors: string[];
  filesModified: string[];
  lastEvent: number;
  lastMessage?: string;
  lastErrorAt?: number;
  busy?: boolean;
  currentTask?: string;
  cwd: string;
  configDir: string;
  source: AgentSource;
}

export interface ActivityLogEntry {
  agentId: string;
  action: string;
  detail: string;
  timestamp: number;
}

export type WsEvent =
  | { type: 'agent:update'; agent: AgentState }
  | { type: 'agent:new'; agent: AgentState }
  | { type: 'agent:complete'; id: string }
  | { type: 'activity:log'; agentId: string; action: string; detail: string; timestamp: number }
  | { type: 'snapshot'; agents: AgentState[]; configDirs: string[] };
