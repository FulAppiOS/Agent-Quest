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
