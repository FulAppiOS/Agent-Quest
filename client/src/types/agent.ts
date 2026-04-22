export const HERO_CLASSES = ['warrior', 'archer', 'pawn'] as const;
export type HeroClass = (typeof HERO_CLASSES)[number];

export const HERO_COLORS = ['blue', 'yellow', 'red', 'black', 'purple'] as const;
export type HeroColor = (typeof HERO_COLORS)[number];

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
