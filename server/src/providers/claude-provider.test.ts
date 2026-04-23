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
