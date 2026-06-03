import { describe, test, expect } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HOOK_PATH,
  settingsHasOurHook,
  addOurHook,
  removeOurHook,
  buildStopGroup,
  installHook,
  uninstallHook,
  hookStatus,
} from './claude-hooks';

const URL = `http://localhost:4444${HOOK_PATH}`;

describe('addOurHook', () => {
  test('adds a Stop hook to an empty settings object', () => {
    const [next, changed] = addOurHook({}, URL);
    expect(changed).toBe(true);
    expect(settingsHasOurHook(next)).toBe(true);
  });

  test('is idempotent — no duplicate on second add', () => {
    const [once] = addOurHook({}, URL);
    const [twice, changed] = addOurHook(once, URL);
    expect(changed).toBe(false);
    const stop = (twice.hooks as { Stop: unknown[] }).Stop;
    expect(stop).toHaveLength(1);
  });

  test('preserves the user\'s existing hooks (no clobber)', () => {
    const userSettings = {
      model: 'opus',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'my-own-script' }] }],
      },
    };
    const [next, changed] = addOurHook(userSettings, URL);
    expect(changed).toBe(true);
    const hooks = next.hooks as { PreToolUse: unknown[]; Stop: unknown[] };
    expect(hooks.PreToolUse).toHaveLength(1);     // untouched
    expect(hooks.Stop).toHaveLength(2);           // user's + ours
    expect(next.model).toBe('opus');              // unrelated keys preserved
  });
});

describe('removeOurHook', () => {
  test('removes only our hook, keeping the user\'s', () => {
    const base = {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'my-own-script' }] }] },
    };
    const [withOurs] = addOurHook(base, URL);
    const [next, changed] = removeOurHook(withOurs);
    expect(changed).toBe(true);
    const stop = (next.hooks as { Stop: unknown[] }).Stop;
    expect(stop).toHaveLength(1);
    expect(settingsHasOurHook(next)).toBe(false);
  });

  test('drops the empty Stop array and hooks object when nothing else remains', () => {
    const [withOurs] = addOurHook({}, URL);
    const [next, changed] = removeOurHook(withOurs);
    expect(changed).toBe(true);
    expect(next.hooks).toBeUndefined();
  });

  test('no-op when our hook is absent', () => {
    const [next, changed] = removeOurHook({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] } });
    expect(changed).toBe(false);
  });

  test('no-op on settings with no hooks at all', () => {
    const [, changed] = removeOurHook({ model: 'sonnet' });
    expect(changed).toBe(false);
  });
});

describe('detection across transports', () => {
  test('recognizes our hook whether registered as http url or curl command', () => {
    const httpSettings = { hooks: { Stop: [buildStopGroup(URL)] } };
    const cmdSettings = {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: `curl -X POST http://localhost:4444${HOOK_PATH}` }] }] },
    };
    expect(settingsHasOurHook(httpSettings)).toBe(true);
    expect(settingsHasOurHook(cmdSettings)).toBe(true);
  });
});

describe('install/uninstall round-trip on disk', () => {
  async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'aq-hooks-'));
    try {
      await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test('creates settings.json when none exists, then removes cleanly', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'settings.json');

      const ins = await installHook([dir], URL);
      expect(ins[0]!.changed).toBe(true);
      expect(ins[0]!.error).toBeUndefined();
      expect((await hookStatus([dir]))[0]!.installed).toBe(true);

      const written = JSON.parse(await readFile(path, 'utf8'));
      expect(settingsHasOurHook(written)).toBe(true);

      // Idempotent second install.
      expect((await installHook([dir], URL))[0]!.changed).toBe(false);

      const uni = await uninstallHook([dir]);
      expect(uni[0]!.changed).toBe(true);
      expect((await hookStatus([dir]))[0]!.installed).toBe(false);
    });
  });

  test('preserves unrelated keys and existing user hooks on disk', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'settings.json');
      await writeFile(path, JSON.stringify({
        model: 'opus',
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] },
      }), 'utf8');

      await installHook([dir], URL);
      const after = JSON.parse(await readFile(path, 'utf8'));
      expect(after.model).toBe('opus');
      expect(after.hooks.PreToolUse).toHaveLength(1);
      expect(settingsHasOurHook(after)).toBe(true);

      await uninstallHook([dir]);
      const restored = JSON.parse(await readFile(path, 'utf8'));
      expect(restored.model).toBe('opus');
      expect(restored.hooks.PreToolUse).toHaveLength(1);
      expect(settingsHasOurHook(restored)).toBe(false);
    });
  });

  test('aborts (reports error) on a malformed settings.json without clobbering it', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'settings.json');
      await writeFile(path, '{ this is not valid json', 'utf8');

      const res = await installHook([dir], URL);
      expect(res[0]!.changed).toBe(false);
      expect(res[0]!.error).toBeDefined();
      // Original content is left untouched.
      expect(await readFile(path, 'utf8')).toBe('{ this is not valid json');
    });
  });
});
