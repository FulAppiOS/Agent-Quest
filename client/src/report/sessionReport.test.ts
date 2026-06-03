import { describe, it, expect } from 'bun:test';
import type { AgentState, ToolCall } from '../types/agent';
import { computeSessionReport } from './sessionReport';

let tc = 0;
const tool = (name: string): ToolCall => ({ id: `t${++tc}`, name, timestamp: 0, input: {} });

function makeAgent(over: Partial<AgentState> = {}): AgentState {
  return {
    id: 's', name: 'hero', heroClass: 'warrior', heroColor: 'blue', status: 'completed',
    currentActivity: 'idle', tokenUsage: { input: 0, output: 0, cacheRead: 0 }, cost: 0,
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

  it('estimates cost from tokens for a known Claude model', () => {
    const r = computeSessionReport(makeAgent({
      model: 'claude-opus-4-8',
      tokenUsage: { input: 1_000_000, output: 1_000_000, cacheRead: 0 },
      sessionStart: 0, lastEvent: 60_000,
    }));
    expect(r.hasTokens).toBe(true);
    // opus: 1M*15e-6 + 1M*75e-6 = 15 + 75 = 90
    expect(r.estCost).toBeCloseTo(90, 5);
    expect(r.costPerMin).toBeCloseTo(90, 5); // over 1 minute
  });

  it('returns null cost for Codex and for unknown models', () => {
    expect(computeSessionReport(makeAgent({ source: 'codex', model: undefined, tokenUsage: { input: 100, output: 100, cacheRead: 0 } })).estCost).toBeNull();
    expect(computeSessionReport(makeAgent({ source: 'claude', model: 'mystery-model', tokenUsage: { input: 100, output: 100, cacheRead: 0 } })).estCost).toBeNull();
  });

  it('reports no tokens when usage is all zero', () => {
    const r = computeSessionReport(makeAgent());
    expect(r.hasTokens).toBe(false);
    expect(r.estCost).toBeNull();
    expect(r.costPerMin).toBeNull();
  });
});
