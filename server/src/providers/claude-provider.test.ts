import { test, expect } from 'bun:test';
import { ClaudeProvider } from './claude-provider';

test('ClaudeProvider identifies as claude source', () => {
  const p = new ClaudeProvider();
  expect(p.source).toBe('claude');
});

test('ClaudeProvider exposes FileWatcher-discovered configDirs', async () => {
  const p = new ClaudeProvider({ claudeDirs: ['/tmp/fake-claude-dir-that-does-not-exist'] });
  // Starting with a non-existent dir must not throw; getConfigDirs returns the injected list.
  await p.start({
    onSessionStart: () => {},
    onSessionEvents: () => {},
  });
  expect(p.getConfigDirs()).toEqual(['/tmp/fake-claude-dir-that-does-not-exist']);
  p.stop();
});

test('ClaudeProvider reports subagent linkage and the configured model on session start', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const configDir = await mkdtemp(join(tmpdir(), 'claude-provider-'));
  const projectDir = join(configDir, 'projects', '-Users-dev-proj');
  const subagentsDir = join(projectDir, 'parent-1', 'subagents');
  await mkdir(subagentsDir, { recursive: true });
  await writeFile(join(configDir, 'settings.json'), JSON.stringify({ model: 'claude-fable-5-1[1m]' }));
  const line = (obj: unknown) => `${JSON.stringify(obj)}\n`;
  await writeFile(join(projectDir, 'parent-1.jsonl'), line({
    type: 'user', uuid: 'u1', parentUuid: null, timestamp: new Date().toISOString(), sessionId: 'parent-1', cwd: '/Users/dev/proj',
    message: { role: 'user', content: 'do the thing' },
  }));
  await writeFile(join(subagentsDir, 'agent-0123456789abcdef.jsonl'), line({
    type: 'user', uuid: 'u2', parentUuid: null, isSidechain: true, timestamp: new Date().toISOString(), sessionId: 'parent-1', cwd: '/Users/dev/proj',
    message: { role: 'user', content: 'explore the repo' },
  }));
  await writeFile(join(subagentsDir, 'agent-0123456789abcdef.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Explore repo', toolUseId: 'toolu_01Z' }));

  const starts: Array<Record<string, unknown>> = [];
  const p = new ClaudeProvider({ claudeDirs: [configDir], maxAgeMs: 60 * 60_000, pollIntervalMs: 60_000 });
  await p.start({ onSessionStart: (payload) => { starts.push(payload as unknown as Record<string, unknown>); }, onSessionEvents: () => {} });
  // onNewSession is fire-and-forget inside the watcher; let the async handlers settle.
  await new Promise((r) => setTimeout(r, 100));
  p.stop();

  const parent = starts.find((s) => s.sessionId === 'parent-1');
  const child = starts.find((s) => s.sessionId === 'agent-0123456789abcdef');
  expect(parent).toMatchObject({ isSubagent: false, configuredModel: 'claude-fable-5-1[1m]' });
  expect(parent?.parentId).toBeUndefined();
  expect(child).toMatchObject({
    isSubagent: true, parentId: 'parent-1', subagentType: 'Explore', spawnToolUseId: 'toolu_01Z', nameOverride: 'Explore repo',
  });
});
