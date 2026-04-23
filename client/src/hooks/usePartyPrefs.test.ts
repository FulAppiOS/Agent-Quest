import { describe, it, expect } from 'bun:test';
import { DEFAULT_PARTY_PREFS, parsePartyPrefs, mergePartyPrefs } from './usePartyPrefs';

describe('parsePartyPrefs', () => {
  it('returns DEFAULT_PARTY_PREFS for null input', () => {
    expect(parsePartyPrefs(null)).toEqual(DEFAULT_PARTY_PREFS);
  });

  it('returns DEFAULT_PARTY_PREFS for malformed JSON', () => {
    expect(parsePartyPrefs('not json {')).toEqual(DEFAULT_PARTY_PREFS);
  });

  it('returns DEFAULT_PARTY_PREFS for non-object payload', () => {
    expect(parsePartyPrefs('"a string"')).toEqual(DEFAULT_PARTY_PREFS);
    expect(parsePartyPrefs('null')).toEqual(DEFAULT_PARTY_PREFS);
  });

  it('parses a valid payload', () => {
    const raw = JSON.stringify({ foldState: 'icons' });
    expect(parsePartyPrefs(raw)).toEqual({ foldState: 'icons' });
  });

  it('falls back to default for invalid fold state', () => {
    const raw = JSON.stringify({ foldState: 'gigantic' });
    expect(parsePartyPrefs(raw)).toEqual(DEFAULT_PARTY_PREFS);
  });
});

describe('mergePartyPrefs', () => {
  it('overlays partial onto base', () => {
    const merged = mergePartyPrefs(DEFAULT_PARTY_PREFS, { foldState: 'icons' });
    expect(merged.foldState).toBe('icons');
  });
});
