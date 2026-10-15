import { describe, it, expect } from 'bun:test';
import type { AgentState, SkillUsage, PluginUsage } from '../types/agent';
import { aggregateFleetUsage } from './fleetUsage';

function agent(id: string, over: Partial<AgentState> = {}): AgentState {
  return {
    id, name: id, heroClass: 'warrior', heroColor: 'blue', status: 'active', currentActivity: 'idle',
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, sessionStart: 0, toolCalls: [],
    errors: [], filesModified: [], lastEvent: 0, cwd: '/p', configDir: '~/.claude', source: 'claude', ...over,
  };
}
const skill = (name: string, loadTokens: number, loads = 1, lastUsedAt = 10): SkillUsage =>
  ({ name, loads, loadTokens, attributedMessages: 2, attributedOutputTokens: 100, firstUsedAt: 1, lastUsedAt });
const plugin = (name: string, calls: number, resultTokens: number): PluginUsage =>
  ({ name, kind: 'plugin', calls, resultTokens, lastUsedAt: 5 });

describe('aggregateFleetUsage', () => {
  it('merges skills and plugins across agents, counting how many agents used each', () => {
    const agents = [
      agent('a', { skills: [skill('superpowers:brainstorming', 4000)], plugins: [plugin('chrome', 3, 300)] }),
      agent('b', { skills: [skill('superpowers:brainstorming', 4000, 2, 20), skill('pdf', 900)], plugins: [plugin('chrome', 1, 100)] }),
      agent('c'),
    ];
    const u = aggregateFleetUsage(agents);
    expect(u.skills.map((s) => s.name)).toEqual(['superpowers:brainstorming', 'pdf']);
    expect(u.skills[0]).toMatchObject({ loads: 3, loadTokens: 8000, agents: 2, lastUsedAt: 20, plugin: 'superpowers' });
    expect(u.plugins).toEqual([{ name: 'chrome', kind: 'plugin', calls: 4, resultTokens: 400, agents: 2, lastUsedAt: 5 }]);
    expect(u.totals).toEqual({ skillLoads: 4, skillTokens: 8900, pluginCalls: 4, pluginTokens: 400, agentsWithSkills: 2 });
  });

  it('lists agents hottest context first, unknown windows last, with their skill/plugin token sums', () => {
    const ctx = (used: number) => ({ used, peak: used, window: 100_000, windowSource: 'reported' as const, compactions: 0, updatedAt: 0 });
    const agents = [
      agent('cold', { context: ctx(10_000), skills: [skill('x', 50)] }),
      agent('unknown', { plugins: [plugin('p', 1, 70)] }),
      agent('hot', { context: ctx(90_000), activeSkill: 'x' }),
    ];
    const rows = aggregateFleetUsage(agents).agents;
    expect(rows.map((r) => r.id)).toEqual(['hot', 'cold', 'unknown']);
    expect(rows[0]).toMatchObject({ contextPct: 90, activeSkill: 'x', skillTokens: 0, pluginTokens: 0 });
    expect(rows[1]).toMatchObject({ skillTokens: 50 });
    expect(rows[2]).toMatchObject({ contextPct: null, pluginTokens: 70 });
  });

  it('tolerates agents from older servers without skills/plugins arrays', () => {
    const u = aggregateFleetUsage([agent('old')]);
    expect(u.skills).toEqual([]);
    expect(u.totals.agentsWithSkills).toBe(0);
  });
});
