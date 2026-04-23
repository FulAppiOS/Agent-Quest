import { describe, it, expect, beforeEach } from 'bun:test';

// Bun's test runtime has no DOM, so shim localStorage before the module under
// test loads. An in-memory Storage-shaped object is enough — the util only
// calls getItem/setItem/removeItem.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true });
}

import {
  OLD_DISMISS_KEY,
  NEW_DISMISS_KEY,
  isDismissed,
  setDismissed,
  resetDismissal,
} from './noInstallBannerStorage';

function clearKeys() {
  try { localStorage.removeItem(OLD_DISMISS_KEY); } catch {}
  try { localStorage.removeItem(NEW_DISMISS_KEY); } catch {}
}

describe('noInstallBannerStorage', () => {
  beforeEach(() => {
    clearKeys();
  });

  it('returns false when nothing stored', () => {
    expect(isDismissed()).toBe(false);
  });

  it('returns true after setDismissed()', () => {
    setDismissed();
    expect(isDismissed()).toBe(true);
  });

  it('migrates old Claude-specific key to new key on first read', () => {
    localStorage.setItem(OLD_DISMISS_KEY, '1');
    expect(isDismissed()).toBe(true);
    expect(localStorage.getItem(NEW_DISMISS_KEY)).toBe('1');
    expect(localStorage.getItem(OLD_DISMISS_KEY)).toBe(null);
  });

  it('prefers new key over old key when both exist', () => {
    localStorage.setItem(NEW_DISMISS_KEY, '1');
    localStorage.setItem(OLD_DISMISS_KEY, '1');
    expect(isDismissed()).toBe(true);
    // old key cleaned up regardless
    expect(localStorage.getItem(OLD_DISMISS_KEY)).toBe(null);
  });

  it('resetDismissal clears both keys', () => {
    localStorage.setItem(NEW_DISMISS_KEY, '1');
    localStorage.setItem(OLD_DISMISS_KEY, '1');
    resetDismissal();
    expect(localStorage.getItem(NEW_DISMISS_KEY)).toBe(null);
    expect(localStorage.getItem(OLD_DISMISS_KEY)).toBe(null);
  });
});
