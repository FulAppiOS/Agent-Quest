import { useCallback, useEffect, useRef, useState } from 'react';

export interface TopBarPrefs {
  showCompletedAgents: boolean;
}

export const DEFAULT_TOPBAR_PREFS: TopBarPrefs = {
  showCompletedAgents: false,
};

const STORAGE_KEY = 'agentquest:topbar:prefs';
const WRITE_DEBOUNCE_MS = 200;

export function parseTopBarPrefs(raw: string | null): TopBarPrefs {
  if (raw === null) return DEFAULT_TOPBAR_PREFS;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return DEFAULT_TOPBAR_PREFS; }
  if (obj === null || typeof obj !== 'object') return DEFAULT_TOPBAR_PREFS;
  const o = obj as Record<string, unknown>;
  return {
    showCompletedAgents:
      typeof o.showCompletedAgents === 'boolean'
        ? o.showCompletedAgents
        : DEFAULT_TOPBAR_PREFS.showCompletedAgents,
  };
}

export function mergeTopBarPrefs(base: TopBarPrefs, patch: Partial<TopBarPrefs>): TopBarPrefs {
  return { ...base, ...patch };
}

export function useTopBarPrefs(): [TopBarPrefs, (patch: Partial<TopBarPrefs>) => void] {
  const [prefs, setPrefs] = useState<TopBarPrefs>(() => {
    if (typeof window === 'undefined') return DEFAULT_TOPBAR_PREFS;
    return parseTopBarPrefs(window.localStorage.getItem(STORAGE_KEY));
  });

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValue = useRef<TopBarPrefs | null>(null);

  // Two effects on purpose: the dep-cleanup of the first only cancels the
  // pending timer so the debounce can keep coalescing rapid changes, while
  // the unmount-cleanup of the second drains the pending value to disk.
  // Merging them into one would flush on every prefs change and defeat the
  // debounce.

  useEffect(() => {
    if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    pendingValue.current = prefs;
    writeTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      } catch { /* quota or private mode — silently ignore */ }
      pendingValue.current = null;
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    };
  }, [prefs]);

  useEffect(() => {
    return () => {
      if (pendingValue.current !== null) {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingValue.current));
        } catch { /* quota or private mode — silently ignore */ }
        pendingValue.current = null;
      }
    };
  }, []);

  const update = useCallback((patch: Partial<TopBarPrefs>) => {
    setPrefs((prev) => mergeTopBarPrefs(prev, patch));
  }, []);

  return [prefs, update];
}
