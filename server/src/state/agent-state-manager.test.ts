import { describe, test, expect } from 'bun:test';
import { AgentStateManager } from './agent-state-manager';
import type { ParsedEvent } from '../parsers/session-parser';

function makeEvent(overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    sessionId: 'sess-1',
    slug: 'bubbly-waddling-cat',
    timestamp: Date.now(),
    activity: 'reading',
    toolCalls: [{ id: 'tc-1', name: 'Read', timestamp: Date.now(), input: { file_path: '/foo.ts' } }],
    file: '/foo.ts',
    command: undefined,
    cwd: '/project',
    ...overrides,
  };
}

describe('AgentStateManager', () => {
  test('creates new agent on first event', () => {
    const mgr = new AgentStateManager();
    const result = mgr.processEvent(makeEvent());

    expect(result!.isNew).toBe(true);
    expect(result!.agent.id).toBe('sess-1');
    expect(result!.agent.name).toBe('bubbly-waddling-cat');
    expect(result!.agent.status).toBe('active');
    expect(result!.agent.currentActivity).toBe('reading');
  });

  test('derives idle status when last event is older than idle threshold', () => {
    const mgr = new AgentStateManager({ idleThresholdMs: 5 * 60_000, completedThresholdMs: 30 * 60_000 });
    const oldTs = Date.now() - 10 * 60_000; // 10 min ago
    const result = mgr.processEvent(makeEvent({ timestamp: oldTs }));

    expect(result!.agent.status).toBe('idle');
    expect(result!.agent.currentActivity).toBe('idle');
  });

  test('derives completed status when last event is older than completed threshold', () => {
    const mgr = new AgentStateManager({ idleThresholdMs: 5 * 60_000, completedThresholdMs: 30 * 60_000 });
    const veryOldTs = Date.now() - 60 * 60_000; // 1 hour ago
    const result = mgr.processEvent(makeEvent({ timestamp: veryOldTs }));

    expect(result!.agent.status).toBe('completed');
  });

  test('isTurnEnd event sets status to waiting and activity to idle', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent());
    const result = mgr.processEvent(makeEvent({
      isTurnEnd: true,
      activity: 'thinking',
      toolCalls: [],
      file: undefined,
    }));

    expect(result!.agent.status).toBe('waiting');
    // Activity must drop to 'idle' so the hero relocates to the tavern,
    // not stay in the Wizard Tower (the building mapped to 'thinking').
    expect(result!.agent.currentActivity).toBe('idle');
  });

  test('hasError event records lastErrorAt', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent());
    const errTs = Date.now();
    mgr.processEvent(makeEvent({
      hasError: true,
      timestamp: errTs,
      activity: 'debugging',
      toolCalls: [],
      file: undefined,
    }));

    expect(mgr.getAgent('sess-1')!.lastErrorAt).toBe(errTs);
  });

  test('busy agent does NOT flip to idle within busy grace window', () => {
    const mgr = new AgentStateManager({
      idleThresholdMs: 5 * 60_000,
      completedThresholdMs: 30 * 60_000,
      busyIdleGraceMs: 20 * 60_000,
    });
    const old = Date.now() - 10 * 60_000; // 10 min ago — past idle threshold
    // task event marks busy
    mgr.processEvent({
      sessionId: 'sess-1',
      slug: 'x',
      timestamp: old,
      activity: 'idle',
      toolCalls: [],
      file: undefined,
      command: undefined,
      cwd: '/p',
      kind: 'task',
      currentTask: 'do stuff',
    });
    // assistant tool_use, not turn end
    mgr.processEvent(makeEvent({ timestamp: old, isTurnEnd: false }));

    const agent = mgr.getAgent('sess-1')!;
    expect(agent.busy).toBe(true);
    expect(agent.status).toBe('active'); // 10min < 20min grace
  });

  test('busy agent flips to idle once busy grace exceeded', () => {
    const mgr = new AgentStateManager({
      idleThresholdMs: 5 * 60_000,
      completedThresholdMs: 30 * 60_000,
      busyIdleGraceMs: 20 * 60_000,
    });
    const veryOld = Date.now() - 25 * 60_000;
    mgr.processEvent({
      sessionId: 'sess-1', slug: 'x', timestamp: veryOld, activity: 'idle',
      toolCalls: [], file: undefined, command: undefined, cwd: '/p',
      kind: 'task', currentTask: 'do stuff',
    });
    mgr.processEvent(makeEvent({ timestamp: veryOld, isTurnEnd: false }));

    const agent = mgr.getAgent('sess-1')!;
    expect(agent.status).toBe('idle'); // past 20min grace
  });

  test('user-prompt task event on idle agent transitions currentActivity to thinking', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ timestamp: Date.now() }));
    const agent = mgr.getAgent('sess-1')!;
    // Simulate the agent having just finished a turn — sitting at the Tavern.
    agent.currentActivity = 'idle';
    agent.status = 'waiting';
    agent.busy = false;

    // Parser emits 'thinking' for a fresh user-typed prompt.
    mgr.processEvent({
      sessionId: 'sess-1',
      slug: undefined,
      timestamp: Date.now(),
      activity: 'thinking',
      toolCalls: [],
      file: undefined,
      command: undefined,
      cwd: '/p',
      kind: 'task',
      currentTask: 'fresh follow-up',
    });

    const after = mgr.getAgent('sess-1')!;
    expect(after.currentActivity).toBe('thinking');
    expect(after.status).toBe('active');
    expect(after.busy).toBe(true);
    expect(after.currentTask).toBe('fresh follow-up');
  });

  test('task event does NOT override a non-idle currentActivity', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ activity: 'reading', file: '/foo.ts' }));

    // last-prompt events come with activity='idle' and must not teleport the hero.
    mgr.processEvent({
      sessionId: 'sess-1',
      slug: undefined,
      timestamp: Date.now(),
      activity: 'idle',
      toolCalls: [],
      file: undefined,
      command: undefined,
      cwd: undefined,
      kind: 'task',
      currentTask: 'repeated prompt',
    });

    expect(mgr.getAgent('sess-1')!.currentActivity).toBe('reading');
  });

  test('task event revives a completed agent to active', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ sessionId: 'sess-1', timestamp: Date.now() - 60 * 60_000 }));
    expect(mgr.getAgent('sess-1')!.status).toBe('completed');

    // User submits a fresh prompt (last-prompt event)
    mgr.processEvent({
      sessionId: 'sess-1',
      slug: undefined,
      timestamp: Date.now(),
      activity: 'idle',
      toolCalls: [],
      file: undefined,
      command: undefined,
      cwd: undefined,
      kind: 'task',
      currentTask: 'a fresh question',
    });

    const agent = mgr.getAgent('sess-1')!;
    expect(agent.status).toBe('active');
    expect(agent.currentTask).toBe('a fresh question');
  });

  test('isTurnEnd clears busy flag', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent({
      sessionId: 'sess-1', slug: 'x', timestamp: Date.now(), activity: 'idle',
      toolCalls: [], file: undefined, command: undefined, cwd: '/p',
      kind: 'task', currentTask: 't',
    });
    mgr.processEvent(makeEvent({ isTurnEnd: false }));
    expect(mgr.getAgent('sess-1')!.busy).toBe(true);
    mgr.processEvent(makeEvent({ isTurnEnd: true, toolCalls: [], file: undefined }));
    expect(mgr.getAgent('sess-1')!.busy).toBe(false);
  });

  test('checkIdleAgents respects busy grace', () => {
    const mgr = new AgentStateManager({
      idleThresholdMs: 5 * 60_000,
      completedThresholdMs: 30 * 60_000,
      busyIdleGraceMs: 20 * 60_000,
    });
    mgr.processEvent(makeEvent({ sessionId: 'sess-1', timestamp: Date.now() }));
    const agent = mgr.getAgent('sess-1')!;
    agent.busy = true;
    agent.lastEvent = Date.now() - 10 * 60_000; // past idle but within busy grace

    mgr.checkIdleAgents(5 * 60_000);
    expect(agent.status).toBe('active'); // skipped because busy
  });

  test('replay of fresh events ends in active status', () => {
    const mgr = new AgentStateManager({ idleThresholdMs: 5 * 60_000, completedThresholdMs: 30 * 60_000 });
    const oldTs = Date.now() - 60 * 60_000;
    const recentTs = Date.now() - 10_000;
    mgr.processEvent(makeEvent({ timestamp: oldTs }));
    const result = mgr.processEvent(makeEvent({ timestamp: recentTs, activity: 'editing', file: '/x.ts' }));

    expect(result!.agent.status).toBe('active');
    expect(result!.agent.currentActivity).toBe('editing');
  });

  test('updates existing agent on subsequent events', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent());

    const result = mgr.processEvent(makeEvent({ activity: 'editing', file: '/bar.ts' }));
    expect(result!.isNew).toBe(false);
    expect(result!.agent.currentActivity).toBe('editing');
    expect(result!.agent.currentFile).toBe('/bar.ts');
  });

  test('subagent sessionId with descriptor extracts descriptor as name', () => {
    const mgr = new AgentStateManager();
    const result = mgr.processEvent(makeEvent({
      sessionId: 'agent-aside_question-43e8a1e24296c9a5',
      slug: 'wobbly-wishing-stallman', // parent's slug — must NOT be used for subagent
      cwd: '/home/user/projects/example',
    }));
    expect(result!.agent.name).toBe('aside_question');
  });

  test('subagent sessionId without descriptor uses hex prefix as name', () => {
    const mgr = new AgentStateManager();
    const result = mgr.processEvent(makeEvent({
      sessionId: 'agent-aeebbf05e75792fa1',
      slug: 'wobbly-wishing-stallman',
      cwd: '/home/user/projects/example',
    }));
    expect(result!.agent.name.startsWith('aeebbf05')).toBe(true);
  });

  test('subagent name is not overwritten by parent slug on update', () => {
    const mgr = new AgentStateManager();
    // First event: create subagent, derived name = 'aside_question'
    mgr.processEvent(makeEvent({
      sessionId: 'agent-aside_question-43e8a1e24296c9a5',
      slug: 'wobbly-wishing-stallman',
    }));
    // Subsequent event still carries the parent slug
    mgr.processEvent(makeEvent({
      sessionId: 'agent-aside_question-43e8a1e24296c9a5',
      slug: 'wobbly-wishing-stallman',
      activity: 'editing',
    }));
    expect(mgr.getAgent('agent-aside_question-43e8a1e24296c9a5')!.name).toBe('aside_question');
  });

  test('busy subagent stays active during a long silent tool run (no premature idle)', () => {
    const mgr = new AgentStateManager({
      idleThresholdMs: 5 * 60_000,
      busyIdleGraceMs: 20 * 60_000,
      subagentIdleThresholdMs: 120_000,
      subagentCompletedThresholdMs: 5 * 60_000,
      subagentBusyCompletedThresholdMs: 15 * 60_000,
    });
    const subId = 'agent-aside_question-43e8a1e24296c9a5';
    mgr.processEvent(makeEvent({ sessionId: subId, timestamp: Date.now() }));
    const agent = mgr.getAgent(subId)!;
    // Busy subagent silent for 10 minutes (long Opus turn / slow MCP call).
    agent.busy = true;
    agent.lastEvent = Date.now() - 10 * 60_000;

    mgr.checkIdleAgents(5 * 60_000);
    expect(agent.status).toBe('active');
    const completed = mgr.checkCompletedAgents(30 * 60_000);
    expect(completed).not.toContain(subId);
    expect(agent.status).toBe('active');
  });

  test('busy subagent silent past the crash timeout is force-completed', () => {
    const mgr = new AgentStateManager({
      subagentIdleThresholdMs: 120_000,
      subagentCompletedThresholdMs: 5 * 60_000,
      subagentBusyCompletedThresholdMs: 15 * 60_000,
    });
    const subId = 'agent-aside_question-43e8a1e24296c9a5';
    mgr.processEvent(makeEvent({ sessionId: subId, timestamp: Date.now() }));
    const agent = mgr.getAgent(subId)!;
    // Busy for 16 minutes — past the 15-min crash timeout: presumed dead.
    agent.busy = true;
    agent.lastEvent = Date.now() - 16 * 60_000;

    const completed = mgr.checkCompletedAgents(30 * 60_000);
    expect(completed).toContain(subId);
    expect(agent.status).toBe('completed');
    expect(agent.busy).toBe(false);
  });

  test('subagent stays active within its idle threshold', () => {
    const mgr = new AgentStateManager({
      subagentIdleThresholdMs: 120_000,
      subagentCompletedThresholdMs: 5 * 60_000,
    });
    const subId = 'agent-aside_question-43e8a1e24296c9a5';
    mgr.processEvent(makeEvent({ sessionId: subId, timestamp: Date.now() }));
    const agent = mgr.getAgent(subId)!;
    agent.busy = false;
    agent.lastEvent = Date.now() - 30_000; // 30s ago

    mgr.checkIdleAgents(5 * 60_000);
    expect(agent.status).toBe('active');
  });

  test('non-busy subagent transitions idle → completed after its shorter threshold (5 min)', () => {
    const mgr = new AgentStateManager({
      subagentIdleThresholdMs: 120_000,
      subagentCompletedThresholdMs: 5 * 60_000,
      subagentBusyCompletedThresholdMs: 15 * 60_000,
    });
    const subId = 'agent-aside_question-43e8a1e24296c9a5';
    mgr.processEvent(makeEvent({ sessionId: subId, timestamp: Date.now() }));
    // Simulate a subagent that finished its turn (busy=false) and went silent.
    mgr.getAgent(subId)!.busy = false;
    mgr.getAgent(subId)!.lastEvent = Date.now() - 6 * 60_000;

    mgr.checkIdleAgents(5 * 60_000);
    expect(mgr.getAgent(subId)!.status).toBe('idle');

    const completed = mgr.checkCompletedAgents(30 * 60_000);
    expect(completed).toContain(subId);
    expect(mgr.getAgent(subId)!.status).toBe('completed');
  });

  test('subagent idle is resurrected by a fresh tool event', () => {
    const mgr = new AgentStateManager({
      subagentIdleThresholdMs: 120_000,
      subagentBusyIdleGraceMs: 180_000,
      subagentCompletedThresholdMs: 5 * 60_000,
    });
    const subId = 'agent-aside_question-43e8a1e24296c9a5';
    // Seed at -4min so checkIdleAgents flips it to idle.
    mgr.processEvent(makeEvent({ sessionId: subId, timestamp: Date.now() - 4 * 60_000 }));
    mgr.checkIdleAgents(5 * 60_000);
    expect(mgr.getAgent(subId)!.status).toBe('idle');

    // Fresh tool event must revive the subagent.
    const result = mgr.processEvent(makeEvent({
      sessionId: subId,
      timestamp: Date.now(),
      activity: 'editing',
      file: '/bar.ts',
    }));
    expect(result!.agent.status).toBe('active');
    expect(result!.agent.currentActivity).toBe('editing');
  });

  test('subagent created with stale timestamp gets correct derived status', () => {
    const mgr = new AgentStateManager({
      subagentIdleThresholdMs: 120_000,
      subagentCompletedThresholdMs: 5 * 60_000,
    });
    const subId = 'agent-aside_question-43e8a1e24296c9a5';
    // First event for this subagent is already 10 min old — applyDerivedStatus
    // must demote it past 'active' immediately, not park a ghost at active.
    const result = mgr.processEvent(makeEvent({
      sessionId: subId,
      timestamp: Date.now() - 10 * 60_000,
    }));
    expect(result!.agent.status).toBe('completed');
    expect(result!.agent.currentActivity).toBe('idle');
  });

  test('parent agent still uses its 30-min completed threshold (subagent thresholds do not leak)', () => {
    const mgr = new AgentStateManager({
      idleThresholdMs: 5 * 60_000,
      completedThresholdMs: 30 * 60_000,
      subagentIdleThresholdMs: 120_000,
      subagentCompletedThresholdMs: 5 * 60_000,
    });
    mgr.processEvent(makeEvent({ sessionId: 'sess-1', timestamp: Date.now() }));
    // 10 min of silence — subagent would be completed, parent should just be idle.
    mgr.getAgent('sess-1')!.lastEvent = Date.now() - 10 * 60_000;
    mgr.getAgent('sess-1')!.busy = false;

    mgr.checkIdleAgents(5 * 60_000);
    expect(mgr.getAgent('sess-1')!.status).toBe('idle');

    const completed = mgr.checkCompletedAgents(30 * 60_000);
    expect(completed).not.toContain('sess-1');
    expect(mgr.getAgent('sess-1')!.status).toBe('idle');
  });

  test('assigns colors cyclically and the knight class to every main agent', () => {
    const mgr = new AgentStateManager();
    const r1 = mgr.processEvent(makeEvent({ sessionId: 'sess-1' }));
    const r2 = mgr.processEvent(makeEvent({ sessionId: 'sess-2', slug: 'another-slug' }));
    const r3 = mgr.processEvent(makeEvent({ sessionId: 'sess-3', slug: 'third-slug' }));

    expect(r1!.agent.heroClass).toBe('warrior');
    expect(r2!.agent.heroClass).toBe('warrior');
    expect(r3!.agent.heroClass).toBe('warrior');

    expect(r1!.agent.heroColor).toBe('blue');
    expect(r2!.agent.heroColor).toBe('yellow');
    expect(r3!.agent.heroColor).toBe('red');
  });

  test('tracks files modified from edit/write tool calls', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({
      activity: 'editing',
      toolCalls: [{ id: 'tc-1', name: 'Edit', timestamp: Date.now(), input: { file_path: '/src/a.ts' } }],
      file: '/src/a.ts',
    }));
    mgr.processEvent(makeEvent({
      activity: 'editing',
      toolCalls: [{ id: 'tc-2', name: 'Write', timestamp: Date.now(), input: { file_path: '/src/b.ts' } }],
      file: '/src/b.ts',
    }));

    const agent = mgr.getAgent('sess-1');
    expect(agent!.filesModified).toContain('/src/a.ts');
    expect(agent!.filesModified).toContain('/src/b.ts');
  });

  test('accumulates tool calls', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent());
    mgr.processEvent(makeEvent({
      toolCalls: [{ id: 'tc-2', name: 'Bash', timestamp: Date.now(), input: { command: 'npm test' } }],
      activity: 'bash',
    }));

    const agent = mgr.getAgent('sess-1');
    expect(agent!.toolCalls).toHaveLength(2);
  });

  test('getAll returns all agents', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ sessionId: 'sess-1' }));
    mgr.processEvent(makeEvent({ sessionId: 'sess-2', slug: 'other' }));

    expect(mgr.getAll()).toHaveLength(2);
  });

  test('markCompleted sets status to completed', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent());
    mgr.markCompleted('sess-1');

    const agent = mgr.getAgent('sess-1');
    expect(agent!.status).toBe('completed');
    expect(agent!.currentActivity).toBe('idle');
  });

  test('sets idle after inactivity threshold', () => {
    const mgr = new AgentStateManager();
    const oldTimestamp = Date.now() - 120_000; // 2 minutes ago
    mgr.processEvent(makeEvent({ timestamp: oldTimestamp }));
    // Simulate a finished turn (otherwise the busy grace would keep it active)
    mgr.getAgent('sess-1')!.busy = false;

    mgr.checkIdleAgents(60_000); // 60s threshold
    const agent = mgr.getAgent('sess-1');
    expect(agent!.status).toBe('idle');
    expect(agent!.currentActivity).toBe('idle');
  });

  test('checkCompletedAgents transitions idle to completed', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ sessionId: 'sess-1', timestamp: Date.now() }));
    // Simulate the agent going silent: rewind lastEvent to 40 min ago.
    mgr.getAgent('sess-1')!.lastEvent = Date.now() - 40 * 60_000;

    // First make it idle
    mgr.checkIdleAgents(5 * 60_000);
    expect(mgr.getAgent('sess-1')!.status).toBe('idle');

    // Then transition to completed after 30 min
    const completed = mgr.checkCompletedAgents(30 * 60_000);
    expect(completed).toContain('sess-1');
    expect(mgr.getAgent('sess-1')!.status).toBe('completed');
  });

  test('checkCompletedAgents does not touch active agents', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ sessionId: 'sess-1', timestamp: Date.now() }));

    // Agent is still 'active' — checkCompletedAgents should skip it
    const completed = mgr.checkCompletedAgents(30 * 60_000);
    expect(completed).toHaveLength(0);
    expect(mgr.getAgent('sess-1')!.status).toBe('active');
  });

  test('cleanupStaleAgents removes completed agents past threshold', () => {
    const mgr = new AgentStateManager();
    const staleTimestamp = Date.now() - 3 * 60 * 60_000; // 3 hours ago
    mgr.processEvent(makeEvent({ sessionId: 'stale-1', timestamp: staleTimestamp }));
    mgr.processEvent(makeEvent({ sessionId: 'fresh-1', timestamp: Date.now() }));

    // Full lifecycle for stale agent: active → idle → completed
    mgr.checkIdleAgents(5 * 60_000);
    mgr.checkCompletedAgents(30 * 60_000);

    // Cleanup agents completed for more than 2 hours (minKeep=1 for this test)
    const removed = mgr.cleanupStaleAgents(2 * 60 * 60_000, 1);

    expect(removed).toContain('stale-1');
    expect(removed).not.toContain('fresh-1');
    expect(mgr.getAgent('stale-1')).toBeUndefined();
    expect(mgr.getAgent('fresh-1')).toBeDefined();
  });

  test('cleanupStaleAgents does not remove active or idle agents', () => {
    const mgr = new AgentStateManager();
    const oldTimestamp = Date.now() - 3 * 60 * 60_000;
    mgr.processEvent(makeEvent({ sessionId: 'active-old', timestamp: oldTimestamp }));
    mgr.processEvent(makeEvent({ sessionId: 'idle-old', timestamp: oldTimestamp, slug: 'idle-slug' }));

    // Make one idle but NOT completed
    mgr.checkIdleAgents(5 * 60_000);
    // active-old was also made idle — let's re-activate it
    mgr.processEvent(makeEvent({ sessionId: 'active-old', timestamp: Date.now() }));

    const removed = mgr.cleanupStaleAgents(2 * 60 * 60_000);
    expect(removed).toHaveLength(0);
  });

  test('cleanupStaleAgents keeps at least minKeep agents', () => {
    const mgr = new AgentStateManager();
    const veryOld = Date.now() - 5 * 60 * 60_000; // 5 hours ago

    // Create 3 agents, all very old and completed
    for (let i = 1; i <= 3; i++) {
      mgr.processEvent(makeEvent({
        sessionId: `old-${i}`,
        slug: `old-${i}`,
        timestamp: veryOld + i * 1000, // slightly different timestamps
      }));
    }
    mgr.checkIdleAgents(5 * 60_000);
    mgr.checkCompletedAgents(30 * 60_000);

    // With minKeep=5, we have only 3 agents — none should be removed
    const removed = mgr.cleanupStaleAgents(2 * 60 * 60_000, 5);
    expect(removed).toHaveLength(0);
    expect(mgr.getAll()).toHaveLength(3);
  });

  test('cleanupStaleAgents respects minKeep with mixed agents', () => {
    const mgr = new AgentStateManager();
    const veryOld = Date.now() - 5 * 60 * 60_000;

    // 3 fresh active agents + 4 old completed agents = 7 total
    for (let i = 1; i <= 3; i++) {
      mgr.processEvent(makeEvent({ sessionId: `fresh-${i}`, slug: `fresh-${i}`, timestamp: Date.now() }));
    }
    for (let i = 1; i <= 4; i++) {
      mgr.processEvent(makeEvent({ sessionId: `old-${i}`, slug: `old-${i}`, timestamp: veryOld + i * 1000 }));
    }
    mgr.checkIdleAgents(5 * 60_000);
    mgr.checkCompletedAgents(30 * 60_000);

    // minKeep=5: 3 fresh + need 2 more = keep 2 of the 4 old ones, remove 2
    const removed = mgr.cleanupStaleAgents(2 * 60 * 60_000, 5);
    expect(removed).toHaveLength(2);
    expect(mgr.getAll()).toHaveLength(5);
  });

  describe('resume-hint events', () => {
    const resumeHint = (sessionId = 'sess-1'): ParsedEvent => ({
      sessionId,
      slug: undefined,
      timestamp: 0,
      activity: 'idle',
      toolCalls: [],
      file: undefined,
      command: undefined,
      cwd: undefined,
      kind: 'task',
      currentTask: 'resumed prompt',
      isResumeHint: true,
    });

    test('does not create a new agent from a resume hint', () => {
      const mgr = new AgentStateManager();
      const result = mgr.processEvent(resumeHint('ghost-1'));
      expect(result).toBeNull();
      expect(mgr.getAgent('ghost-1')).toBeUndefined();
    });

    test('updates currentTask on existing agent without advancing lastEvent or busy', () => {
      const mgr = new AgentStateManager();
      const createdAt = Date.now() - 60 * 60_000; // 1h ago — would be `completed`
      mgr.processEvent(makeEvent({ timestamp: createdAt }));
      const before = mgr.getAgent('sess-1')!;
      const beforeLastEvent = before.lastEvent;
      const beforeStatus = before.status;
      before.busy = false;

      mgr.processEvent(resumeHint('sess-1'));
      const after = mgr.getAgent('sess-1')!;
      expect(after.currentTask).toBe('resumed prompt');
      expect(after.lastEvent).toBe(beforeLastEvent);
      expect(after.busy).toBe(false);
      expect(after.status).toBe(beforeStatus); // still completed, not resurrected
    });
  });

  describe('liveness oracle integration', () => {
    const makeOracle = (live: string[]) => ({
      hasAnyLive: () => live.length > 0,
      isLive: (sid: string) => live.includes(sid),
    });

    test('forces non-live UUID sessionId to completed', () => {
      const oracle = makeOracle(['other-live-sid']);
      const mgr = new AgentStateManager({ livenessOracle: oracle });
      const result = mgr.processEvent(makeEvent({ sessionId: 'dead-sid', timestamp: Date.now() }));

      expect(result!.agent.status).toBe('completed');
      expect(result!.agent.currentActivity).toBe('idle');
      expect(result!.agent.busy).toBe(false);
    });

    test('preserves lifecycle for live sessionId', () => {
      const oracle = makeOracle(['live-sid']);
      const mgr = new AgentStateManager({ livenessOracle: oracle });
      const result = mgr.processEvent(makeEvent({ sessionId: 'live-sid', timestamp: Date.now() }));

      expect(result!.agent.status).toBe('active');
    });

    test('falls back to JSONL lifecycle when oracle has no data yet', () => {
      const oracle = { hasAnyLive: () => false, isLive: () => false };
      const mgr = new AgentStateManager({ livenessOracle: oracle });
      const result = mgr.processEvent(makeEvent({ sessionId: 'sess-1', timestamp: Date.now() }));

      expect(result!.agent.status).toBe('active');
    });

    test('bypasses oracle for subagent sessionIds (no pid file ever exists for them)', () => {
      const oracle = makeOracle(['some-other-sid']);
      const mgr = new AgentStateManager({ livenessOracle: oracle });
      const result = mgr.processEvent(makeEvent({
        sessionId: 'agent-aside_question-43e8a1e24296c9a5',
        timestamp: Date.now(),
      }));

      expect(result!.agent.status).toBe('active');
    });

    test('refreshAll demotes an agent whose pid just died while others stay live', () => {
      // Keep one session live the whole time so `hasAnyLive()` stays true — this
      // mirrors the real scenario where the dashboard has N sessions and one of
      // them exits. The degenerate "every pid dies at once" case is handled by
      // falling back to JSONL lifecycle (see 'falls back…' test above).
      let liveList = ['sess-1', 'anchor'];
      const oracle = {
        hasAnyLive: () => liveList.length > 0,
        isLive: (sid: string) => liveList.includes(sid),
      };
      const mgr = new AgentStateManager({ livenessOracle: oracle });
      mgr.processEvent(makeEvent({ sessionId: 'sess-1', timestamp: Date.now() }));
      mgr.processEvent(makeEvent({ sessionId: 'anchor', slug: 'anchor-slug', timestamp: Date.now() }));
      expect(mgr.getAgent('sess-1')!.status).toBe('active');

      liveList = ['anchor']; // sess-1's pid died
      const changed = mgr.refreshAll();
      expect(changed).toContain('sess-1');
      expect(changed).not.toContain('anchor');
      expect(mgr.getAgent('sess-1')!.status).toBe('completed');
      expect(mgr.getAgent('anchor')!.status).toBe('active');
    });
  });

  test('getAll returns agents sorted by lastEvent descending', () => {
    const mgr = new AgentStateManager();
    const t1 = Date.now() - 10_000;
    const t2 = Date.now() - 5_000;
    const t3 = Date.now();

    mgr.processEvent(makeEvent({ sessionId: 'oldest', slug: 'oldest', timestamp: t1 }));
    mgr.processEvent(makeEvent({ sessionId: 'middle', slug: 'middle', timestamp: t2 }));
    mgr.processEvent(makeEvent({ sessionId: 'newest', slug: 'newest', timestamp: t3 }));

    const all = mgr.getAll();
    expect(all[0]!.id).toBe('newest');
    expect(all[1]!.id).toBe('middle');
    expect(all[2]!.id).toBe('oldest');
  });

  test('applyLivenessOverride skips non-claude sources', () => {
    const oracle = {
      hasAnyLive: () => true,
      isLive: (_: string) => false,
    };
    const m = new AgentStateManager({ livenessOracle: oracle });
    const ev: ParsedEvent = {
      sessionId: 'codex-thread-1',
      slug: undefined,
      timestamp: Date.now(),
      activity: 'thinking',
      toolCalls: [],
      file: undefined,
      command: undefined,
      cwd: '/tmp/proj',
      kind: 'tool',
      isTurnEnd: false,
    };
    const res = m.processEvent(ev, { configDir: '/home/x/.codex', source: 'codex' });
    expect(res).not.toBeNull();
    expect(res!.agent.source).toBe('codex');
    expect(res!.agent.status).toBe('active');  // NOT completed despite oracle saying "not live"
  });

  describe('isSubagent flag', () => {
    test('is false for a regular session', () => {
      const mgr = new AgentStateManager();
      const r = mgr.processEvent(makeEvent({ sessionId: 'sess-1' }));
      expect(r!.agent.isSubagent).toBe(false);
    });

    test('is true for an agent- session id', () => {
      const mgr = new AgentStateManager();
      const r = mgr.processEvent(makeEvent({ sessionId: 'agent-explore-43e8a1e24296c9a5' }));
      expect(r!.agent.isSubagent).toBe(true);
    });
  });

  describe('markTurnEnd (Stop hook)', () => {
    test('promotes an active agent to waiting and reports the change', () => {
      const mgr = new AgentStateManager();
      mgr.processEvent(makeEvent());
      expect(mgr.markTurnEnd('sess-1')).toBe(true);
      const a = mgr.getAgent('sess-1')!;
      expect(a.status).toBe('waiting');
      expect(a.currentActivity).toBe('idle');
      expect(a.busy).toBe(false);
    });

    test('is a no-op (false) when already waiting', () => {
      const mgr = new AgentStateManager();
      mgr.processEvent(makeEvent());
      mgr.markTurnEnd('sess-1');
      expect(mgr.markTurnEnd('sess-1')).toBe(false);
    });

    test('does not resurrect an idle/completed agent', () => {
      const mgr = new AgentStateManager({ idleThresholdMs: 5 * 60_000, completedThresholdMs: 30 * 60_000 });
      mgr.processEvent(makeEvent({ timestamp: Date.now() - 10 * 60_000 })); // idle
      expect(mgr.getAgent('sess-1')!.status).toBe('idle');
      expect(mgr.markTurnEnd('sess-1')).toBe(false);
      expect(mgr.getAgent('sess-1')!.status).toBe('idle');
    });

    test('ignores subagents and unknown ids', () => {
      const mgr = new AgentStateManager();
      mgr.processEvent(makeEvent({ sessionId: 'agent-x-43e8a1e24296c9a5' }));
      expect(mgr.markTurnEnd('agent-x-43e8a1e24296c9a5')).toBe(false);
      expect(mgr.markTurnEnd('does-not-exist')).toBe(false);
    });
  });

  describe('sticky waiting', () => {
    test('refreshAll does not revert a freshly-waiting agent back to active', () => {
      const mgr = new AgentStateManager();
      mgr.processEvent(makeEvent());
      mgr.markTurnEnd('sess-1');
      expect(mgr.getAgent('sess-1')!.status).toBe('waiting');
      // refreshAll re-derives status from lastEvent age (recent) — must keep waiting.
      mgr.refreshAll();
      expect(mgr.getAgent('sess-1')!.status).toBe('waiting');
    });

    test('a waiting agent still ages into idle after the idle threshold', () => {
      const mgr = new AgentStateManager({ idleThresholdMs: 5 * 60_000, completedThresholdMs: 30 * 60_000 });
      mgr.processEvent(makeEvent());
      mgr.markTurnEnd('sess-1');
      mgr.getAgent('sess-1')!.lastEvent = Date.now() - 10 * 60_000; // silent 10 min
      mgr.refreshAll();
      expect(mgr.getAgent('sess-1')!.status).toBe('idle');
    });

    test('genuine new activity moves a waiting agent back to active', () => {
      const mgr = new AgentStateManager();
      mgr.processEvent(makeEvent());
      mgr.markTurnEnd('sess-1');
      expect(mgr.getAgent('sess-1')!.status).toBe('waiting');
      mgr.processEvent(makeEvent({ activity: 'editing', file: '/x.ts' }));
      expect(mgr.getAgent('sess-1')!.status).toBe('active');
    });
  });

  describe('token usage accumulation (deduped by message id)', () => {
    test('counts a message\'s usage once even when its lines repeat', () => {
      const mgr = new AgentStateManager();
      const ev = { usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }, usageMessageId: 'm1' };
      mgr.processEvent(makeEvent(ev));        // creates agent
      mgr.processEvent(makeEvent(ev));        // same message id again (another content block)
      expect(mgr.getAgent('sess-1')!.tokenUsage).toEqual({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40 });
    });

    test('accumulates across distinct message ids', () => {
      const mgr = new AgentStateManager();
      mgr.processEvent(makeEvent({ usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }, usageMessageId: 'm1' }));
      mgr.processEvent(makeEvent({ usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, usageMessageId: 'm2' }));
      expect(mgr.getAgent('sess-1')!.tokenUsage).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44 });
    });

    test('events without usage leave totals untouched', () => {
      const mgr = new AgentStateManager();
      mgr.processEvent(makeEvent({ usage: { input: 5, output: 5, cacheRead: 5, cacheWrite: 5 }, usageMessageId: 'm1' }));
      mgr.processEvent(makeEvent({ activity: 'reading' })); // no usage
      expect(mgr.getAgent('sess-1')!.tokenUsage).toEqual({ input: 5, output: 5, cacheRead: 5, cacheWrite: 5 });
    });
  });

  describe('waiting → completed correctness', () => {
    test('a waiting agent ages to completed past the completed threshold (refreshAll)', () => {
      const mgr = new AgentStateManager({ idleThresholdMs: 5 * 60_000, completedThresholdMs: 30 * 60_000 });
      mgr.processEvent(makeEvent());
      mgr.markTurnEnd('sess-1');
      expect(mgr.getAgent('sess-1')!.status).toBe('waiting');
      mgr.getAgent('sess-1')!.lastEvent = Date.now() - 31 * 60_000; // silent 31 min
      const changed = mgr.refreshAll();
      expect(changed).toContain('sess-1');
      expect(mgr.getAgent('sess-1')!.status).toBe('completed');
    });

    test('waiting agents are aged by refreshAll, not the 30s active/idle sweep', () => {
      const mgr = new AgentStateManager({ idleThresholdMs: 5 * 60_000, completedThresholdMs: 30 * 60_000 });
      mgr.processEvent(makeEvent());
      mgr.markTurnEnd('sess-1');
      mgr.getAgent('sess-1')!.lastEvent = Date.now() - 40 * 60_000;
      // checkIdleAgents/checkCompletedAgents only act on active/idle — a waiting
      // agent is deliberately left untouched by them...
      mgr.checkIdleAgents(5 * 60_000);
      mgr.checkCompletedAgents(30 * 60_000);
      expect(mgr.getAgent('sess-1')!.status).toBe('waiting');
      // ...it's refreshAll (the 10s re-derive) that ages it to completed.
      mgr.refreshAll();
      expect(mgr.getAgent('sess-1')!.status).toBe('completed');
    });

    test('a waiting agent whose pid died is forced to completed immediately', () => {
      let live = ['sess-1', 'anchor'];
      const oracle = { hasAnyLive: () => live.length > 0, isLive: (s: string) => live.includes(s) };
      const mgr = new AgentStateManager({ livenessOracle: oracle });
      mgr.processEvent(makeEvent({ sessionId: 'sess-1', timestamp: Date.now() }));
      mgr.processEvent(makeEvent({ sessionId: 'anchor', slug: 'anchor', timestamp: Date.now() }));
      mgr.markTurnEnd('sess-1');
      expect(mgr.getAgent('sess-1')!.status).toBe('waiting');

      live = ['anchor']; // sess-1's process exited while it was waiting
      const changed = mgr.refreshAll();
      expect(changed).toContain('sess-1');
      expect(mgr.getAgent('sess-1')!.status).toBe('completed');
    });

    test('completed agent is not revived to waiting by a stray Stop hook', () => {
      const mgr = new AgentStateManager({ completedThresholdMs: 30 * 60_000 });
      mgr.processEvent(makeEvent({ timestamp: Date.now() - 60 * 60_000 })); // completed
      expect(mgr.getAgent('sess-1')!.status).toBe('completed');
      expect(mgr.markTurnEnd('sess-1')).toBe(false);
      expect(mgr.getAgent('sess-1')!.status).toBe('completed');
    });
  });
});

