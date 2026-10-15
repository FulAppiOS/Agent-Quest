import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanSkillInventory, claudeSkillRoots, codexSkillRoots } from './skill-inventory';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'skill-inventory-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function skill(root: string, name: string, bytes: number): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, 'SKILL.md'), 'x'.repeat(bytes));
}

describe('scanSkillInventory', () => {
  test('counts SKILL.md files under the given roots and estimates their tokens', async () => {
    const root = join(dir, 'skills');
    await skill(root, 'alpha', 40);
    await skill(root, 'beta', 80);
    await mkdir(join(root, 'not-a-skill'), { recursive: true }); // no SKILL.md → ignored
    expect(await scanSkillInventory([root, join(dir, 'missing')])).toEqual({ count: 2, tokens: 30 });
  });
});

describe('claudeSkillRoots', () => {
  test('includes the user skills dir and the latest cached version of each plugin', async () => {
    await skill(join(dir, 'skills'), 'mine', 10);
    await skill(join(dir, 'plugins', 'cache', 'market', 'plug', '0.9.0', 'skills'), 'old', 10);
    await skill(join(dir, 'plugins', 'cache', 'market', 'plug', '1.10.0', 'skills'), 'new', 10);
    await skill(join(dir, 'plugins', 'cache', 'market', 'plug', '1.2.0', 'skills'), 'mid', 10);
    const roots = await claudeSkillRoots(dir);
    expect(roots).toEqual([
      join(dir, 'skills'),
      join(dir, 'plugins', 'cache', 'market', 'plug', '1.10.0', 'skills'),
    ]);
  });

  test('returns only the user skills dir when there is no plugin cache', async () => {
    expect(await claudeSkillRoots(dir)).toEqual([join(dir, 'skills')]);
  });
});

describe('codexSkillRoots', () => {
  test('points at ~/.codex/skills', () => {
    expect(codexSkillRoots('/home/u/.codex')).toEqual(['/home/u/.codex/skills']);
  });
});
