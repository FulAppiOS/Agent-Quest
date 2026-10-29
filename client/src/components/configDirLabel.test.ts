import { describe, it, expect } from 'bun:test';
import { configDirLabel } from './configDirLabel';

describe('configDirLabel', () => {
  it('distinguishes Xcode storage from ordinary Codex and Claude profiles', () => {
    expect(configDirLabel('/Users/dev/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/projects')).toBe('Xcode · Claude');
    expect(configDirLabel('/Users/dev/Library/Developer/Xcode/CodingAssistant/codex/sessions')).toBe('Xcode · Codex');
    expect(configDirLabel('/Users/dev/custom/codex/sessions')).toBe('sessions');
  });
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
