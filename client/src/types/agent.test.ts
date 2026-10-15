import { describe, it, expect } from 'bun:test';
import {
  contextLevel, contextPct, estimateTokens, formatTokens, skillShortName,
  type ContextUsage,
} from './agent';

function ctx(over: Partial<ContextUsage> = {}): ContextUsage {
  return {
    used: 0, peak: 0, window: null, windowSource: 'default', compactions: 0, updatedAt: 0, ...over,
  };
}

describe('contextLevel', () => {
  it('is ok below 60%, warn below 80%, hot below 90%, critical from 90%', () => {
    expect(contextLevel(0)).toBe('ok');
    expect(contextLevel(59.9)).toBe('ok');
    expect(contextLevel(60)).toBe('warn');
    expect(contextLevel(79.9)).toBe('warn');
    expect(contextLevel(80)).toBe('hot');
    expect(contextLevel(89.9)).toBe('hot');
    expect(contextLevel(90)).toBe('critical');
    expect(contextLevel(140)).toBe('critical');
  });
});

describe('contextPct', () => {
  it('returns null when the window is unknown or the usage is missing', () => {
    expect(contextPct(undefined)).toBeNull();
    expect(contextPct(ctx({ used: 1000, window: null }))).toBeNull();
    expect(contextPct(ctx({ used: 1000, window: 0 }))).toBeNull();
  });
  it('returns the percentage of the window in use, never negative', () => {
    expect(contextPct(ctx({ used: 50_000, window: 200_000 }))).toBe(25);
    expect(contextPct(ctx({ used: 150_000, window: 1_000_000 }))).toBe(15);
    expect(contextPct(ctx({ used: 250_000, window: 200_000 }))).toBe(125);
  });
});

describe('skillShortName', () => {
  it('drops the plugin prefix and keeps standalone names', () => {
    expect(skillShortName('superpowers:brainstorming')).toBe('brainstorming');
    expect(skillShortName('pdf')).toBe('pdf');
    expect(skillShortName('a:b:c')).toBe('c');
  });
});

describe('estimateTokens', () => {
  it('estimates one token per four characters, rounding up, never negative', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(17_826)).toBe(4_457);
    expect(estimateTokens(-10)).toBe(0);
  });
});

describe('formatTokens', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1_234)).toBe('1.2k');
    expect(formatTokens(144_059)).toBe('144.1k');
    expect(formatTokens(1_200_000)).toBe('1.2M');
  });
});
