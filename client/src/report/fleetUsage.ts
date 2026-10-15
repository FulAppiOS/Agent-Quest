import type { AgentSource, AgentState, PluginUsage } from '../types/agent';
import { contextPct, isSubagentAgent } from '../types/agent';

/** One skill across the whole fleet. */
export interface FleetSkillRow {
  name: string;
  plugin?: string;
  loads: number;
  loadTokens: number;
  attributedMessages: number;
  /** Distinct agents that used it. */
  agents: number;
  lastUsedAt: number;
}

/** One plugin / MCP server across the whole fleet. */
export interface FleetPluginRow {
  name: string;
  kind: PluginUsage['kind'];
  calls: number;
  resultTokens: number;
  agents: number;
  lastUsedAt: number;
}

/** One agent's telemetry summary, for the per-agent list. */
export interface FleetAgentRow {
  id: string;
  name: string;
  source: AgentSource;
  status: AgentState['status'];
  isSubagent: boolean;
  parentId?: string;
  activeSkill?: string;
  contextPct: number | null;
  contextUsed: number;
  skillTokens: number;
  pluginTokens: number;
}

export interface FleetTotals {
  skillLoads: number;
  skillTokens: number;
  pluginCalls: number;
  pluginTokens: number;
  agentsWithSkills: number;
}

export interface FleetUsage {
  /** Biggest context cost first. */
  skills: FleetSkillRow[];
  /** Most calls first. */
  plugins: FleetPluginRow[];
  /** Hottest context first; unknown windows last. */
  agents: FleetAgentRow[];
  totals: FleetTotals;
}

function pluginOfSkill(name: string, explicit: string | undefined): string | undefined {
  if (explicit !== undefined) return explicit;
  const i = name.indexOf(':');
  return i > 0 ? name.slice(0, i) : undefined;
}

/** Roll every agent's skills / plugins / context into fleet-wide tables. Pure; agents from older servers may lack the arrays. */
export function aggregateFleetUsage(agents: AgentState[]): FleetUsage {
  const skills = new Map<string, FleetSkillRow>();
  const plugins = new Map<string, FleetPluginRow>();
  const rows: FleetAgentRow[] = [];
  const totals: FleetTotals = { skillLoads: 0, skillTokens: 0, pluginCalls: 0, pluginTokens: 0, agentsWithSkills: 0 };

  for (const a of agents) {
    const aSkills = a.skills ?? [];
    const aPlugins = a.plugins ?? [];
    if (aSkills.length > 0) totals.agentsWithSkills += 1;
    let skillTokens = 0;
    let pluginTokens = 0;

    for (const s of aSkills) {
      skillTokens += s.loadTokens;
      totals.skillLoads += s.loads;
      totals.skillTokens += s.loadTokens;
      const row = skills.get(s.name);
      if (row === undefined) {
        skills.set(s.name, {
          name: s.name,
          plugin: pluginOfSkill(s.name, s.plugin),
          loads: s.loads,
          loadTokens: s.loadTokens,
          attributedMessages: s.attributedMessages,
          agents: 1,
          lastUsedAt: s.lastUsedAt,
        });
      } else {
        row.loads += s.loads;
        row.loadTokens += s.loadTokens;
        row.attributedMessages += s.attributedMessages;
        row.agents += 1;
        if (s.lastUsedAt > row.lastUsedAt) row.lastUsedAt = s.lastUsedAt;
        if (row.plugin === undefined) row.plugin = pluginOfSkill(s.name, s.plugin);
      }
    }

    for (const p of aPlugins) {
      pluginTokens += p.resultTokens;
      totals.pluginCalls += p.calls;
      totals.pluginTokens += p.resultTokens;
      const key = `${p.kind}:${p.name}`;
      const row = plugins.get(key);
      if (row === undefined) {
        plugins.set(key, { name: p.name, kind: p.kind, calls: p.calls, resultTokens: p.resultTokens, agents: 1, lastUsedAt: p.lastUsedAt });
      } else {
        row.calls += p.calls;
        row.resultTokens += p.resultTokens;
        row.agents += 1;
        if (p.lastUsedAt > row.lastUsedAt) row.lastUsedAt = p.lastUsedAt;
      }
    }

    rows.push({
      id: a.id,
      name: a.name,
      source: a.source,
      status: a.status,
      isSubagent: isSubagentAgent(a),
      parentId: a.parentId,
      activeSkill: a.activeSkill,
      contextPct: contextPct(a.context),
      contextUsed: a.context?.used ?? 0,
      skillTokens,
      pluginTokens,
    });
  }

  rows.sort((x, y) => {
    if (x.contextPct === null && y.contextPct === null) return 0;
    if (x.contextPct === null) return 1;
    if (y.contextPct === null) return -1;
    return y.contextPct - x.contextPct;
  });

  return {
    skills: [...skills.values()].sort((x, y) => y.loadTokens - x.loadTokens),
    plugins: [...plugins.values()].sort((x, y) => y.calls - x.calls),
    agents: rows,
    totals,
  };
}
