import { describe, test, expect } from 'bun:test';
import { resolveContextWindow, DEFAULT_CLAUDE_CONTEXT_WINDOW, LARGE_CLAUDE_CONTEXT_WINDOW } from './context-window';

describe('resolveContextWindow', () => {
  test('defaults to 200k and infers 1M from usage, keeping the inference sticky', () => {
    expect(resolveContextWindow({ used: 10_000 })).toEqual({ window: DEFAULT_CLAUDE_CONTEXT_WINDOW, source: 'default' });
    expect(resolveContextWindow({ used: 250_000 })).toEqual({ window: LARGE_CLAUDE_CONTEXT_WINDOW, source: 'inferred' });
    const current = { used: 250_000, peak: 250_000, window: LARGE_CLAUDE_CONTEXT_WINDOW, windowSource: 'inferred' as const, compactions: 0, updatedAt: 0 };
    expect(resolveContextWindow({ used: 20_000, current })).toEqual({ window: LARGE_CLAUDE_CONTEXT_WINDOW, source: 'inferred' });
  });

  test('a configured [1m] model matches aliases and full ids of the same family only', () => {
    expect(resolveContextWindow({ used: 1, model: 'claude-opus-4-6', configuredModel: 'opus[1m]' })).toEqual({ window: LARGE_CLAUDE_CONTEXT_WINDOW, source: 'configured' });
    expect(resolveContextWindow({ used: 1, model: 'opus', configuredModel: 'claude-opus-4-6[1m]' })).toEqual({ window: LARGE_CLAUDE_CONTEXT_WINDOW, source: 'configured' });
    expect(resolveContextWindow({ used: 1, model: undefined, configuredModel: 'claude-opus-4-6[1m]' })).toEqual({ window: LARGE_CLAUDE_CONTEXT_WINDOW, source: 'configured' });
    expect(resolveContextWindow({ used: 1, model: 'claude-sonnet-4', configuredModel: 'claude-opus-4-6[1m]' })).toEqual({ window: DEFAULT_CLAUDE_CONTEXT_WINDOW, source: 'default' });
    expect(resolveContextWindow({ used: 1, model: 'claude-opus-4-6', configuredModel: 'claude-opus-4-6' })).toEqual({ window: DEFAULT_CLAUDE_CONTEXT_WINDOW, source: 'default' });
  });

  test('the env override wins over everything and ignores garbage', () => {
    expect(resolveContextWindow({ used: 1, model: 'claude-opus-5[1m]', envOverride: '500000' })).toEqual({ window: 500_000, source: 'configured' });
    expect(resolveContextWindow({ used: 1, envOverride: 'lots' })).toEqual({ window: DEFAULT_CLAUDE_CONTEXT_WINDOW, source: 'default' });
    expect(resolveContextWindow({ used: 1, envOverride: '-5' })).toEqual({ window: DEFAULT_CLAUDE_CONTEXT_WINDOW, source: 'default' });
  });
});
