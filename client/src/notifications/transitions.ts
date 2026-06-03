import type { AgentState } from '../types/agent';
import { isSubagentAgent } from '../types/agent';
import type { ChimeKind } from './sound';

/**
 * Per-agent snapshot we diff against to detect notification-worthy transitions.
 * Deliberately minimal — just the fields whose change matters.
 */
export interface AgentSnapshot {
  status: AgentState['status'];
  lastErrorAt: number | undefined;
}

export interface AgentAlert {
  agentId: string;
  name: string;
  /** Reuses the chime categories; also drives which settings toggle gates it. */
  category: ChimeKind;
}

export function snapshotOf(a: AgentState): AgentSnapshot {
  return { status: a.status, lastErrorAt: a.lastErrorAt };
}

/**
 * Diff the previous per-agent snapshots against the current agent list and
 * return the genuine end-of-task transitions, plus the fresh snapshot map.
 *
 * Only real task-completion signals are emitted (main agents only — subagents
 * never alert, so the Task-tool fan-out doesn't spam):
 *   - waiting   — status entered 'waiting' ("turn finished, your move")
 *   - completed — status entered 'completed' (session ended)
 *
 * Mid-turn errors are deliberately NOT a transition here: a failed tool call is
 * usually recovered from within the same turn, so it isn't task completion. The
 * caller folds "ended with an error" into the waiting transition instead (by
 * inspecting `lastErrorAt` when the turn actually ends), and debounces waiting
 * to drop inferred-turn-end false positives.
 *
 * Agents seen for the first time only seed the baseline and never alert — so an
 * initial snapshot or a websocket reconnect doesn't fire a burst for sessions
 * already waiting/completed. Building `next` only from current agents also drops
 * removed agents naturally.
 */
export function computeAlerts(
  prev: Map<string, AgentSnapshot>,
  agents: AgentState[],
): { alerts: AgentAlert[]; next: Map<string, AgentSnapshot> } {
  const next = new Map<string, AgentSnapshot>();
  const alerts: AgentAlert[] = [];

  for (const a of agents) {
    const cur = snapshotOf(a);
    next.set(a.id, cur);

    if (isSubagentAgent(a)) continue;

    const before = prev.get(a.id);
    if (before === undefined) continue; // first sight → baseline only

    const enteredWaiting = before.status !== 'waiting' && cur.status === 'waiting';
    const enteredCompleted = before.status !== 'completed' && cur.status === 'completed';

    let category: ChimeKind | null = null;
    if (enteredWaiting) category = 'waiting';
    else if (enteredCompleted) category = 'completed';

    if (category !== null) {
      alerts.push({ agentId: a.id, name: a.name, category });
    }
  }

  return { alerts, next };
}
