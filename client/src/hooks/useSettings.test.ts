import { describe, it, expect } from 'bun:test';
import { DEFAULT_SETTINGS, parseSettings, mergeSettings } from './useSettings';

describe('parseSettings', () => {
  it('returns DEFAULT_SETTINGS for null input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns DEFAULT_SETTINGS for malformed JSON', () => {
    expect(parseSettings('not json {')).toEqual(DEFAULT_SETTINGS);
  });

  it('returns DEFAULT_SETTINGS for non-object payload', () => {
    expect(parseSettings('"a string"')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
  });

  it('parses a valid payload', () => {
    const raw = JSON.stringify({ ...DEFAULT_SETTINGS, notificationsEnabled: true, volume: 0.8 });
    const parsed = parseSettings(raw);
    expect(parsed.notificationsEnabled).toBe(true);
    expect(parsed.volume).toBe(0.8);
  });

  it('falls back to defaults for individual missing/invalid fields', () => {
    const raw = JSON.stringify({ notificationsEnabled: true });
    const parsed = parseSettings(raw);
    expect(parsed.notificationsEnabled).toBe(true);
    expect(parsed.soundEnabled).toBe(DEFAULT_SETTINGS.soundEnabled);
    expect(parsed.notifyWaiting).toBe(DEFAULT_SETTINGS.notifyWaiting);
  });

  it('clamps volume into [0, 1]', () => {
    expect(parseSettings(JSON.stringify({ volume: 5 })).volume).toBe(1);
    expect(parseSettings(JSON.stringify({ volume: -3 })).volume).toBe(0);
    expect(parseSettings(JSON.stringify({ volume: 'loud' })).volume).toBe(DEFAULT_SETTINGS.volume);
  });

  it('ignores an unknown version tag and reads known fields', () => {
    const raw = JSON.stringify({ v: 99, soundEnabled: false });
    expect(parseSettings(raw).soundEnabled).toBe(false);
  });
});

describe('mergeSettings', () => {
  it('overlays partial onto base', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { doNotDisturb: true });
    expect(merged.doNotDisturb).toBe(true);
  });

  it('clamps volume on merge', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { volume: 2 }).volume).toBe(1);
    expect(mergeSettings(DEFAULT_SETTINGS, { volume: -1 }).volume).toBe(0);
  });
});
