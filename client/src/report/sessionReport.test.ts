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
