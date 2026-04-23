import { describe, it, expect } from 'bun:test';
import { DEFAULT_PREFS, parsePrefs, mergePrefs } from './useFeedPrefs';

describe('parsePrefs', () => {
  it('returns DEFAULT_PREFS for null input', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it('returns DEFAULT_PREFS for malformed JSON', () => {
    expect(parsePrefs('not json {')).toEqual(DEFAULT_PREFS);
  });

  it('returns DEFAULT_PREFS for non-object payload', () => {
    expect(parsePrefs('"a string"')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('null')).toEqual(DEFAULT_PREFS);
  });

  it('parses a valid full payload', () => {
    const raw = JSON.stringify({
      foldState: 'compact',
      viewMode: 'byAgent',
      activeHighlights: ['errors', 'edits'],
      agentFilter: 'a1',
    });
    expect(parsePrefs(raw)).toEqual({
      foldState: 'compact',
      viewMode: 'byAgent',
      activeHighlights: ['errors', 'edits'],
      agentFilter: 'a1',
    });
  });

  it('falls back to defaults for invalid enum values', () => {
    const raw = JSON.stringify({
      foldState: 'gigantic',
      viewMode: 'byPlanet',
      activeHighlights: ['nonsense', 'edits'],
      agentFilter: null,
    });
    const result = parsePrefs(raw);
    expect(result.foldState).toBe('full');
    expect(result.viewMode).toBe('all');
    expect(result.activeHighlights).toEqual(['edits']);
  });

  it('reads legacy activeFilters key as activeHighlights', () => {
    const raw = JSON.stringify({
      foldState: 'full',
      viewMode: 'all',
      activeFilters: ['errors', 'bash'],
      agentFilter: null,
    });
    const result = parsePrefs(raw);
    expect(result.activeHighlights).toEqual(['errors', 'bash']);
  });

  it('rejects non-string agentFilter', () => {
    expect(parsePrefs(JSON.stringify({ agentFilter: 42 })).agentFilter).toBeNull();
  });

  it('rejects empty-string agentFilter', () => {
    expect(parsePrefs(JSON.stringify({ agentFilter: '' })).agentFilter).toBeNull();
  });
});

describe('mergePrefs', () => {
  it('overlays partial onto base', () => {
    const merged = mergePrefs(DEFAULT_PREFS, { foldState: 'closed' });
    expect(merged.foldState).toBe('closed');
    expect(merged.viewMode).toBe(DEFAULT_PREFS.viewMode);
  });

  it('replaces arrays wholesale', () => {
    const base = { ...DEFAULT_PREFS, activeHighlights: ['edits' as const] };
    const merged = mergePrefs(base, { activeHighlights: ['bash'] });
    expect(merged.activeHighlights).toEqual(['bash']);
  });
});
