import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * App-wide user settings, persisted to localStorage. Versioned so we can grow
 * the shape over time without breaking existing installs — `parseSettings`
 * always falls back to defaults for any field it can't read, and bumps to the
 * current `SCHEMA_VERSION`. Kept deliberately tiny (a handful of booleans + one
 * number) so the stored blob stays well under a kilobyte.
 *
 * Notifications are the first consumer (see step 2): the client watches agent
 * state transitions and, gated by these flags, raises a desktop notification
 * and/or plays a sound. `notify*` are per-category toggles for the four
 * user-facing states; `waiting` is the important one ("turn finished, your
 * move"), the others are opt-in.
 */
export interface AppSettings {
  /** Master switch for desktop (Web Notification API) notifications. */
  notificationsEnabled: boolean;
  /** Play a sound alongside notifications. */
  soundEnabled: boolean;
  /** Notification sound volume, 0..1. */
  volume: number;
  /** Temporarily suppress every notification + sound without losing prefs. */
  doNotDisturb: boolean;
  /** Notify when a (main) agent finishes its turn and awaits the user. */
  notifyWaiting: boolean;
  /** Notify when a (main) agent hits an error. */
  notifyError: boolean;
  /** Notify when a (main) agent session completes. */
  notifyCompleted: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  notificationsEnabled: false, // opt-in: also needs browser permission (step 2)
  soundEnabled: true,
  volume: 0.5,
  doNotDisturb: false,
  notifyWaiting: true,
  notifyError: true,
  notifyCompleted: false,
};

const STORAGE_KEY = 'agentquest:settings';
const SCHEMA_VERSION = 1;
const WRITE_DEBOUNCE_MS = 200;

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function clampVolume(v: unknown): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return DEFAULT_SETTINGS.volume;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function parseSettings(raw: string | null): AppSettings {
  if (raw === null) return DEFAULT_SETTINGS;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return DEFAULT_SETTINGS; }
  if (obj === null || typeof obj !== 'object') return DEFAULT_SETTINGS;
  const o = obj as Record<string, unknown>;
  return {
    notificationsEnabled: isBool(o.notificationsEnabled) ? o.notificationsEnabled : DEFAULT_SETTINGS.notificationsEnabled,
    soundEnabled: isBool(o.soundEnabled) ? o.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    volume: clampVolume(o.volume),
    doNotDisturb: isBool(o.doNotDisturb) ? o.doNotDisturb : DEFAULT_SETTINGS.doNotDisturb,
    notifyWaiting: isBool(o.notifyWaiting) ? o.notifyWaiting : DEFAULT_SETTINGS.notifyWaiting,
    notifyError: isBool(o.notifyError) ? o.notifyError : DEFAULT_SETTINGS.notifyError,
    notifyCompleted: isBool(o.notifyCompleted) ? o.notifyCompleted : DEFAULT_SETTINGS.notifyCompleted,
  };
}

export function mergeSettings(base: AppSettings, patch: Partial<AppSettings>): AppSettings {
  const next = { ...base, ...patch };
  next.volume = clampVolume(next.volume);
  return next;
}

function serialize(s: AppSettings): string {
  return JSON.stringify({ v: SCHEMA_VERSION, ...s });
}

export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const [settings, setSettings] = useState<AppSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS;
    return parseSettings(window.localStorage.getItem(STORAGE_KEY));
  });

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValue = useRef<AppSettings | null>(null);

  useEffect(() => {
    if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    pendingValue.current = settings;
    writeTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, serialize(settings));
      } catch { /* quota or private mode — silently ignore */ }
      pendingValue.current = null;
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    };
  }, [settings]);

  useEffect(() => {
    return () => {
      if (pendingValue.current !== null) {
        try {
          window.localStorage.setItem(STORAGE_KEY, serialize(pendingValue.current));
        } catch { /* quota or private mode — silently ignore */ }
        pendingValue.current = null;
      }
    };
  }, []);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => mergeSettings(prev, patch));
  }, []);

  return [settings, update];
}