describe('AgentStateManager telemetry (context, skills, plugins, subagent linkage)', () => {
  const T0 = Date.now();

  function asst(over: Partial<ParsedEvent> = {}): ParsedEvent {
    return makeEvent({ timestamp: T0, kind: 'tool', isTurnEnd: false, ...over });
  }

  function telem(over: Partial<ParsedEvent> = {}): ParsedEvent {
    return {
      sessionId: 'sess-1', slug: undefined, timestamp: T0, activity: 'idle', toolCalls: [],
      file: undefined, command: undefined, cwd: '/project', kind: 'telemetry', ...over,
    };
  }

  const usage = (used: number, output = 500) => ({ input: 10, output, cacheRead: used - 10 - output, cacheWrite: 0 });

  test('derives context usage from Claude usage with the 200k default window', () => {
    const mgr = new AgentStateManager();
    const r = mgr.processEvent(asst({
      usage: { input: 10, output: 500, cacheRead: 40_000, cacheWrite: 2_000 }, usageMessageId: 'm1', model: 'claude-opus-4-6',
    }))!;
    expect(r.agent.context).toMatchObject({ used: 42_510, peak: 42_510, window: 200_000, windowSource: 'default', compactions: 0 });
    expect(r.agent.context!.updatedAt).toBe(T0);
  });

  test('infers the 1M window once usage exceeds 200k, keeps it, and counts a large drop as a compaction', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(asst({ usage: usage(150_000), usageMessageId: 'm1', model: 'claude-fable-5-1' }));
    const r2 = mgr.processEvent(asst({ usage: usage(300_000), usageMessageId: 'm2', model: 'claude-fable-5-1', timestamp: T0 + 1 }))!;
    expect(r2.agent.context).toMatchObject({ used: 300_000, window: 1_000_000, windowSource: 'inferred' });
    const r3 = mgr.processEvent(asst({ usage: usage(100_000), usageMessageId: 'm3', model: 'claude-fable-5-1', timestamp: T0 + 2 }))!;
    expect(r3.agent.context).toMatchObject({ used: 100_000, peak: 300_000, window: 1_000_000, windowSource: 'inferred', compactions: 1, lastCompactionAt: T0 + 2 });
  });

  test('a small step down is not a compaction', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(asst({ usage: usage(100_000), usageMessageId: 'm1' }));
    const r = mgr.processEvent(asst({ usage: usage(90_000), usageMessageId: 'm2', timestamp: T0 + 1 }))!;
    expect(r.agent.context!.compactions).toBe(0);
  });

  test('uses the [1m] model configured in settings.json as the window hint when it matches the session model', () => {
    const mgr = new AgentStateManager();
    const r = mgr.processEvent(asst({ usage: usage(50_000), usageMessageId: 'm1', model: 'claude-fable-5-1' }), { configuredModel: 'claude-fable-5-1[1m]' })!;
    expect(r.agent.context).toMatchObject({ window: 1_000_000, windowSource: 'configured' });

    const other = new AgentStateManager();
    const r2 = other.processEvent(asst({ usage: usage(50_000), usageMessageId: 'm1', model: 'claude-sonnet-4' }), { configuredModel: 'claude-opus-4-6[1m]' })!;
    expect(r2.agent.context).toMatchObject({ window: 200_000, windowSource: 'default' });
  });

  test('a [1m] model id or an explicit override sets the window', () => {
    const mgr = new AgentStateManager();
    const r = mgr.processEvent(asst({ usage: usage(50_000), usageMessageId: 'm1', model: 'claude-opus-5[1m]' }))!;
    expect(r.agent.context).toMatchObject({ window: 1_000_000, windowSource: 'configured' });

    const forced = new AgentStateManager({ claudeContextWindowOverride: '500000' });
    const r2 = forced.processEvent(asst({ usage: usage(50_000), usageMessageId: 'm1', model: 'claude-opus-4-6' }))!;
    expect(r2.agent.context).toMatchObject({ window: 500_000, windowSource: 'configured' });
  });

  test('explicit compaction markers increment the counter without touching activity, status or lastEvent', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(asst({ usage: usage(50_000), usageMessageId: 'm1' }));
    const r = mgr.processEvent(telem({ isCompaction: true, timestamp: T0 + 1000 }));
    expect(r).not.toBeNull();
    expect(r!.agent.context).toMatchObject({ compactions: 1, lastCompactionAt: T0 + 1000, used: 50_000 });
    expect(r!.agent.lastEvent).toBe(T0);
    expect(r!.agent.currentActivity).toBe('reading');
    expect(r!.agent.status).toBe('active');
  });

  test('telemetry for an unknown agent is ignored', () => {
    const mgr = new AgentStateManager();
    expect(mgr.processEvent(telem({ contextSample: { used: 10, window: 100 } }))).toBeNull();
    expect(mgr.getAll()).toHaveLength(0);
  });

  test('Codex context samples carry the reported window', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ kind: 'task', currentTask: 'audit', toolCalls: [], activity: 'thinking' }), { source: 'codex', configDir: '/home/x/.codex' });
    const r = mgr.processEvent(telem({ contextSample: { used: 214_503, window: 258_400 } }))!;
    expect(r.agent.context).toMatchObject({ used: 214_503, peak: 214_503, window: 258_400, windowSource: 'reported' });
    const r2 = mgr.processEvent(telem({ contextSample: { window: 258_400 } }));
    expect(r2).toBeNull(); // nothing visible changed
  });

  test('tracks skill loads: invocation + body size, per-message attribution and the active skill', () => {
    const mgr = new AgentStateManager();
    const skillCall = { id: 'tu-skill', name: 'Skill', timestamp: T0, input: { skill: 'superpowers:brainstorming' } };
    const r1 = mgr.processEvent(asst({
      attribution: { skill: 'superpowers:brainstorming', plugin: 'superpowers' },
      skillInvocations: ['superpowers:brainstorming'],
      toolCalls: [skillCall], activity: 'thinking', file: undefined,
      usage: usage(20_000, 500), usageMessageId: 'm1',
    }))!;
    expect(r1.agent.activeSkill).toBe('superpowers:brainstorming');

    expect(mgr.processEvent(telem({ toolResults: [{ toolUseId: 'tu-skill', chars: 42 }] }))).toBeNull();

    const r2 = mgr.processEvent(telem({ skillLoad: { path: '/x/plugins/cache/mkt/superpowers/1.0/skills/brainstorming', chars: 17_826 } }))!;
    expect(r2.agent.skills).toEqual([{
      name: 'superpowers:brainstorming', plugin: 'superpowers', loads: 1, loadTokens: 4_457,
      attributedMessages: 1, attributedOutputTokens: 500, firstUsedAt: T0, lastUsedAt: T0,
    }]);

    // Same API message split over a second JSONL line: attribution is not double counted.
    mgr.processEvent(asst({ attribution: { skill: 'superpowers:brainstorming', plugin: 'superpowers' }, usage: usage(20_000, 500), usageMessageId: 'm1', toolCalls: [], activity: 'thinking', file: undefined }));
    expect(mgr.getAgent('sess-1')!.skills[0]!.attributedMessages).toBe(1);

    // Next message without attribution clears the active skill but keeps the history.
    const r3 = mgr.processEvent(asst({ usage: usage(21_000, 300), usageMessageId: 'm2', timestamp: T0 + 5 }))!;
    expect(r3.agent.activeSkill).toBeUndefined();
    expect(r3.agent.skills).toHaveLength(1);
  });

  test('a skill body without a pending invocation is named from its path', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(asst());
    const r = mgr.processEvent(telem({ skillLoad: { path: '/Users/x/.claude/skills/dataviz', chars: 400 } }))!;
    expect(r.agent.skills[0]).toMatchObject({ name: 'dataviz', loads: 1, loadTokens: 100 });
    expect(r.agent.skills[0]!.plugin).toBeUndefined();
  });

  test('Codex skill loads name the skill directly and keep it active until the turn ends', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ kind: 'task', currentTask: 'go', toolCalls: [], activity: 'thinking' }), { source: 'codex' });
    const r = mgr.processEvent(asst({
      skillInvocations: ['pdf'], skillLoad: { name: 'pdf', chars: 800 }, activity: 'reading',
      toolCalls: [{ id: 'exec-1', name: 'Bash', timestamp: T0, input: { command: 'cat skills/pdf/SKILL.md' } }],
    }))!;
    expect(r.agent.activeSkill).toBe('pdf');
    expect(r.agent.skills[0]).toMatchObject({ name: 'pdf', loads: 1, loadTokens: 200 });
    const end = mgr.processEvent(asst({ isTurnEnd: true, toolCalls: [], activity: 'idle', file: undefined, timestamp: T0 + 1 }))!;
    expect(end.agent.activeSkill).toBeUndefined();
  });

  test('plugin tool calls accumulate calls and result tokens', () => {
    const mgr = new AgentStateManager();
    const call = { id: 'tu-mcp', name: 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot', timestamp: T0, input: {} };
    mgr.processEvent(asst({ toolCalls: [call], pluginCalls: [{ name: 'chrome-devtools-mcp', kind: 'plugin', toolUseId: 'tu-mcp' }], activity: 'thinking', file: undefined }));
    const r = mgr.processEvent(telem({ toolResults: [{ toolUseId: 'tu-mcp', chars: 800 }] }))!;
    expect(r.agent.plugins).toEqual([{ name: 'chrome-devtools-mcp', kind: 'plugin', calls: 1, resultTokens: 200, lastUsedAt: T0 }]);

    // Codex-style call with the result size already known.
    const r2 = mgr.processEvent(asst({ pluginCalls: [{ name: 'posthog', kind: 'mcp', toolUseId: 'x', resultChars: 40 }], toolCalls: [], activity: 'bash', file: undefined, timestamp: T0 + 1 }))!;
    expect(r2.agent.plugins.find((p) => p.name === 'posthog')).toMatchObject({ kind: 'mcp', calls: 1, resultTokens: 10 });
  });

  test('links a subagent result delivered before the child is discovered', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(asst({ toolCalls: [{ id: 'toolu_A', name: 'Agent', timestamp: T0, input: { prompt: 'x' } }], activity: 'reviewing', file: undefined }));
    expect(mgr.processEvent(telem({ toolResults: [{ toolUseId: 'toolu_A', chars: 400 }] }))).toBeNull();

    const child = mgr.processEvent(
      makeEvent({ sessionId: 'agent-child1' }),
      { isSubagent: true, parentId: 'sess-1', spawnToolUseId: 'toolu_A', subagentType: 'Explore' },
    )!;
    expect(child.agent).toMatchObject({ isSubagent: true, parentId: 'sess-1', subagentType: 'Explore', returnedTokens: 100 });
  });

  test('links a subagent result delivered after the child exists, including task notifications', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ sessionId: 'agent-child2' }), { isSubagent: true, parentId: 'sess-1', spawnToolUseId: 'toolu_B' });
    mgr.processEvent(asst({ toolCalls: [{ id: 'toolu_B', name: 'Agent', timestamp: T0, input: {} }], activity: 'reviewing', file: undefined }));
    const r = mgr.processEvent(telem({ taskNotification: { toolUseId: 'toolu_B', resultChars: 200 } }))!;
    expect(r.agent.id).toBe('agent-child2');
    expect(r.agent.returnedTokens).toBe(50);
    mgr.processEvent(telem({ toolResults: [{ toolUseId: 'toolu_B', chars: 400 }] }));
    expect(mgr.getAgent('agent-child2')!.returnedTokens).toBe(150);
  });

  test('Codex subagents follow the subagent lifecycle even without the agent- prefix', () => {
    const mgr = new AgentStateManager({ subagentIdleThresholdMs: 1000, subagentCompletedThresholdMs: 60_000 });
    const r = mgr.processEvent(
      asst({ sessionId: 'codex-child', isTurnEnd: true, toolCalls: [], activity: 'idle', file: undefined, timestamp: T0 - 1500 }),
      { source: 'codex', isSubagent: true, parentId: 'codex-parent' },
    )!;
    expect(r.agent.isSubagent).toBe(true);
    expect(r.agent.parentId).toBe('codex-parent');
    expect(r.agent.status).toBe('idle');
  });

  test('Codex turn_context model telemetry updates the model once', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ kind: 'task', currentTask: 'go', toolCalls: [], activity: 'thinking' }), { source: 'codex' });
    const r = mgr.processEvent(telem({ model: 'gpt-6-astra' }))!;
    expect(r.agent.model).toBe('gpt-6-astra');
    expect(mgr.processEvent(telem({ model: 'gpt-6-astra' }))).toBeNull();
  });
});

