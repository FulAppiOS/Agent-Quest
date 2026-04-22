import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionRegistry } from './session-registry';

async function makeClaudeDir(withSessions: Array<{ pid: number; sessionId: string }>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-quest-test-'));
  const sessionsDir = join(root, 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  for (const { pid, sessionId } of withSessions) {
    const file = join(sessionsDir, `${pid}.json`);
    await writeFile(file, JSON.stringify({ pid, sessionId, cwd: '/tmp', startedAt: Date.now(), kind: 'interactive', entrypoint: 'cli' }));
  }
  return root;
}

describe('SessionRegistry', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop()!;
      await rm(d, { recursive: true, force: true }).catch(() => {});
    }
  });

  test('hasAnyLive returns false before first scan', () => {
    const reg = new SessionRegistry({ configDirs: [], pidAlive: () => true });
    expect(reg.hasAnyLive()).toBe(false);
    expect(reg.isLive('anything')).toBe(false);
  });

  test('collects sessionIds from live pid files', async () => {
    const dir = await makeClaudeDir([
      { pid: 1001, sessionId: 'live-a' },
      { pid: 1002, sessionId: 'live-b' },
    ]);
    tempDirs.push(dir);

    const reg = new SessionRegistry({
      configDirs: [dir],
      pidAlive: () => true,
    });
    await reg.scan();

    expect(reg.hasAnyLive()).toBe(true);
    expect(reg.isLive('live-a')).toBe(true);
    expect(reg.isLive('live-b')).toBe(true);
    expect(reg.isLive('missing')).toBe(false);
  });

  test('skips pid files for dead processes', async () => {
    const dir = await makeClaudeDir([
      { pid: 5000, sessionId: 'alive-sid' },
      { pid: 5001, sessionId: 'dead-sid' },
    ]);
    tempDirs.push(dir);

    const reg = new SessionRegistry({
      configDirs: [dir],
      pidAlive: (pid) => pid === 5000,
    });
    await reg.scan();

    expect(reg.isLive('alive-sid')).toBe(true);
    expect(reg.isLive('dead-sid')).toBe(false);
  });

  test('aggregates across multiple config dirs', async () => {
    const a = await makeClaudeDir([{ pid: 10, sessionId: 'sid-from-a' }]);
    const b = await makeClaudeDir([{ pid: 20, sessionId: 'sid-from-b' }]);
    tempDirs.push(a, b);

    const reg = new SessionRegistry({
      configDirs: [a, b],
      pidAlive: () => true,
    });
    await reg.scan();

    expect(reg.isLive('sid-from-a')).toBe(true);
    expect(reg.isLive('sid-from-b')).toBe(true);
    expect(reg.snapshot().sort()).toEqual(['sid-from-a', 'sid-from-b']);
  });

  test('forgets sessions whose pid file disappears between scans', async () => {
    const dir = await makeClaudeDir([{ pid: 42, sessionId: 'vanishing' }]);
    tempDirs.push(dir);

    const reg = new SessionRegistry({ configDirs: [dir], pidAlive: () => true });
    await reg.scan();
    expect(reg.isLive('vanishing')).toBe(true);

    await rm(join(dir, 'sessions', '42.json'));
    await reg.scan();
    expect(reg.isLive('vanishing')).toBe(false);
  });

  test('ignores non-numeric filenames in sessions dir', async () => {
    const dir = await makeClaudeDir([{ pid: 99, sessionId: 'real' }]);
    tempDirs.push(dir);
    await writeFile(join(dir, 'sessions', 'README.md'), 'not a pid file');
    await writeFile(join(dir, 'sessions', 'abc.json'), JSON.stringify({ sessionId: 'spurious' }));

    const reg = new SessionRegistry({ configDirs: [dir], pidAlive: () => true });
    await reg.scan();

    expect(reg.isLive('real')).toBe(true);
    expect(reg.isLive('spurious')).toBe(false);
  });

  test('tolerates missing sessions/ subdir', async () => {
    const reg = new SessionRegistry({
      configDirs: ['/nonexistent/path-' + Date.now()],
      pidAlive: () => true,
    });
    await reg.scan();
    expect(reg.hasAnyLive()).toBe(false);
  });

  test('setConfigDirs refreshes the watched roots', async () => {
    const a = await makeClaudeDir([{ pid: 1, sessionId: 'in-a' }]);
    const b = await makeClaudeDir([{ pid: 2, sessionId: 'in-b' }]);
    tempDirs.push(a, b);

    const reg = new SessionRegistry({ configDirs: [a], pidAlive: () => true });
    await reg.scan();
    expect(reg.isLive('in-a')).toBe(true);
    expect(reg.isLive('in-b')).toBe(false);

    reg.setConfigDirs([b]);
    await reg.scan();
    expect(reg.isLive('in-a')).toBe(false);
    expect(reg.isLive('in-b')).toBe(true);
  });
});
