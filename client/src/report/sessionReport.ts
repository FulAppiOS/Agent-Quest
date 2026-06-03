import type { AgentActivity, AgentSource, AgentState } from '../types/agent';

/**
 * Per-session "report card" derived purely from an AgentState. Kept as a pure
 * function so it's testable and DB-ready: the same shape can later be produced
 * from persisted events instead of the live snapshot, without touching the UI.
 *
 * Everything is computed from data already on the agent (tool history, files,
 * tokens, timestamps). Cost is an ESTIMATE from a per-model price table — token
 * counts are exact, dollar figures are approximate.
 */

export interface ActivitySlice {
  activity: AgentActivity;
  count: number;
  pct: number; // 0..100 of total tool calls
}

export interface SessionReport {
  durationMs: number;
  toolTotal: number;
  byActivity: ActivitySlice[];
  topTools: { name: string; count: number }[];
  filesModified: number;
  errorCount: number;
  hasTokens: boolean;
  tokens: { input: number; output: number; cacheRead: number; total: number };
  /** Estimated USD cost; null for Codex, missing tokens, or unknown model. */
  estCost: number | null;
  /** Estimated USD per minute; null when cost or duration is unavailable. */
  costPerMin: number | null;
  source: AgentSource;
  model?: string;
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

/** Approximate USD price per token, by model family. */
interface Price { input: number; output: number; cacheRead: number }
const PRICES: Record<'opus' | 'sonnet' | 'haiku', Price> = {
  // ~per-MTok: opus 15/75, sonnet 3/15, haiku 0.8/4; cache read ~0.1× input.
  opus:   { input: 15e-6,  output: 75e-6, cacheRead: 1.5e-6 },
  sonnet: { input: 3e-6,   output: 15e-6, cacheRead: 0.3e-6 },
  haiku:  { input: 0.8e-6, output: 4e-6,  cacheRead: 0.08e-6 },
};

function priceFor(model: string | undefined): Price | null {
  if (model === undefined) return null;
  const id = model.toLowerCase();
  if (id.includes('opus')) return PRICES.opus;
  if (id.includes('sonnet')) return PRICES.sonnet;
  if (id.includes('haiku')) return PRICES.haiku;
  return null;
}

export function computeSessionReport(agent: AgentState): SessionReport {
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
  const total = tu.input + tu.output + tu.cacheRead;
  const hasTokens = total > 0;

  const price = priceFor(agent.model);
  let estCost: number | null = null;
  if (agent.source === 'claude' && hasTokens && price !== null) {
    estCost = tu.input * price.input + tu.output * price.output + tu.cacheRead * price.cacheRead;
  }
  const costPerMin = estCost !== null && durationMs > 0 ? estCost / (durationMs / 60_000) : null;

  return {
    durationMs,
    toolTotal,
    byActivity,
    topTools,
    filesModified: agent.filesModified.length,
    errorCount: agent.errors.length,
    hasTokens,
    tokens: { input: tu.input, output: tu.output, cacheRead: tu.cacheRead, total },
    estCost,
    costPerMin,
    source: agent.source,
    model: agent.model,
  };
}
