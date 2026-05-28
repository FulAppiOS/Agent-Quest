import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentState, WsEvent, ActivityLogEntry } from '../types/agent';
import { normalizeAgentState } from '../types/agent';
import { eventBridge } from '../game/EventBridge';
import { WS_URL } from '../config';

const RECONNECT_DELAY_MS = 3000;
const MAX_LOG_ENTRIES = 200;

/**
 * Decision the WebSocket onclose handler should take. Extracted into a pure
 * function so the StrictMode mount→unmount→mount race can be regression-tested
 * without standing up a React render environment.
 *
 *   - `stale` — the firing socket is not the one currently held by the hook.
 *     A previous mount's WebSocket fired its onclose late after a new mount
 *     already replaced wsRef.current. Skip reconnect; the new ws owns it.
 *   - `cleanup` — the effect cleanup intentionally closed the socket. Skip
 *     reconnect; the hook is unmounting.
 *   - `reconnect` — genuine server- or network-side close. Schedule reconnect.
 */
export type CloseAction = 'stale' | 'cleanup' | 'reconnect';

export function classifyCloseEvent(
  currentWs: WebSocket | null,
  firingWs: WebSocket,
  shouldReconnect: boolean,
): CloseAction {
  if (currentWs !== firingWs) return 'stale';
  if (!shouldReconnect) return 'cleanup';
  return 'reconnect';
}

export interface AgentStateHook {
  agents: AgentState[];
  activityLog: ActivityLogEntry[];
  connected: boolean;
  /** Config dirs reported by the server in the last snapshot. `null` means
   * we haven't received a snapshot yet (still connecting); an empty array
   * means the server found neither ~/.claude* nor ~/.codex install on disk. */
  configDirs: string[] | null;
}

export function useAgentState(): AgentStateHook {
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [configDirs, setConfigDirs] = useState<string[] | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Distinguishes "the effect cleanup intentionally closed the socket" from
  // "the server or network dropped us". Without this, `onclose` would always
  // arm a reconnect timer — and on a StrictMode mount→unmount→mount cycle
  // (or React Fast Refresh) that timer would fire on an orphan hook instance
  // and call setState / emit bridge events for a hook that no longer exists,
  // racing against the new mount. That race is the original symptom behind
  // the "connect → error → disconnect" reconnect loop in issue #7.
  const shouldReconnect = useRef(true);

  const handleEvent = useCallback((event: WsEvent) => {
    switch (event.type) {
      case 'snapshot':
        setAgents(event.agents.map(normalizeAgentState));
        setConfigDirs(event.configDirs);
        break;

      case 'agent:new':
        setAgents((prev) => [...prev, normalizeAgentState(event.agent)]);
        break;

      case 'agent:update': {
        const normalized = normalizeAgentState(event.agent);
        setAgents((prev) =>
          prev.map((a) => (a.id === normalized.id ? normalized : a)),
        );
        break;
      }

      case 'agent:complete':
        setAgents((prev) =>
          prev.map((a) =>
            a.id === event.id ? { ...a, status: 'completed' as const, currentActivity: 'idle' as const } : a,
          ),
        );
        break;

      case 'activity:log':
        setActivityLog((prev) => {
          const entry: ActivityLogEntry = {
            agentId: event.agentId,
            action: event.action,
            detail: event.detail,
            timestamp: event.timestamp,
          };
          const next = [entry, ...prev];
          return next.length > MAX_LOG_ENTRIES ? next.slice(0, MAX_LOG_ENTRIES) : next;
        });
        break;
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      eventBridge.emit('ws:connected');
      console.log('[WS] connected to', WS_URL);
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as WsEvent;
        handleEvent(event);
      } catch (err) {
        console.error('[WS] failed to parse message:', err);
      }
    };

    ws.onclose = (event) => {
      // code/reason help diagnose why the server (or browser) dropped the
      // connection — 1009 = message too big, 1006 = abnormal closure, 1000 =
      // normal. wasClean=false signals an unclean teardown (issue #7 hunt).
      const action = classifyCloseEvent(wsRef.current, ws, shouldReconnect.current);
      const closeMeta = `code=${event.code} reason="${event.reason}" wasClean=${event.wasClean}`;
      if (action === 'stale') {
        console.log(`[WS] closed (stale ws) ${closeMeta} — skipping reconnect`);
        return;
      }
      if (action === 'cleanup') {
        console.log(`[WS] closed by cleanup ${closeMeta}`);
        return;
      }
      setConnected(false);
      eventBridge.emit('ws:disconnected');
      console.log(`[WS] disconnected ${closeMeta} — reconnecting in`, RECONNECT_DELAY_MS, 'ms');
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = (err) => {
      // Browsers do not expose error details for security; only the event type
      // is meaningful. Pair this with the onclose code/reason for diagnosis.
      // Do NOT call ws.close() here — the WebSocket spec guarantees onclose
      // fires automatically after onerror, so an explicit close just adds a
      // teardown race against the freshly-arriving server frame (issue #11).
      console.error(`[WS] error type=${err.type}`);
    };
  }, [handleEvent]);

  useEffect(() => {
    shouldReconnect.current = true;
    connect();

    return () => {
      // Mark cleanup so the upcoming `onclose` does NOT schedule a reconnect.
      shouldReconnect.current = false;
      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return { agents, activityLog, connected, configDirs };
}
