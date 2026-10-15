import { describe, it, expect } from 'bun:test';
import type { AgentState, ToolCall } from '../types/agent';
import { computeSessionReport } from './sessionReport';

let tc = 0;
const tool = (name: string): ToolCall => ({ id: `t${++tc}`, name, timestamp: 0, input: {} });

function makeAgent(over: Partial<AgentState> = {}): AgentState {
  return {
    id: 's', name: 'hero', heroClass: 'warrior', heroColor: 'blue', status: 'completed',
    currentActivity: 'idle', tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0,
    sessionStart: 1000, toolCalls: [], errors: [], filesModified: [], lastEvent: 1000,
    cwd: '/p', configDir: '~/.claude', source: 'claude', isSubagent: false, ...over,
  };
}

describe('computeSessionReport', () => {
  it('counts tools and groups them by activity', () => {
    const r = computeSessionReport(makeAgent({
      toolCalls: [tool('Read'), tool('Read'), tool('Edit'), tool('Bash')],
    }));
    expect(r.toolTotal).toBe(4);
    const reading = r.byActivity.find((a) => a.activity === 'reading');
    expect(reading?.count).toBe(2);
    expect(reading?.pct).toBe(50);
    expect(r.byActivity[0]?.activity).toBe('reading'); // sorted desc
  });

  it('computes duration and lists top tools', () => {
    const r = computeSessionReport(makeAgent({
      sessionStart: 1000, lastEvent: 1000 + 120_000,
      toolCalls: [tool('Bash'), tool('Bash'), tool('Read')],
    }));
    expect(r.durationMs).toBe(120_000);
    expect(r.topTools[0]).toEqual({ name: 'Bash', count: 2 });
  });

  it('sums token buckets into a total (no dollar cost)', () => {
    const r = computeSessionReport(makeAgent({
      tokenUsage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
    }));
    expect(r.hasTokens).toBe(true);
    expect(r.tokens).toEqual({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40, total: 100 });
    // No cost is computed anymore.
    expect((r as Record<string, unknown>).estCost).toBeUndefined();
  });

  it('reports no tokens when usage is all zero', () => {
    const r = computeSessionReport(makeAgent());
    expect(r.hasTokens).toBe(false);
    expect(r.tokens.total).toBe(0);
  });

  it('carries the source through (Codex has no tokens)', () => {
    const r = computeSessionReport(makeAgent({ source: 'codex' }));
    expect(r.source).toBe('codex');
    expect(r.hasTokens).toBe(false);
  });
});

describe('computeSessionReport context, skills, plugins and delegation', () => {
  const ctx = { used: 150_000, peak: 180_000, window: 200_000, windowSource: 'default' as const, compactions: 1, updatedAt: 0 };

  it('reports context occupancy with the percentage of the window', () => {
    const r = computeSessionReport(makeAgent({ context: ctx }));
    expect(r.context).toEqual({ used: 150_000, peak: 180_000, window: 200_000, pct: 75, compactions: 1 });
    expect(computeSessionReport(makeAgent()).context).toBeUndefined();
  });

  it('passes skills and plugins through, most used first', () => {
    const skills = [
      { name: 'a', loads: 1, loadTokens: 100, attributedMessages: 0, attributedOutputTokens: 0, firstUsedAt: 0, lastUsedAt: 0 },
      { name: 'b', loads: 2, loadTokens: 900, attributedMessages: 0, attributedOutputTokens: 0, firstUsedAt: 0, lastUsedAt: 0 },
    ];
    const plugins = [
      { name: 'p', kind: 'plugin' as const, calls: 1, resultTokens: 10, lastUsedAt: 0 },
      { name: 'q', kind: 'mcp' as const, calls: 5, resultTokens: 50, lastUsedAt: 0 },
    ];
    const r = computeSessionReport(makeAgent({ skills, plugins }));
    expect(r.skills.map((s) => s.name)).toEqual(['b', 'a']);
    expect(r.plugins.map((p) => p.name)).toEqual(['q', 'p']);
    expect(computeSessionReport(makeAgent()).skills).toEqual([]);
  });

  it('sums the children context peaks and what they returned into a delegation summary', () => {
    const children = [
      makeAgent({ id: 'c1', status: 'active', parentId: 's', context: { ...ctx, peak: 100_000 }, returnedTokens: 1_000 }),
      makeAgent({ id: 'c2', status: 'completed', parentId: 's', context: { ...ctx, peak: 50_000 } }),
    ];
    const r = computeSessionReport(makeAgent(), children);
    expect(r.delegation).toEqual({ count: 2, live: 1, childPeakTokens: 150_000, returnedTokens: 1_000, keptOutTokens: 149_000 });
    expect(computeSessionReport(makeAgent()).delegation).toBeUndefined();
  });
});
