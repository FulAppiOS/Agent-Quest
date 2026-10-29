import type { AgentSource, AgentState, HeroColor } from '../types/agent';
import { contextPct, isSubagentAgent } from '../types/agent';

/** One live main agent with a measurable context window, for the Top Bar dropdown. */
export interface ContextRow {
  id: string;
  name: string;
  source: AgentSource;
  configDir: string;
  model?: string;
  status: AgentState['status'];
  heroColor: HeroColor;
  /** Percentage of the window in use. */
  pct: number;
  used: number;
  window: number;
  compactions: number;
}

const LIVE_STATUSES = new Set<AgentState['status']>(['active', 'waiting', 'idle']);

/**
 * Main agents (never subagents) that are still alive and whose context window
 * is known, hottest first. Finished sessions and agents without a usage sample
 * or without a resolvable window are left out: there is nothing to rank yet.
 */
export function rankContextAgents(agents: AgentState[]): ContextRow[] {
  const rows: ContextRow[] = [];
  for (const a of agents) {
    if (isSubagentAgent(a) || !LIVE_STATUSES.has(a.status)) continue;
    const pct = contextPct(a.context);
    if (pct === null || a.context === undefined || a.context.window === null) continue;
    rows.push({
      id: a.id,
      name: a.name,
      source: a.source,
      configDir: a.configDir,
      model: a.model,
      status: a.status,
      heroColor: a.heroColor,
      pct,
      used: a.context.used,
      window: a.context.window,
      compactions: a.context.compactions,
    });
  }
  return rows.sort((x, y) => y.pct - x.pct);
}
