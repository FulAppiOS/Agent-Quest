import { describe, it, expect } from 'bun:test';
import type { AgentState } from '../types/agent';
import { computeShowSourceBadge, filterAgentsForPresentation } from './agentPresentation';

function makeAgent(overrides: Partial<AgentState>): AgentState {
  const base: AgentState = {
    id: 'a1',
    name: 'Hero',
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
  } as AgentState;
  return { ...base, ...overrides };
}

describe('filterAgentsForPresentation', () => {
  it('default OFF: active, idle, and waiting pass; completed and error are hidden', () => {
    const agents: AgentState[] = [
      makeAgent({ id: 'active1', status: 'active' }),
      makeAgent({ id: 'idle1', status: 'idle' }),
      makeAgent({ id: 'wait1', status: 'waiting' }),
      makeAgent({ id: 'done1', status: 'completed' }),
      makeAgent({ id: 'err1', status: 'error' }),
    ];
    const visible = filterAgentsForPresentation(agents, false);
    expect(visible.map((a) => a.id).sort()).toEqual(['active1', 'idle1', 'wait1']);
  });

  it('toggle ON: active, idle, waiting, and completed all pass', () => {
    const agents: AgentState[] = [
      makeAgent({ id: 'active1', status: 'active' }),
      makeAgent({ id: 'idle1', status: 'idle' }),
      makeAgent({ id: 'wait1', status: 'waiting' }),
      makeAgent({ id: 'done1', status: 'completed' }),
    ];
    const visible = filterAgentsForPresentation(agents, true);
    expect(visible.map((a) => a.id).sort()).toEqual(['active1', 'done1', 'idle1', 'wait1']);
  });

  it('toggle ON: error remains hidden', () => {
    const agents: AgentState[] = [
      makeAgent({ id: 'err1', status: 'error' }),
      makeAgent({ id: 'done1', status: 'completed' }),
    ];
    const visible = filterAgentsForPresentation(agents, true);
    expect(visible.map((a) => a.id).sort()).toEqual(['done1']);
  });

  it('waiting passes regardless of the completed toggle (regression for turn-end heroes)', () => {
    const agents: AgentState[] = [makeAgent({ id: 'turnend', status: 'waiting' })];
    expect(filterAgentsForPresentation(agents, false).map((a) => a.id)).toEqual(['turnend']);
    expect(filterAgentsForPresentation(agents, true).map((a) => a.id)).toEqual(['turnend']);
  });

  it('preserves all idle and active agents regardless of toggle', () => {
    const agents: AgentState[] = [
      makeAgent({ id: 'a', status: 'active' }),
      makeAgent({ id: 'b', status: 'idle' }),
      makeAgent({ id: 'c', status: 'active' }),
    ];
    expect(filterAgentsForPresentation(agents, false).length).toBe(3);
    expect(filterAgentsForPresentation(agents, true).length).toBe(3);
  });

  it('returns empty array for empty input', () => {
    expect(filterAgentsForPresentation([], false)).toEqual([]);
    expect(filterAgentsForPresentation([], true)).toEqual([]);
  });
});

describe('computeShowSourceBadge', () => {
  it('returns false when no agents', () => {
    expect(computeShowSourceBadge([])).toBe(false);
  });

  it('returns false when only one provider has live agents', () => {
    const agents: AgentState[] = [
      makeAgent({ id: 'c1', source: 'claude', status: 'active' }),
      makeAgent({ id: 'c2', source: 'claude', status: 'idle' }),
    ];
    expect(computeShowSourceBadge(agents)).toBe(false);
  });

  it('returns true when both providers have at least one live agent', () => {
    const agents: AgentState[] = [
      makeAgent({ id: 'c1', source: 'claude', status: 'active' }),
      makeAgent({ id: 'x1', source: 'codex', status: 'idle' }),
    ];
    expect(computeShowSourceBadge(agents)).toBe(true);
  });

  it('ignores completed and error agents when computing liveness', () => {
    const agents: AgentState[] = [
      makeAgent({ id: 'c1', source: 'claude', status: 'active' }),
      makeAgent({ id: 'x1', source: 'codex', status: 'completed' }),
      makeAgent({ id: 'x2', source: 'codex', status: 'error' }),
    ];
    expect(computeShowSourceBadge(agents)).toBe(false);
  });

  it('handles a single live codex agent alongside a completed claude agent', () => {
    const agents: AgentState[] = [
      makeAgent({ id: 'c1', source: 'claude', status: 'completed' }),
      makeAgent({ id: 'x1', source: 'codex', status: 'active' }),
    ];
    expect(computeShowSourceBadge(agents)).toBe(false);
  });

  it('counts waiting agents as live (consistent with filterAgentsForPresentation)', () => {
    const agents: AgentState[] = [
      makeAgent({ id: 'c1', source: 'claude', status: 'waiting' }),
      makeAgent({ id: 'x1', source: 'codex', status: 'active' }),
    ];
    expect(computeShowSourceBadge(agents)).toBe(true);
  });
});
