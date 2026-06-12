import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveSubagentLabel } from './subagent-label';

let root: string;
let projectDir: string;
let parentSessionId: string;
let parentPath: string;
let subagentPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'subagent-label-'));
  projectDir = join(root, 'projects', 'slug');
  parentSessionId = 'abc123';
  parentPath = join(projectDir, `${parentSessionId}.jsonl`);
  const subagentsDir = join(projectDir, parentSessionId, 'subagents');
  await mkdir(subagentsDir, { recursive: true });
  subagentPath = join(subagentsDir, 'agent-deadbeefcafed00d.jsonl');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function jsonline(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

describe('resolveSubagentLabel', () => {
  test('returns undefined for non-subagent paths', async () => {
    const plain = join(projectDir, 'session.jsonl');
    await writeFile(plain, '');
    const label = await resolveSubagentLabel(plain);
    expect(label).toBeUndefined();
  });

  test('returns parent description when prompt matches', async () => {
    await writeFile(subagentPath, jsonline({
      type: 'user',
      message: { role: 'user', content: 'Run a thorough audit of X' },
    }));
    await writeFile(parentPath, jsonline({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          name: 'Agent',
          input: {
            subagent_type: 'Explore',
            description: 'Audit X for regressions',
            prompt: 'Run a thorough audit of X',
          },
        }],
      },
    }));

    const label = await resolveSubagentLabel(subagentPath);
    expect(label).toBe('Audit X for regressions');
  });

  test('falls back to subagent_type when description missing', async () => {
    await writeFile(subagentPath, jsonline({
      type: 'user',
      message: { role: 'user', content: 'Do the thing.' },
    }));
    await writeFile(parentPath, jsonline({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          name: 'Agent',
          input: { subagent_type: 'general-purpose', prompt: 'Do the thing.' },
        }],
      },
    }));

    const label = await resolveSubagentLabel(subagentPath);
    expect(label).toBe('general-purpose');
  });

  test('falls back to first sentence when parent file is absent', async () => {
    await writeFile(subagentPath, jsonline({
      type: 'user',
      message: { role: 'user', content: 'You are a review bot. Check the PR thoroughly.' },
    }));

    const label = await resolveSubagentLabel(subagentPath);
    expect(label).toBe('You are a review bot');
  });

  test('truncates long descriptions', async () => {
    const longDesc = 'x'.repeat(200);
    await writeFile(subagentPath, jsonline({
      type: 'user',
      message: { role: 'user', content: 'prompt text' },
    }));
    await writeFile(parentPath, jsonline({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          name: 'Agent',
          input: { description: longDesc, prompt: 'prompt text' },
        }],
      },
    }));

    const label = await resolveSubagentLabel(subagentPath);
    expect(label).toBeDefined();
    expect(label!.length).toBeLessThanOrEqual(61); // 60 + ellipsis
    expect(label!.endsWith('…')).toBe(true);
  });

  test('resolves labels for workflow (ultra mode) agent paths', async () => {
    const workflowDir = join(projectDir, parentSessionId, 'subagents', 'workflows', 'wf_2ca7ddd8-324');
    await mkdir(workflowDir, { recursive: true });
    const workflowAgentPath = join(workflowDir, 'agent-a4f3fba033446cc4f.jsonl');
    await writeFile(workflowAgentPath, jsonline({
      type: 'user',
      message: { role: 'user', content: 'You are a senior engineer writing a plan. Read the spec first.' },
    }));

    const label = await resolveSubagentLabel(workflowAgentPath);
    expect(label).toBe('You are a senior engineer writing a plan');
  });

  test('workflow agents still match parent Agent invocations when present', async () => {
    const workflowDir = join(projectDir, parentSessionId, 'subagents', 'workflows', 'wf_deadbeef-123');
    await mkdir(workflowDir, { recursive: true });
    const workflowAgentPath = join(workflowDir, 'agent-bb11cc22dd33ee44f.jsonl');
    await writeFile(workflowAgentPath, jsonline({
      type: 'user',
      message: { role: 'user', content: 'Audit module Y' },
    }));
    await writeFile(parentPath, jsonline({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          name: 'Agent',
          input: { description: 'Audit Y', prompt: 'Audit module Y' },
        }],
      },
    }));

    const label = await resolveSubagentLabel(workflowAgentPath);
    expect(label).toBe('Audit Y');
  });

  test('prefers description from the sibling meta.json over everything', async () => {
    await writeFile(subagentPath, jsonline({
      type: 'user',
      message: { role: 'user', content: 'Run a thorough audit of X' },
    }));
    await writeFile(subagentPath.replace('.jsonl', '.meta.json'), JSON.stringify({
      agentType: 'Explore',
      description: 'Verify Claude Code lifecycle hooks',
      toolUseId: 'toolu_123',
    }));
    await writeFile(parentPath, jsonline({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          name: 'Agent',
          input: { description: 'Audit X for regressions', prompt: 'Run a thorough audit of X' },
        }],
      },
    }));

    const label = await resolveSubagentLabel(subagentPath);
    expect(label).toBe('Verify Claude Code lifecycle hooks');
  });

  test('combines meta agentType with the prompt first sentence for workflow agents', async () => {
    const workflowDir = join(projectDir, parentSessionId, 'subagents', 'workflows', 'wf_0f3513d0-3cc');
    await mkdir(workflowDir, { recursive: true });
    const workflowAgentPath = join(workflowDir, 'agent-a2282a1d2c6a1932f.jsonl');
    await writeFile(workflowAgentPath, jsonline({
      type: 'user',
      message: { role: 'user', content: 'Esplora il backend Laravel. Rispondi con snippet.' },
    }));
    await writeFile(workflowAgentPath.replace('.jsonl', '.meta.json'), JSON.stringify({ agentType: 'Explore' }));

    const label = await resolveSubagentLabel(workflowAgentPath);
    expect(label).toBe('Explore: Esplora il backend Laravel');
  });

  test('drops the generic workflow-subagent agentType from meta.json', async () => {
    const workflowDir = join(projectDir, parentSessionId, 'subagents', 'workflows', 'wf_2ca7ddd8-324');
    await mkdir(workflowDir, { recursive: true });
    const workflowAgentPath = join(workflowDir, 'agent-afa8678eb14a03831.jsonl');
    await writeFile(workflowAgentPath, jsonline({
      type: 'user',
      message: { role: 'user', content: 'Write the plan. Then stop.' },
    }));
    await writeFile(workflowAgentPath.replace('.jsonl', '.meta.json'), JSON.stringify({ agentType: 'workflow-subagent' }));

    const label = await resolveSubagentLabel(workflowAgentPath);
    expect(label).toBe('Write the plan');
  });

  test('ignores parent Agent invocations with non-matching prompt', async () => {
    await writeFile(subagentPath, jsonline({
      type: 'user',
      message: { role: 'user', content: 'my actual prompt' },
    }));
    await writeFile(parentPath, jsonline({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          name: 'Agent',
          input: {
            description: 'different task',
            prompt: 'unrelated prompt body',
          },
        }],
      },
    }));

    const label = await resolveSubagentLabel(subagentPath);
    expect(label).toBe('my actual prompt');
  });
});
