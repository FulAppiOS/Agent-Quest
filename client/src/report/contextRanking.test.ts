import { describe, it, expect } from 'bun:test';
import type { AgentState } from '../types/agent';
import { rankContextAgents } from './contextRanking';

function agent(id: string, over: Partial<AgentState> = {}): AgentState {
  return {
    id, name: id, heroClass: 'warrior', heroColor: 'blue', status: 'active', currentActivity: 'idle',
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, sessionStart: 0, toolCalls: [],
    errors: [], filesModified: [], lastEvent: 0, cwd: '/p', configDir: '~/.claude', source: 'claude', ...over,
  };
}
const ctx = (used: number, window: number | null = 100_000, compactions = 0) =>
  ({ used, peak: used, window, windowSource: 'reported' as const, compactions, updatedAt: 0 });

describe('rankContextAgents', () => {
  it('lists live main agents with a known window, hottest first', () => {
    const rows = rankContextAgents([
      agent('cool', { context: ctx(30_000), status: 'idle' }),
      agent('hot', { context: ctx(67_000), model: 'claude-opus-4-6', status: 'waiting' }),
      agent('warm', { context: ctx(45_000, 100_000, 2) }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['hot', 'warm', 'cool']);
    expect(rows[0]).toMatchObject({ pct: 67, used: 67_000, window: 100_000, model: 'claude-opus-4-6', status: 'waiting', compactions: 0 });
    expect(rows[1]!.compactions).toBe(2);
  });

  it('skips subagents, finished sessions and agents whose window is unknown', () => {
    const rows = rankContextAgents([
      agent('sub', { context: ctx(90_000), isSubagent: true, parentId: 'main' }),
      agent('done', { context: ctx(95_000), status: 'completed' }),
      agent('nowindow', { context: ctx(50_000, null) }),
      agent('nosample'),
      agent('main', { context: ctx(10_000) }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['main']);
  });

  it('returns an empty list when nothing qualifies', () => {
    expect(rankContextAgents([agent('x')])).toEqual([]);
  });
});
