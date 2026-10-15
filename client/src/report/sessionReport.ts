import type { AgentActivity, AgentState, PluginUsage, SkillUsage } from '../types/agent';
import { contextPct } from '../types/agent';

/**
 * Per-session "report card" derived purely from an AgentState. Kept as a pure
 * function so it's testable and DB-ready: the same shape can later be produced
 * from persisted events instead of the live snapshot, without touching the UI.
 *
 * We report token COUNTS (exact, from the JSONL) but deliberately NOT a dollar
 * cost: pricing changes with every model generation and would need constant
 * maintenance, and per-session token totals here don't include the session's
 * subagents (each is its own agent), so a cost figure would mislead anyway.
 */

export interface ActivitySlice {
  activity: AgentActivity;
  count: number;
  pct: number; // 0..100 of total tool calls
}

export interface ContextSummary {
  used: number;
  peak: number;
  window: number | null;
  /** Percentage of the window in use, null when the window is unknown. */
  pct: number | null;
  compactions: number;
}

/** What this session's subagents did out of its sight. */
export interface DelegationSummary {
  count: number;
  live: number;
  /** Sum of the children's context peaks: what they processed. */
  childPeakTokens: number;
  /** Sum of what their final results pushed back into this context. */
  returnedTokens: number;
  /** childPeakTokens − returnedTokens: context delegation kept out of this session. */
  keptOutTokens: number;
}

export interface SessionReport {
  durationMs: number;
  toolTotal: number;
  byActivity: ActivitySlice[];
  topTools: { name: string; count: number }[];
  filesModified: number;
  errorCount: number;
  hasTokens: boolean;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  source: AgentState['source'];
  model?: string;
  context?: ContextSummary;
  /** Skills loaded this session, biggest context cost first. */
  skills: SkillUsage[];
  /** Plugins / MCP servers called this session, most calls first. */
  plugins: PluginUsage[];
  /** Present only when the session spawned subagents (`children` non-empty). */
  delegation?: DelegationSummary;
}

const TOOL_ACTIVITY_MAP: Record<string, AgentActivity> = {
  Read: 'reading', Grep: 'reading', Glob: 'reading',
  Edit: 'editing', Write: 'editing', NotebookEdit: 'editing',
  Bash: 'bash',
  Task: 'reviewing', Agent: 'reviewing',
};

function toolToActivity(name: string): AgentActivity {
  return TOOL_ACTIVITY_MAP[name] ?? 'thinking';
}

const LIVE_STATUSES = new Set<AgentState['status']>(['active', 'waiting', 'idle']);

function summarizeContext(agent: AgentState): ContextSummary | undefined {
  const c = agent.context;
  if (c === undefined) return undefined;
  return { used: c.used, peak: c.peak, window: c.window, pct: contextPct(c), compactions: c.compactions };
}

function summarizeDelegation(children: AgentState[]): DelegationSummary | undefined {
  if (children.length === 0) return undefined;
  let childPeakTokens = 0;
  let returnedTokens = 0;
  let live = 0;
  for (const c of children) {
    childPeakTokens += c.context?.peak ?? 0;
    returnedTokens += c.returnedTokens ?? 0;
    if (LIVE_STATUSES.has(c.status)) live += 1;
  }
  return {
    count: children.length,
    live,
    childPeakTokens,
    returnedTokens,
    keptOutTokens: Math.max(0, childPeakTokens - returnedTokens),
  };
}

/**
 * @param children the session's subagents (any status), for the delegation summary.
 */
export function computeSessionReport(agent: AgentState, children: AgentState[] = []): SessionReport {
  const durationMs = Math.max(0, agent.lastEvent - agent.sessionStart);

  const activityCounts = new Map<AgentActivity, number>();
  const toolCounts = new Map<string, number>();
  for (const tc of agent.toolCalls) {
    const act = toolToActivity(tc.name);
    activityCounts.set(act, (activityCounts.get(act) ?? 0) + 1);
    toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
  }
  const toolTotal = agent.toolCalls.length;

  const byActivity: ActivitySlice[] = [...activityCounts.entries()]
    .map(([activity, count]) => ({ activity, count, pct: toolTotal > 0 ? (count / toolTotal) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);

  const topTools = [...toolCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const tu = agent.tokenUsage;
  const total = tu.input + tu.output + tu.cacheRead + tu.cacheWrite;

  return {
    durationMs,
    toolTotal,
    byActivity,
    topTools,
    filesModified: agent.filesModified.length,
    errorCount: agent.errors.length,
    hasTokens: total > 0,
    tokens: { input: tu.input, output: tu.output, cacheRead: tu.cacheRead, cacheWrite: tu.cacheWrite, total },
    source: agent.source,
    model: agent.model,
    context: summarizeContext(agent),
    skills: [...(agent.skills ?? [])].sort((a, b) => b.loadTokens - a.loadTokens),
    plugins: [...(agent.plugins ?? [])].sort((a, b) => b.calls - a.calls),
    delegation: summarizeDelegation(children),
  };
}
