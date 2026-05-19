import { describe, it, expect } from 'bun:test';
import { DEFAULT_TOPBAR_PREFS, parseTopBarPrefs, mergeTopBarPrefs } from './useTopBarPrefs';

describe('parseTopBarPrefs', () => {
  it('returns DEFAULT_TOPBAR_PREFS for null input', () => {
    expect(parseTopBarPrefs(null)).toEqual(DEFAULT_TOPBAR_PREFS);
  });

  it('returns DEFAULT_TOPBAR_PREFS for malformed JSON', () => {
    expect(parseTopBarPrefs('not json {')).toEqual(DEFAULT_TOPBAR_PREFS);
  });

  it('returns DEFAULT_TOPBAR_PREFS for non-object payload', () => {
    expect(parseTopBarPrefs('"a string"')).toEqual(DEFAULT_TOPBAR_PREFS);
    expect(parseTopBarPrefs('null')).toEqual(DEFAULT_TOPBAR_PREFS);
  });

  it('parses a valid payload', () => {
    const raw = JSON.stringify({ showCompletedAgents: true });
    expect(parseTopBarPrefs(raw)).toEqual({ showCompletedAgents: true });
  });

  it('falls back to default when showCompletedAgents has wrong type', () => {
    const raw = JSON.stringify({ showCompletedAgents: 'yes' });
    expect(parseTopBarPrefs(raw)).toEqual(DEFAULT_TOPBAR_PREFS);
  });

  it('default has showCompletedAgents false (current behavior preserved)', () => {
    expect(DEFAULT_TOPBAR_PREFS.showCompletedAgents).toBe(false);
  });
});

describe('mergeTopBarPrefs', () => {
  it('overlays partial onto base', () => {
    const merged = mergeTopBarPrefs(DEFAULT_TOPBAR_PREFS, { showCompletedAgents: true });
    expect(merged.showCompletedAgents).toBe(true);
  });
});
