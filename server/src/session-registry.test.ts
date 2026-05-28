import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionRegistry } from './session-registry';

interface SessionStub {
  pid: number;
  sessionId: string;
  /** When set, the stub also writes `<root>/jobs/<jobId>/state.json` so the display-name oracle has something to read. */
  jobId?: string;
  /** When set, the corresponding `jobs/<jobId>/state.json` carries this `name`. */
  displayName?: string;
}

async function makeClaudeDir(withSessions: SessionStub[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-quest-test-'));
  const sessionsDir = join(root, 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  for (const stub of withSessions) {
    const { pid, sessionId, jobId, displayName } = stub;
    const file = join(sessionsDir, `${pid}.json`);
    const payload: Record<string, unknown> = {
      pid,
      sessionId,
      cwd: '/tmp',
      startedAt: Date.now(),
      kind: 'interactive',
      entrypoint: 'cli',
    };
    if (jobId !== undefined) payload['jobId'] = jobId;
    await writeFile(file, JSON.stringify(payload));

    if (jobId !== undefined && displayName !== undefined) {
      const jobDir = join(root, 'jobs', jobId);
      await mkdir(jobDir, { recursive: true });
      await writeFile(join(jobDir, 'state.json'), JSON.stringify({ name: displayName }));
    }
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

  test('exposes display name read from jobs/<jobId>/state.json', async () => {
    const dir = await makeClaudeDir([
      { pid: 11, sessionId: 'with-job', jobId: 'job-abc', displayName: '[#42, 7/13] feat: foo' },
      { pid: 12, sessionId: 'no-job' },
    ]);
    tempDirs.push(dir);

    const reg = new SessionRegistry({ configDirs: [dir], pidAlive: () => true });
    await reg.scan();

    expect(reg.getDisplayName('with-job')).toBe('[#42, 7/13] feat: foo');
    // No jobId → no display name (caller falls back to slug/cwd).
    expect(reg.getDisplayName('no-job')).toBeUndefined();
    // Unknown sessionId → undefined.
    expect(reg.getDisplayName('never-seen')).toBeUndefined();
  });

  test('forgets display name when state.json is removed between scans', async () => {
    const dir = await makeClaudeDir([
      { pid: 21, sessionId: 'sid-21', jobId: 'job-21', displayName: '[#7, 2/13] initial' },
    ]);
    tempDirs.push(dir);

    const reg = new SessionRegistry({ configDirs: [dir], pidAlive: () => true });
    await reg.scan();
    expect(reg.getDisplayName('sid-21')).toBe('[#7, 2/13] initial');

    await rm(join(dir, 'jobs', 'job-21', 'state.json'));
    await reg.scan();
    expect(reg.getDisplayName('sid-21')).toBeUndefined();
  });

  test('picks up display name changes between scans (live retitle)', async () => {
    const dir = await makeClaudeDir([
      { pid: 31, sessionId: 'sid-31', jobId: 'job-31', displayName: '[#9, 2/13] foo' },
    ]);
    tempDirs.push(dir);

    const reg = new SessionRegistry({ configDirs: [dir], pidAlive: () => true });
    await reg.scan();
    expect(reg.getDisplayName('sid-31')).toBe('[#9, 2/13] foo');

    await writeFile(
      join(dir, 'jobs', 'job-31', 'state.json'),
      JSON.stringify({ name: '[#9, 12/13] foo' }),
    );
    await reg.scan();
    expect(reg.getDisplayName('sid-31')).toBe('[#9, 12/13] foo');
  });

  test('tolerates corrupt state.json (returns undefined)', async () => {
    const dir = await makeClaudeDir([
      { pid: 41, sessionId: 'sid-41', jobId: 'job-41' },
    ]);
    tempDirs.push(dir);
    // Write a malformed state.json manually.
    const jobDir = join(dir, 'jobs', 'job-41');
    await mkdir(jobDir, { recursive: true });
    await writeFile(join(jobDir, 'state.json'), '{not json');

    const reg = new SessionRegistry({ configDirs: [dir], pidAlive: () => true });
    await reg.scan();

    // Liveness still works; only displayName degrades gracefully.
    expect(reg.isLive('sid-41')).toBe(true);
    expect(reg.getDisplayName('sid-41')).toBeUndefined();
  });

  test('drops display name for sessions whose pid is dead', async () => {
    const dir = await makeClaudeDir([
      { pid: 51, sessionId: 'sid-51', jobId: 'job-51', displayName: '[#1, 5/13] x' },
    ]);
    tempDirs.push(dir);

    const reg = new SessionRegistry({ configDirs: [dir], pidAlive: () => false });
    await reg.scan();

    // Dead pid: registry must not surface stale display names — otherwise the
    // dashboard would keep ghost sessions visible under their last-known title.
    expect(reg.isLive('sid-51')).toBe(false);
    expect(reg.getDisplayName('sid-51')).toBeUndefined();
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
