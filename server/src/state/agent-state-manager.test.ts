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

  test('assigns hero classes and colors cyclically', () => {
    const mgr = new AgentStateManager();
    const r1 = mgr.processEvent(makeEvent({ sessionId: 'sess-1' }));
    const r2 = mgr.processEvent(makeEvent({ sessionId: 'sess-2', slug: 'another-slug' }));
    const r3 = mgr.processEvent(makeEvent({ sessionId: 'sess-3', slug: 'third-slug' }));

    expect(r1!.agent.heroClass).toBe('warrior');
    expect(r2!.agent.heroClass).toBe('archer');
    expect(r3!.agent.heroClass).toBe('pawn');

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
});