describe('AgentStateManager review fixes', () => {
  const T0 = Date.now();
  function asst(over: Partial<ParsedEvent> = {}): ParsedEvent {
    return makeEvent({ timestamp: T0, kind: 'tool', isTurnEnd: false, ...over });
  }
  function telem(over: Partial<ParsedEvent> = {}): ParsedEvent {
    return {
      sessionId: 'sess-1', slug: undefined, timestamp: T0, activity: 'idle', toolCalls: [],
      file: undefined, command: undefined, cwd: '/project', kind: 'telemetry', ...over,
    };
  }
  const usage = (used: number, output = 500) => ({ input: 10, output, cacheRead: used - 10 - output, cacheWrite: 0 });

  test('one real compaction (marker, zero sample, second marker, small sample) counts once and the bar never shows 0', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ kind: 'task', currentTask: 'go', toolCalls: [], activity: 'thinking' }), { source: 'codex' });
    mgr.processEvent(telem({ contextSample: { used: 235_492, window: 258_400 } }));
    const m1 = mgr.processEvent(telem({ isCompaction: true, timestamp: T0 + 1 }));
    expect(m1).not.toBeNull();
    expect(mgr.processEvent(telem({ contextSample: { window: 258_400 }, timestamp: T0 + 2 }))).toBeNull();
    expect(mgr.processEvent(telem({ isCompaction: true, timestamp: T0 + 3 }))).toBeNull();
    const after = mgr.processEvent(telem({ contextSample: { used: 33_625, window: 258_400 }, timestamp: T0 + 4 }))!;
    expect(after.agent.context).toMatchObject({ used: 33_625, peak: 235_492, compactions: 1, lastCompactionAt: T0 + 1 });
    // The episode is over: a later genuine drop counts again.
    mgr.processEvent(telem({ contextSample: { used: 200_000, window: 258_400 }, timestamp: T0 + 5 }));
    const second = mgr.processEvent(telem({ contextSample: { used: 40_000, window: 258_400 }, timestamp: T0 + 6 }))!;
    expect(second.agent.context!.compactions).toBe(2);
  });

  test('a Claude compaction marker followed by the post-compaction usage counts once', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(asst({ usage: usage(150_000), usageMessageId: 'm1' }));
    mgr.processEvent(telem({ isCompaction: true, timestamp: T0 + 1 }));
    mgr.processEvent(telem({ isCompaction: true, timestamp: T0 + 2 })); // isCompactSummary line
    const r = mgr.processEvent(asst({ usage: usage(30_000), usageMessageId: 'm2', timestamp: T0 + 3 }))!;
    expect(r.agent.context).toMatchObject({ used: 30_000, compactions: 1 });
  });

  test('model and window telemetry that precede the first real event are applied when the agent is created', () => {
    const mgr = new AgentStateManager();
    expect(mgr.processEvent(telem({ contextSample: { window: 258_400 } }))).toBeNull();
    expect(mgr.processEvent(telem({ model: 'gpt-6-astra' }))).toBeNull();
    const r = mgr.processEvent(makeEvent({ kind: 'task', currentTask: 'go', toolCalls: [], activity: 'thinking' }), { source: 'codex' })!;
    expect(r.agent.model).toBe('gpt-6-astra');
    expect(r.agent.context).toMatchObject({ window: 258_400, windowSource: 'reported', used: 0 });
  });

  test('a background subagent task-notification replaces the launch acknowledgement credit', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ sessionId: 'agent-bg' }), { isSubagent: true, parentId: 'sess-1', spawnToolUseId: 'toolu_C' });
    mgr.processEvent(asst({ toolCalls: [{ id: 'toolu_C', name: 'Agent', timestamp: T0, input: {} }], activity: 'reviewing', file: undefined }));
    mgr.processEvent(telem({ toolResults: [{ toolUseId: 'toolu_C', chars: 1_088 }] })); // "async_launched" ack
    expect(mgr.getAgent('agent-bg')!.returnedTokens).toBe(272);
    mgr.processEvent(telem({ taskNotification: { toolUseId: 'toolu_C', resultChars: 594 } }));
    expect(mgr.getAgent('agent-bg')!.returnedTokens).toBe(149);
  });

  test('a skill body is matched to the pending invocation whose name ends with the path basename, not blindly FIFO', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(asst({
      skillInvocations: ['superpowers:brainstorming', 'dataviz'], toolCalls: [], activity: 'thinking', file: undefined,
    }));
    const r = mgr.processEvent(telem({ skillLoad: { path: '/Users/x/.claude/skills/dataviz', chars: 400 } }))!;
    expect(r.agent.skills.find((s) => s.name === 'dataviz')).toMatchObject({ loads: 1, loadTokens: 100 });
    expect(r.agent.skills.find((s) => s.name === 'superpowers:brainstorming')).toMatchObject({ loads: 0 });
    const r2 = mgr.processEvent(telem({ skillLoad: { path: '/x/plugins/cache/mkt/superpowers/1.0/skills/brainstorming', chars: 800 }, timestamp: T0 + 1 }))!;
    expect(r2.agent.skills.find((s) => s.name === 'superpowers:brainstorming')).toMatchObject({ loads: 1, loadTokens: 200 });
  });

  test('synthetic assistant lines never overwrite the model or the context', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(asst({ usage: usage(50_000), usageMessageId: 'm1', model: 'claude-opus-4-6' }));
    const r = mgr.processEvent(asst({ model: '<synthetic>', toolCalls: [], activity: 'thinking', file: undefined, timestamp: T0 + 1 }))!;
    expect(r.agent.model).toBe('claude-opus-4-6');
    expect(r.agent.context).toMatchObject({ used: 50_000 });
    const fresh = new AgentStateManager();
    const first = fresh.processEvent(asst({ model: '<synthetic>', toolCalls: [], activity: 'thinking', file: undefined }))!;
    expect(first.agent.model).toBeUndefined();
  });
});

