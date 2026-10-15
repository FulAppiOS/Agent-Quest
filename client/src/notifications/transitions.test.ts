import { describe, it, expect } from 'bun:test';
import type { AgentState } from '../types/agent';
import { computeAlerts, type AgentSnapshot } from './transitions';

function makeAgent(over: Partial<AgentState> = {}): AgentState {
  return {
    id: 'sess-1',
    name: 'hero',
    heroClass: 'warrior',
    heroColor: 'blue',
    status: 'active',
    currentActivity: 'idle',
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    sessionStart: 0,
    toolCalls: [],
    errors: [],
    filesModified: [],
    lastEvent: 0,
    cwd: '/tmp',
    configDir: '~/.claude',
    source: 'claude',
    ...over,
  };
}

function snap(agents: AgentState[]): Map<string, AgentSnapshot> {
  return computeAlerts(new Map(), agents).next;
}

describe('computeAlerts', () => {
  it('does not alert on first sight (baseline seeding)', () => {
    const { alerts, next } = computeAlerts(new Map(), [makeAgent({ status: 'waiting' })]);
    expect(alerts).toEqual([]);
    expect(next.size).toBe(1);
  });

  it('alerts when an agent enters waiting', () => {
    const prev = snap([makeAgent({ status: 'active' })]);
    const { alerts } = computeAlerts(prev, [makeAgent({ status: 'waiting' })]);
    expect(alerts).toEqual([{ agentId: 'sess-1', name: 'hero', category: 'waiting' }]);
  });

  it('alerts when an agent enters completed', () => {
    const prev = snap([makeAgent({ status: 'active' })]);
    const { alerts } = computeAlerts(prev, [makeAgent({ status: 'completed' })]);
    expect(alerts[0]?.category).toBe('completed');
  });

  it('does NOT alert on a mid-turn error (lastErrorAt advancing without turn-end)', () => {
    const prev = snap([makeAgent({ status: 'active', lastErrorAt: undefined })]);
    const { alerts } = computeAlerts(prev, [makeAgent({ status: 'active', lastErrorAt: 123 })]);
    expect(alerts).toEqual([]);
  });

  it('emits a waiting transition even when an error happened in the same turn', () => {
    const prev = snap([makeAgent({ status: 'active', lastErrorAt: 1 })]);
    const { alerts } = computeAlerts(prev, [makeAgent({ status: 'waiting', lastErrorAt: 2 })]);
    // Category is 'waiting' here; the hook reclassifies to 'error' at fire time
    // based on lastErrorAt recency.
    expect(alerts[0]?.category).toBe('waiting');
  });

  it('does not re-alert while status stays waiting', () => {
    const prev = snap([makeAgent({ status: 'waiting' })]);
    const { alerts } = computeAlerts(prev, [makeAgent({ status: 'waiting' })]);
    expect(alerts).toEqual([]);
  });

  it('suppresses alerts for subagents (agent- prefix)', () => {
    const prev = snap([makeAgent({ id: 'agent-explore-abcdef0123456789', status: 'active' })]);
    const { alerts } = computeAlerts(prev, [
      makeAgent({ id: 'agent-explore-abcdef0123456789', status: 'waiting' }),
    ]);
    expect(alerts).toEqual([]);
  });

  it('suppresses alerts for agents flagged isSubagent', () => {
    const prev = snap([makeAgent({ id: 'sub', isSubagent: true, status: 'active' })]);
    const { alerts } = computeAlerts(prev, [makeAgent({ id: 'sub', isSubagent: true, status: 'waiting' })]);
    expect(alerts).toEqual([]);
  });

  it('drops removed agents from the next snapshot map', () => {
    const prev = snap([makeAgent({ id: 'a' }), makeAgent({ id: 'b' })]);
    const { next } = computeAlerts(prev, [makeAgent({ id: 'a' })]);
    expect(next.has('a')).toBe(true);
    expect(next.has('b')).toBe(false);
  });

  it('re-alerts after leaving and re-entering waiting', () => {
    let prev = snap([makeAgent({ status: 'active' })]);
    let r = computeAlerts(prev, [makeAgent({ status: 'waiting' })]);
    expect(r.alerts).toHaveLength(1);
    prev = r.next;
    r = computeAlerts(prev, [makeAgent({ status: 'active' })]); // back to work
    expect(r.alerts).toHaveLength(0);
    prev = r.next;
    r = computeAlerts(prev, [makeAgent({ status: 'waiting' })]); // waiting again
    expect(r.alerts).toHaveLength(1);
  });
});

describe('context saturation alerts', () => {
  const withCtx = (pct: number, over: Partial<AgentState> = {}): AgentState => makeAgent({
    context: { used: pct * 1000, peak: pct * 1000, window: 100_000, windowSource: 'reported', compactions: 0, updatedAt: 0 },
    ...over,
  });

  it('alerts once when a main agent crosses 85% of its window', () => {
    const prev = snap([withCtx(70)]);
    const { alerts, next } = computeAlerts(prev, [withCtx(86)]);
    expect(alerts).toEqual([{ agentId: 'sess-1', name: 'hero', category: 'context' }]);
    const again = computeAlerts(next, [withCtx(88)]);
    expect(again.alerts).toEqual([]);
  });

  it('re-arms only after the context drops below 70%', () => {
    let state = snap([withCtx(86)]); // first sight above threshold: baseline, no alert
    let r = computeAlerts(state, [withCtx(80)]);
    expect(r.alerts).toEqual([]);
    r = computeAlerts(r.next, [withCtx(60)]);
    expect(r.alerts).toEqual([]);
    r = computeAlerts(r.next, [withCtx(86)]);
    expect(r.alerts.map((a) => a.category)).toEqual(['context']);
    state = r.next;
    expect(computeAlerts(state, [withCtx(95)]).alerts).toEqual([]);
  });

  it('never alerts for subagents or when the window is unknown', () => {
    const sub = snap([withCtx(10, { id: 'agent-x', isSubagent: true })]);
    expect(computeAlerts(sub, [withCtx(90, { id: 'agent-x', isSubagent: true })]).alerts).toEqual([]);
    const prev = snap([makeAgent()]);
    const unknown = makeAgent({ context: { used: 900_000, peak: 900_000, window: null, windowSource: 'default', compactions: 0, updatedAt: 0 } });
    expect(computeAlerts(prev, [unknown]).alerts).toEqual([]);
  });
});
