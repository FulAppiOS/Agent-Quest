import { describe, it, expect } from 'bun:test';
import type { AgentState } from '../types/agent';
import { buildSessionMarkdown, buildFleetMarkdown, buildSessionJson, buildFleetJson, exportFileName } from './sessionExport';

function agent(id: string, over: Partial<AgentState> = {}): AgentState {
  return {
    id, name: id, heroClass: 'warrior', heroColor: 'blue', status: 'waiting', currentActivity: 'idle',
    tokenUsage: { input: 100, output: 50, cacheRead: 1000, cacheWrite: 20 }, cost: 0, sessionStart: 1_000_000, toolCalls: [],
    errors: [], filesModified: [], lastEvent: 1_600_000, cwd: '/Users/dev/proj', configDir: '/Users/dev/.claude', source: 'claude',
    model: 'claude-opus-4-6', ...over,
  };
}
const ctx = { used: 150_000, peak: 180_000, window: 200_000, windowSource: 'configured' as const, compactions: 1, updatedAt: 0 };
const GENERATED = Date.UTC(2026, 9, 15, 12, 0, 0);

describe('buildSessionMarkdown', () => {
  it('writes every section an AI reviewer needs, with human-readable figures', () => {
    const main = agent('main', {
      context: ctx,
      currentTask: 'Fix the flaky test',
      lastMessage: 'Done. Tests pass.',
      toolCalls: [
        { id: '1', name: 'Read', timestamp: 0, input: { file_path: '/a.ts' } },
        { id: '2', name: 'Edit', timestamp: 0, input: { file_path: '/a.ts' } },
        { id: '3', name: 'Bash', timestamp: 0, input: { command: 'bun test' } },
      ],
      filesModified: ['/a.ts'],
      skills: [{ name: 'superpowers:tdd', plugin: 'superpowers', loads: 1, loadTokens: 2000, attributedMessages: 4, attributedOutputTokens: 900, firstUsedAt: 0, lastUsedAt: 0 }],
      plugins: [{ name: 'chrome-devtools-mcp', kind: 'plugin', calls: 2, resultTokens: 300, lastUsedAt: 0 }],
    });
    const child = agent('agent-x', { isSubagent: true, parentId: 'main', subagentType: 'Explore', status: 'completed', context: { ...ctx, peak: 90_000 }, returnedTokens: 1_200, heroClass: 'pawn' });
    const md = buildSessionMarkdown(main, [child], { count: 48, tokens: 400_000 }, { generatedAt: GENERATED });

    expect(md).toContain('# Agent Quest session export: main');
    expect(md).toContain('2026-10-15T12:00:00.000Z');
    for (const h of ['## Session', '## Context window', '## Token usage', '## Activity', '## Skills', '## Plugins & MCP', '## Delegation', '## Last message', '## Review questions']) {
      expect(md).toContain(h);
    }
    expect(md).toContain('150.0k / 200.0k (75%)');
    expect(md).toContain('Compactions: 1');
    expect(md).toContain('| superpowers:tdd | superpowers | 1 | ~2.0k | 4 |');
    expect(md).toContain('| chrome-devtools-mcp | plugin | 2 | ~300 |');
    expect(md).toContain('| agent-x | Explore | completed | ~90.0k | ~1.2k |');
    expect(md).toContain('Kept out of this context: ~88.8k');
    expect(md).toContain('48 skills installed (~400.0k tokens if always loaded)');
    expect(md).toContain('Fix the flaky test');
    expect(md).toContain('Done. Tests pass.');
    expect(md).toContain('| reading | 1 |');
    expect(md).toContain('Duration: 10m 0s');
  });

  it('omits prompt and message text when asked, and empty sections stay short', () => {
    const md = buildSessionMarkdown(agent('bare', { currentTask: 'secret', lastMessage: 'also secret' }), [], undefined, { generatedAt: GENERATED, includeText: false });
    expect(md).not.toContain('secret');
    expect(md).toContain('No skills loaded.');
    expect(md).toContain('No plugin or MCP calls.');
    expect(md).not.toContain('## Delegation');
    expect(md).toContain('Context window: unknown');
  });

  it('truncates very long prompts', () => {
    const md = buildSessionMarkdown(agent('long', { currentTask: 'x'.repeat(5000) }), [], undefined, { generatedAt: GENERATED });
    expect(md).toContain('x'.repeat(100));
    expect(md).not.toContain('x'.repeat(2001));
    expect(md).toContain('[truncated]');
  });
});

describe('buildFleetMarkdown', () => {
  it('starts with an overview table of main agents and nests each session', () => {
    const main = agent('main', { context: ctx });
    const child = agent('agent-y', { isSubagent: true, parentId: 'main', heroClass: 'pawn' });
    const other = agent('other', { source: 'codex', model: 'gpt-6-astra', status: 'completed' });
    const md = buildFleetMarkdown([main, child, other], { claude: { count: 2, tokens: 1000 } }, { generatedAt: GENERATED });
    expect(md).toContain('# Agent Quest fleet export');
    expect(md).toContain('| main | claude | claude-opus-4-6 | waiting | 75% | 1 |');
    expect(md).toContain('| other | codex | gpt-6-astra | completed | – | 0 |');
    expect(md.indexOf('## Sessions')).toBeGreaterThan(0);
    expect(md).toContain('### main');
    expect(md).toContain('### other');
    expect(md).not.toContain('### agent-y');
  });
});

describe('buildSessionJson / exportFileName', () => {
  it('exports a trimmed shape without raw tool inputs', () => {
    const main = agent('main', { toolCalls: [{ id: '1', name: 'Bash', timestamp: 0, input: { command: 'rm -rf x' } }], context: ctx });
    const json = buildSessionJson(main, []);
    expect(JSON.stringify(json)).not.toContain('rm -rf');
    expect(json).toMatchObject({ id: 'main', toolCounts: { Bash: 1 }, context: { used: 150_000 }, subagents: [] });
  });

  it('builds a safe file name', () => {
    expect(exportFileName('My Session/Name', 'md', GENERATED)).toBe('agent-quest-my-session-name-2026-10-15.md');
    expect(exportFileName('fleet', 'json', GENERATED)).toBe('agent-quest-fleet-2026-10-15.json');
  });
});

describe('buildFleetJson', () => {
  it('nests subagents under their main agent and stamps the generation time', () => {
    const main = agent('main');
    const child = agent('agent-z', { isSubagent: true, parentId: 'main', heroClass: 'pawn' });
    const json = buildFleetJson([main, child], GENERATED) as { generatedAt: string; agents: Array<{ id: string; subagents: Array<{ id: string }> }> };
    expect(json.generatedAt).toBe('2026-10-15T12:00:00.000Z');
    expect(json.agents.map((a) => a.id)).toEqual(['main']);
    expect(json.agents[0]!.subagents.map((s) => s.id)).toEqual(['agent-z']);
  });
});
