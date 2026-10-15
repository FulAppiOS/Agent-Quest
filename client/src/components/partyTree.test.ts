import { describe, it, expect } from 'bun:test';
import type { AgentState } from '../types/agent';
import { buildPartyTree } from './partyTree';

function agent(id: string, over: Partial<AgentState> = {}): AgentState {
  return {
    id, name: id, heroClass: 'warrior', heroColor: 'blue', status: 'active', currentActivity: 'idle',
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, sessionStart: 0, toolCalls: [],
    errors: [], filesModified: [], lastEvent: 0, cwd: '/p', configDir: '~/.claude', source: 'claude', ...over,
  };
}

describe('buildPartyTree', () => {
  it('nests subagents under their parent, keeping the status order of the roots', () => {
    const live = [
      agent('idle-main', { status: 'idle' }),
      agent('child-1', { isSubagent: true, parentId: 'main' }),
      agent('main'),
      agent('child-2', { isSubagent: true, parentId: 'main', status: 'waiting' }),
    ];
    const tree = buildPartyTree(live);
    expect(tree.map((n) => n.agent.id)).toEqual(['main', 'idle-main']);
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['child-1', 'child-2']);
    expect(tree[1]!.children).toEqual([]);
  });

  it('keeps a subagent whose parent is not in the list as a root', () => {
    const tree = buildPartyTree([agent('orphan', { isSubagent: true, parentId: 'gone' })]);
    expect(tree.map((n) => n.agent.id)).toEqual(['orphan']);
  });

  it('treats a subagent without parentId (older servers) as a root', () => {
    const tree = buildPartyTree([agent('agent-abc', { isSubagent: true })]);
    expect(tree.map((n) => n.agent.id)).toEqual(['agent-abc']);
  });
});

describe('buildPartyTree nesting depth', () => {
  it('attaches a sub-subagent to the live root of its chain instead of dropping it', () => {
    const live = [
      agent('root'),
      agent('child', { isSubagent: true, parentId: 'root' }),
      agent('grandchild', { isSubagent: true, parentId: 'child' }),
    ];
    const tree = buildPartyTree(live);
    expect(tree.map((n) => n.agent.id)).toEqual(['root']);
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['child', 'grandchild']);
  });

  it('keeps a sub-subagent as a root when its chain never reaches a live root', () => {
    const live = [
      agent('child', { isSubagent: true, parentId: 'gone' }),
      agent('grandchild', { isSubagent: true, parentId: 'child' }),
    ];
    const tree = buildPartyTree(live);
    expect(tree.map((n) => n.agent.id)).toEqual(['child']);
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['grandchild']);
  });
});
