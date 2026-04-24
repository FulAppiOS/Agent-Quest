export const HERO_CLASSES = ['warrior', 'archer', 'pawn'] as const;
export type HeroClass = (typeof HERO_CLASSES)[number];

// Kept in sync with server/src/types.ts — the state manager assigns round-robin
// across the full palette. The 5 original entries map 1:1 to Tiny Swords sprite
// variants; the extra entries reuse an existing sprite base (see
// `HERO_COLOR_SPRITE_BASE` below). Only the NAME LABEL gets the expanded color
// — the sprite itself stays its base variant, untinted.
export const HERO_COLORS = [
  'blue', 'yellow', 'red', 'black', 'purple',
  'teal', 'orange', 'green',
] as const;
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
 * Party Bar, Detail Panel, Activity Feed rows). Bright enough to read
 * against #1a1a2e.
 */
export const HERO_LABEL_COLOR: Record<HeroColor, string> = {
  blue:   '#88BBFF',
  yellow: '#FFD700',
  red:    '#FF8866',
  black:  '#B8B8D0',
  purple: '#C48BE8',
  teal:   '#7ED9CF',
  orange: '#FF9F4A',
  green:  '#88E08A',
};

/**
 * Sprite variant to actually render for each HeroColor. The extra palette
 * entries (teal/orange/green) don't have their own sprite sheets — they
 * piggy-back on an existing one; only the name label reflects the expanded
 * palette, the sprite itself stays the base variant untouched.
 */
export const HERO_COLOR_SPRITE_BASE: Record<HeroColor, 'blue' | 'yellow' | 'red' | 'black' | 'purple'> = {
  blue:   'blue',
  yellow: 'yellow',
  red:    'red',
  black:  'black',
  purple: 'purple',
  teal:   'blue',
  orange: 'yellow',
  green:  'yellow',
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
  /** Raw model id from Claude Code (e.g. `claude-opus-4-6`). Undefined for Codex. */
  model?: string;
}

/**
 * Compact badge for the model id (e.g. `claude-opus-4-6` → `OPUS`). Returns
 * null for Codex and for Claude sessions whose JSONL predates `message.model`,
 * so the UI can skip the badge entirely rather than rendering a placeholder.
 * The color echoes the activity palette used on the Phaser canvas so a reader
 * builds one mental mapping across views.
 */
export interface ModelBadge {
  /** Short, uppercase label (e.g. `OPUS`). */
  short: string;
  /** Hex color, 6-char, suitable for the same `${c}80` / `${c}14` treatment as source badges. */
  color: string;
}

export function modelBadge(model: string | undefined): ModelBadge | null {
  if (model === undefined || model.length === 0) return null;
  const id = model.toLowerCase();
  if (id.includes('opus'))   return { short: 'OPUS',   color: '#C48BE8' };
  if (id.includes('sonnet')) return { short: 'SONNET', color: '#88BBFF' };
  if (id.includes('haiku'))  return { short: 'HAIKU',  color: '#FFD27A' };
  return null;
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
