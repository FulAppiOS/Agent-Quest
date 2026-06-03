import { useEffect, useRef } from 'react';
import type { AgentState } from '../types/agent';
import type { AppSettings } from './useSettings';
import { playChime, type ChimeKind } from '../notifications/sound';
import { computeAlerts, type AgentAlert, type AgentSnapshot } from '../notifications/transitions';

/** Payload handed to the in-app toast layer for each raised alert. */
export interface ToastPayload {
  agentId: string;
  name: string;
  category: ChimeKind;
  title: string;
  body: string;
}

function categoryEnabled(s: AppSettings, c: ChimeKind): boolean {
  switch (c) {
    case 'waiting': return s.notifyWaiting;
    case 'error': return s.notifyError;
    case 'completed': return s.notifyCompleted;
  }
}

function titleFor(a: AgentAlert): string {
  switch (a.category) {
    case 'waiting': return `${a.name} — your turn`;
    case 'error': return `${a.name} — error`;
    case 'completed': return `${a.name} — done`;
  }
}

function bodyFor(a: AgentAlert): string {
  switch (a.category) {
    case 'waiting': return 'Finished its turn and is waiting for you.';
    case 'error': return 'Hit an error.';
    case 'completed': return 'Session completed.';
  }
}

/**
 * How long an agent must stay 'waiting' before we treat it as a genuine
 * turn-end. Filters inferred-turn-end false positives: a mid-turn text-only
 * message briefly looks like waiting, but the next tool call flips it back to
 * active within a poll cycle, cancelling the pending alert.
 */
const WAITING_DEBOUNCE_MS = 5000;
/** An error this recent when the turn ends means the turn ended *with* an error. */
const ERROR_RECENT_MS = 60_000;

function showDesktopNotification(a: AgentAlert, onActivate: (id: string) => void): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(titleFor(a), {
      body: bodyFor(a),
      tag: `agentquest:${a.agentId}`, // collapse repeats for the same agent
    });
    n.onclick = () => {
      window.focus();
      onActivate(a.agentId);
      n.close();
    };
  } catch {
    /* some browsers throw if constructed without a service worker — ignore */
  }
}

/**
 * Watches agent state transitions (client-side, from the websocket stream) and
 * raises notifications + sounds for the main agents only, gated by user
 * settings. Also maintains an unread counter in the tab title while the window
 * is backgrounded, cleared when the user returns to the tab.
 *
 * Settings are read through a ref so changing a preference never itself fires an
 * alert — only genuine agent transitions do.
 */
export function useAgentNotifications(
  agents: AgentState[],
  settings: AppSettings,
  onActivate: (id: string) => void,
  onToast: (toast: ToastPayload) => void,
): void {
  const snapsRef = useRef<Map<string, AgentSnapshot>>(new Map());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  // Latest agents, readable inside a debounce timer without re-arming the effect.
  const agentsRef = useRef<AgentState[]>(agents);
  agentsRef.current = agents;
  // Pending debounced waiting alerts, keyed by agentId.
  const pendingRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Tab-title unread badge.
  const badgeRef = useRef(0);
  const baseTitleRef = useRef<string>(typeof document !== 'undefined' ? document.title : 'Agent Quest');

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (!document.hidden) {
        badgeRef.current = 0;
        document.title = baseTitleRef.current;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Fire all enabled channels for a confirmed alert + bump the tab badge.
  const fire = (alert: AgentAlert): void => {
    const s = settingsRef.current;
    if (s.doNotDisturb) return;
    if (!categoryEnabled(s, alert.category)) return;
    if (s.notificationsEnabled) showDesktopNotification(alert, onActivateRef.current);
    if (s.soundEnabled) playChime(alert.category, s.volume);
    if (s.inAppToasts) {
      onToastRef.current({
        agentId: alert.agentId,
        name: alert.name,
        category: alert.category,
        title: titleFor(alert),
        body: bodyFor(alert),
      });
    }
    if (typeof document !== 'undefined' && document.hidden) {
      badgeRef.current += 1;
      document.title = `(${badgeRef.current}) ${baseTitleRef.current}`;
    }
  };

  useEffect(() => {
    const { alerts, next } = computeAlerts(snapsRef.current, agents);
    snapsRef.current = next;

    // Cancel any pending waiting alert for an agent that has left 'waiting'
    // (it resumed working → the earlier turn-end was a false positive).
    for (const [id, timer] of pendingRef.current) {
      const a = agents.find((x) => x.id === id);
      if (a === undefined || a.status !== 'waiting') {
        clearTimeout(timer);
        pendingRef.current.delete(id);
      }
    }

    for (const alert of alerts) {
      if (alert.category === 'completed') {
        // Completed is terminal and authoritative — fire right away.
        fire(alert);
        continue;
      }
      // waiting → debounce: only a turn-end that *sticks* is a real "your move".
      if (pendingRef.current.has(alert.agentId)) continue;
      const timer = setTimeout(() => {
        pendingRef.current.delete(alert.agentId);
        const a = agentsRef.current.find((x) => x.id === alert.agentId);
        if (a === undefined || a.status !== 'waiting') return; // resumed → not done
        // Fold "ended with an error" into the turn-end: if the just-ended turn
        // had a recent error, surface it as an error alert instead of waiting.
        const endedWithError = a.lastErrorAt !== undefined && (Date.now() - a.lastErrorAt) < ERROR_RECENT_MS;
        fire({ agentId: alert.agentId, name: alert.name, category: endedWithError ? 'error' : 'waiting' });
      }, WAITING_DEBOUNCE_MS);
      pendingRef.current.set(alert.agentId, timer);
    }
  }, [agents]);

  // Clear pending timers on unmount.
  useEffect(() => {
    const pending = pendingRef.current;
    return () => { for (const timer of pending.values()) clearTimeout(timer); pending.clear(); };
  }, []);
}
