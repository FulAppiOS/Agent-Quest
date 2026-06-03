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
    tokenUsage: { input: 0, output: 0, cacheRead: 0 },
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

  it('alerts when lastErrorAt advances', () => {
    const prev = snap([makeAgent({ status: 'active', lastErrorAt: undefined })]);
    const { alerts } = computeAlerts(prev, [makeAgent({ status: 'active', lastErrorAt: 123 })]);
    expect(alerts[0]?.category).toBe('error');
  });

  it('prioritizes error over waiting on a simultaneous change', () => {
    const prev = snap([makeAgent({ status: 'active', lastErrorAt: 1 })]);
    const { alerts } = computeAlerts(prev, [makeAgent({ status: 'waiting', lastErrorAt: 2 })]);
    expect(alerts[0]?.category).toBe('error');
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
