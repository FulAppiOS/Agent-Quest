import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionFilter } from '../components/activityFeedUtils';

export type FoldState = 'full' | 'compact' | 'closed';
export type ViewMode = 'all' | 'byAgent';

export interface FeedPrefs {
  foldState: FoldState;
  viewMode: ViewMode;
  activeFilters: ActionFilter[];
  agentFilter: string | null;
}

export const DEFAULT_PREFS: FeedPrefs = {
  foldState: 'full',
  viewMode: 'all',
  activeFilters: [],
  agentFilter: null,
};

const STORAGE_KEY = 'agentquest:activityFeed:prefs';
const WRITE_DEBOUNCE_MS = 200;

const FOLD_STATES: FoldState[] = ['full', 'compact', 'closed'];
const VIEW_MODES: ViewMode[] = ['all', 'byAgent'];
const FILTERS: ActionFilter[] = ['errors', 'edits', 'bash', 'reads'];

function isFoldState(v: unknown): v is FoldState {
  return typeof v === 'string' && (FOLD_STATES as string[]).includes(v);
}
function isViewMode(v: unknown): v is ViewMode {
  return typeof v === 'string' && (VIEW_MODES as string[]).includes(v);
}
function isFilter(v: unknown): v is ActionFilter {
  return typeof v === 'string' && (FILTERS as string[]).includes(v);
}

export function parsePrefs(raw: string | null): FeedPrefs {
  if (raw === null) return DEFAULT_PREFS;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return DEFAULT_PREFS; }
  if (obj === null || typeof obj !== 'object') return DEFAULT_PREFS;
  const o = obj as Record<string, unknown>;
  return {
    foldState: isFoldState(o.foldState) ? o.foldState : DEFAULT_PREFS.foldState,
    viewMode: isViewMode(o.viewMode) ? o.viewMode : DEFAULT_PREFS.viewMode,
    activeFilters: Array.isArray(o.activeFilters)
      ? o.activeFilters.filter(isFilter)
      : DEFAULT_PREFS.activeFilters,
    agentFilter: typeof o.agentFilter === 'string' ? o.agentFilter : null,
  };
}

export function mergePrefs(base: FeedPrefs, patch: Partial<FeedPrefs>): FeedPrefs {
  return { ...base, ...patch };
}

export function useFeedPrefs(): [FeedPrefs, (patch: Partial<FeedPrefs>) => void] {
  const [prefs, setPrefs] = useState<FeedPrefs>(() => {
    if (typeof window === 'undefined') return DEFAULT_PREFS;
    return parsePrefs(window.localStorage.getItem(STORAGE_KEY));
  });

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      } catch { /* quota or private mode — silently ignore */ }
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    };
  }, [prefs]);

  const update = useCallback((patch: Partial<FeedPrefs>) => {
    setPrefs((prev) => mergePrefs(prev, patch));
  }, []);

  return [prefs, update];
}
