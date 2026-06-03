import { useEffect, useRef } from 'react';
import type { AgentState } from '../types/agent';
import type { AppSettings } from './useSettings';
import { playChime, type ChimeKind } from '../notifications/sound';
import { computeAlerts, type AgentAlert, type AgentSnapshot } from '../notifications/transitions';

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
): void {
  const snapsRef = useRef<Map<string, AgentSnapshot>>(new Map());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

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

  useEffect(() => {
    const { alerts, next } = computeAlerts(snapsRef.current, agents);
    snapsRef.current = next;
    if (alerts.length === 0) return;

    const s = settingsRef.current;
    if (s.doNotDisturb) return;

    let raised = 0;
    for (const alert of alerts) {
      if (!categoryEnabled(s, alert.category)) continue;
      if (s.notificationsEnabled) showDesktopNotification(alert, onActivateRef.current);
      if (s.soundEnabled) playChime(alert.category, s.volume);
      raised += 1;
    }

    if (raised > 0 && typeof document !== 'undefined' && document.hidden) {
      badgeRef.current += raised;
      document.title = `(${badgeRef.current}) ${baseTitleRef.current}`;
    }
  }, [agents]);
}
