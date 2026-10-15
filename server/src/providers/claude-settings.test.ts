import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readConfiguredModel } from './claude-settings';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'claude-settings-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('readConfiguredModel', () => {
  test('returns the model configured in settings.json', async () => {
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ model: 'claude-fable-5-1[1m]', effortLevel: 'high' }));
    expect(await readConfiguredModel(dir)).toBe('claude-fable-5-1[1m]');
  });

  test('returns undefined when settings.json is missing, malformed or has no model', async () => {
    expect(await readConfiguredModel(dir)).toBeUndefined();
    await writeFile(join(dir, 'settings.json'), '{ not json');
    expect(await readConfiguredModel(dir)).toBeUndefined();
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ effortLevel: 'high' }));
    expect(await readConfiguredModel(dir)).toBeUndefined();
  });
});
