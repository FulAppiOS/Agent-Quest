import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileWatcher } from './file-watcher';

let claudeDir: string;
let projectDir: string;

beforeEach(async () => {
  claudeDir = await mkdtemp(join(tmpdir(), 'file-watcher-'));
  projectDir = join(claudeDir, 'projects', 'slug');
  await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await rm(claudeDir, { recursive: true, force: true });
});

function jsonline(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

interface ScanResult {
  newSessions: string[];
  updates: string[];
}

function makeWatcher(): { watcher: FileWatcher; result: ScanResult } {
  const result: ScanResult = { newSessions: [], updates: [] };
  const watcher = new FileWatcher({
    claudeDirs: [claudeDir],
    onNewSession: (sessionId) => {
      result.newSessions.push(sessionId);
    },
    onSessionUpdate: (sessionId) => {
      result.updates.push(sessionId);
    },
  });
  return { watcher, result };
}

describe('FileWatcher workflow (ultra mode) discovery', () => {
  test('discovers agent JSONLs nested under subagents/workflows/wf_*/', async () => {
    const sessionId = 'e20383a7-8361-4ea9-bfee-305ea79263bc';
    await writeFile(join(projectDir, `${sessionId}.jsonl`), jsonline({ type: 'user' }));

    const subagentsDir = join(projectDir, sessionId, 'subagents');
    await mkdir(subagentsDir, { recursive: true });
    await writeFile(join(subagentsDir, 'agent-1111111111111111.jsonl'), jsonline({ type: 'user' }));

    const workflowDir = join(subagentsDir, 'workflows', 'wf_2ca7ddd8-324');
    await mkdir(workflowDir, { recursive: true });
    await writeFile(join(workflowDir, 'agent-a4f3fba033446cc4f.jsonl'), jsonline({ type: 'user' }));
    await writeFile(join(workflowDir, 'agent-a4f3fba033446cc4f.meta.json'), '{"agentType":"workflow-subagent"}');
    await writeFile(join(workflowDir, 'journal.jsonl'), jsonline({ type: 'started' }));

    const { watcher, result } = makeWatcher();
    await watcher.scan();

    expect(result.newSessions).toContain(sessionId);
    expect(result.newSessions).toContain('agent-1111111111111111');
    expect(result.newSessions).toContain('agent-a4f3fba033446cc4f');
    // Orchestration journal and meta files must not become agents
    expect(result.newSessions).not.toContain('journal');
    expect(result.newSessions).not.toContain('agent-a4f3fba033446cc4f.meta');
  });

  test('emits updates when a workflow agent JSONL grows', async () => {
    const sessionId = 'f207718a-066f-4609-82cb-eccf36a9e5a2';
    const workflowDir = join(projectDir, sessionId, 'subagents', 'workflows', 'wf_9ca5aadf-8ab');
    await mkdir(workflowDir, { recursive: true });
    const agentPath = join(workflowDir, 'agent-afa8678eb14a03831.jsonl');
    await writeFile(agentPath, jsonline({ type: 'user' }));

    const { watcher, result } = makeWatcher();
    await watcher.scan();
    expect(result.newSessions).toContain('agent-afa8678eb14a03831');

    await appendFile(agentPath, jsonline({ type: 'assistant' }));
    await watcher.scan();
    expect(result.updates).toContain('agent-afa8678eb14a03831');
  });
});
