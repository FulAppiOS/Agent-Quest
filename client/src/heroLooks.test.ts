import { describe, it, expect } from 'bun:test';
import type { AgentState } from './types/agent';
import {
  applyHeroLook,
  heroLookKey,
  parseHeroLooks,
  serializeHeroLooks,
} from './heroLooks';

function agent(over: Partial<AgentState> = {}): AgentState {
  return {
    id: 'sess-1',
    name: 'Agent-Quest',
    heroClass: 'warrior',
    heroColor: 'blue',
    status: 'active',
    currentActivity: 'idle',
    tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    sessionStart: 1000,
    toolCalls: [],
    errors: [],
    filesModified: [],
    lastEvent: 1000,
    cwd: '/proj/Agent-Quest',
    configDir: '/Users/x/.claude',
    source: 'claude',
    ...over,
  };
}

describe('heroLookKey', () => {
  it('is stable across session ids', () => {
    const a = agent({ id: 'aaa' });
    const b = agent({ id: 'bbb' });
    expect(heroLookKey(a)).toBe(heroLookKey(b));
  });

  it('differs by source, cwd, or name', () => {
    const base = heroLookKey(agent());
    expect(heroLookKey(agent({ source: 'codex' }))).not.toBe(base);
    expect(heroLookKey(agent({ cwd: '/other' }))).not.toBe(base);
    expect(heroLookKey(agent({ name: 'other' }))).not.toBe(base);
  });
});

describe('applyHeroLook', () => {
  it('returns the same object when no look is stored', () => {
    const a = agent();
    expect(applyHeroLook(a, undefined)).toBe(a);
  });

  it('returns the same object when the look already matches', () => {
    const a = agent({ heroClass: 'archer', heroColor: 'red' });
    expect(applyHeroLook(a, { heroClass: 'archer', heroColor: 'red' })).toBe(a);
  });

  it('overrides class and color', () => {
    const a = agent();
    const next = applyHeroLook(a, { heroClass: 'pawn', heroColor: 'purple' });
    expect(next.heroClass).toBe('pawn');
    expect(next.heroColor).toBe('purple');
    expect(next.id).toBe(a.id);
    expect(a.heroClass).toBe('warrior');
  });
});

describe('parseHeroLooks / serializeHeroLooks', () => {
  it('round-trips a valid map', () => {
    const looks = { 'cursor\t/p\tN': { heroClass: 'archer' as const, heroColor: 'yellow' as const } };
    expect(parseHeroLooks(serializeHeroLooks(looks))).toEqual(looks);
  });

  it('returns {} for null, garbage, or non-object', () => {
    expect(parseHeroLooks(null)).toEqual({});
    expect(parseHeroLooks('not json')).toEqual({});
    expect(parseHeroLooks('"x"')).toEqual({});
    expect(parseHeroLooks('[]')).toEqual({});
  });

  it('drops invalid keys and looks', () => {
    const raw = JSON.stringify({
      v: 1,
      looks: {
        ok: { heroClass: 'warrior', heroColor: 'blue' },
        '': { heroClass: 'warrior', heroColor: 'blue' },
        badClass: { heroClass: 'mage', heroColor: 'blue' },
        badColor: { heroClass: 'warrior', heroColor: 'pink' },
        notObj: 3,
      },
    });
    expect(parseHeroLooks(raw)).toEqual({
      ok: { heroClass: 'warrior', heroColor: 'blue' },
    });
  });
});