describe('hero class and color by role', () => {
  const T0 = Date.now();
  const ev = (sessionId: string): ParsedEvent => makeEvent({ sessionId, timestamp: T0, slug: undefined, cwd: `/p/${sessionId}` });

  test('main agents are always knights (warrior) while colors keep rotating', () => {
    const mgr = new AgentStateManager();
    const a = mgr.processEvent(ev('main-1'))!.agent;
    const b = mgr.processEvent(ev('main-2'))!.agent;
    const c = mgr.processEvent(ev('main-3'))!.agent;
    expect([a.heroClass, b.heroClass, c.heroClass]).toEqual(['warrior', 'warrior', 'warrior']);
    expect(new Set([a.heroColor, b.heroColor, c.heroColor]).size).toBe(3);
  });

  test('subagents are pawns, workflow agents are archers, and both inherit the parent color', () => {
    const mgr = new AgentStateManager();
    const parent = mgr.processEvent(ev('main-1'))!.agent;
    const task = mgr.processEvent(ev('agent-aaaaaaaaaaaaaaaa'), { isSubagent: true, parentId: 'main-1' })!.agent;
    const wf = mgr.processEvent(ev('agent-bbbbbbbbbbbbbbbb'), { isSubagent: true, parentId: 'main-1', isWorkflow: true })!.agent;
    const codex = mgr.processEvent(ev('codex-child'), { source: 'codex', isSubagent: true, parentId: 'main-1' })!.agent;
    expect(task.heroClass).toBe('pawn');
    expect(wf.heroClass).toBe('archer');
    expect(codex.heroClass).toBe('pawn');
    expect([task.heroColor, wf.heroColor, codex.heroColor]).toEqual([parent.heroColor, parent.heroColor, parent.heroColor]);
  });

  test('a subagent discovered before its parent is recolored when the parent appears', () => {
    const mgr = new AgentStateManager();
    const child = mgr.processEvent(ev('agent-cccccccccccccccc'), { isSubagent: true, parentId: 'main-9' })!.agent;
    expect(child.heroClass).toBe('pawn');
    const r = mgr.processEvent(ev('main-9'))!;
    expect(r.agent.heroClass).toBe('warrior');
    expect(mgr.getAgent('agent-cccccccccccccccc')!.heroColor).toBe(r.agent.heroColor);
    expect(r.alsoChanged?.map((a) => a.id)).toEqual(['agent-cccccccccccccccc']);
  });
});
