import { useCallback, useEffect, useRef, useState } from 'react';

export type PartyFoldState = 'full' | 'icons';

export interface PartyPrefs {
  foldState: PartyFoldState;
}

export const DEFAULT_PARTY_PREFS: PartyPrefs = {
  foldState: 'full',
};

const STORAGE_KEY = 'agentquest:partyBar:prefs';
const WRITE_DEBOUNCE_MS = 200;

const FOLD_STATES: PartyFoldState[] = ['full', 'icons'];

function isPartyFoldState(v: unknown): v is PartyFoldState {
  return typeof v === 'string' && (FOLD_STATES as string[]).includes(v);
}

export function parsePartyPrefs(raw: string | null): PartyPrefs {
  if (raw === null) return DEFAULT_PARTY_PREFS;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return DEFAULT_PARTY_PREFS; }
  if (obj === null || typeof obj !== 'object') return DEFAULT_PARTY_PREFS;
  const o = obj as Record<string, unknown>;
  return {
    foldState: isPartyFoldState(o.foldState) ? o.foldState : DEFAULT_PARTY_PREFS.foldState,
  };
}

export function mergePartyPrefs(base: PartyPrefs, patch: Partial<PartyPrefs>): PartyPrefs {
  return { ...base, ...patch };
}

export function usePartyPrefs(): [PartyPrefs, (patch: Partial<PartyPrefs>) => void] {
  const [prefs, setPrefs] = useState<PartyPrefs>(() => {
    if (typeof window === 'undefined') return DEFAULT_PARTY_PREFS;
    return parsePartyPrefs(window.localStorage.getItem(STORAGE_KEY));
  });

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValue = useRef<PartyPrefs | null>(null);

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

  const update = useCallback((patch: Partial<PartyPrefs>) => {
    setPrefs((prev) => mergePartyPrefs(prev, patch));
  }, []);

  return [prefs, update];
}
