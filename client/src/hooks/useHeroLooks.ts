import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseHeroLooks,
  serializeHeroLooks,
  type HeroLook,
  type HeroLookMap,
} from '../heroLooks';

const STORAGE_KEY = 'agentquest:heroLooks';
const WRITE_DEBOUNCE_MS = 200;

export function useHeroLooks(): [HeroLookMap, (key: string, look: HeroLook | null) => void] {
  const [looks, setLooks] = useState<HeroLookMap>(() => {
    if (typeof window === 'undefined') return {};
    return parseHeroLooks(window.localStorage.getItem(STORAGE_KEY));
  });

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValue = useRef<HeroLookMap | null>(null);

  useEffect(() => {
    if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    pendingValue.current = looks;
    writeTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, serializeHeroLooks(looks));
      } catch { /* quota or private mode — silently ignore */ }
      pendingValue.current = null;
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    };
  }, [looks]);

  useEffect(() => {
    return () => {
      if (pendingValue.current !== null) {
        try {
          window.localStorage.setItem(STORAGE_KEY, serializeHeroLooks(pendingValue.current));
        } catch { /* quota or private mode — silently ignore */ }
        pendingValue.current = null;
      }
    };
  }, []);

  const upsert = useCallback((key: string, look: HeroLook | null) => {
    setLooks((prev) => {
      if (look === null) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      const existing = prev[key];
      if (existing !== undefined
        && existing.heroClass === look.heroClass
        && existing.heroColor === look.heroColor) {
        return prev;
      }
      return { ...prev, [key]: look };
    });
  }, []);

  return [looks, upsert];
}
