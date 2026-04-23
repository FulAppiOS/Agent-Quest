import { describe, it, expect } from 'bun:test';
import { configDirLabel } from './configDirLabel';

describe('configDirLabel', () => {
  it('returns "default" for empty string', () => {
    expect(configDirLabel('')).toBe('default');
  });

  it('returns "claude" for ~/.claude', () => {
    expect(configDirLabel('/Users/foo/.claude')).toBe('claude');
  });

  it('returns "codex" for ~/.codex', () => {
    expect(configDirLabel('/Users/foo/.codex')).toBe('codex');
  });

  it('strips .claude- prefix for multi-installs', () => {
    expect(configDirLabel('/Users/foo/.claude-work')).toBe('work');
    expect(configDirLabel('/Users/foo/.claude-personale')).toBe('personale');
  });

  it('strips leading dot for other dotted dirs', () => {
    expect(configDirLabel('/Users/foo/.something')).toBe('something');
  });

  it('returns base unchanged for non-dotted dirs', () => {
    expect(configDirLabel('/Users/foo/custom')).toBe('custom');
  });
});
