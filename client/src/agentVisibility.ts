import type { AgentState } from './types/agent';

/**
 * Waiting / idle agents older than this leave the live roster (Party Bar,
 * village, Top Bar counts, source badges). Matches CursorProvider's
 * `endedQuietMs` so a finished turn that we still ingest doesn't linger
 * as a waiting hero.
 */
export const PARK_AFTER_MS = 15 * 60 * 1000;

type StatusAndLastEvent = Pick<AgentState, 'status' | 'lastEvent'>;

/** Waiting or idle with no events for longer than {@link PARK_AFTER_MS}. */
export function isParkedAgent(agent: StatusAndLastEvent, now = Date.now()): boolean {
  if (agent.status !== 'waiting' && agent.status !== 'idle') return false;
  return now - agent.lastEvent > PARK_AFTER_MS;
}

/** Active, plus waiting/idle that are still within the park window. */
export function isLiveRosterAgent(agent: StatusAndLastEvent, now = Date.now()): boolean {
  if (agent.status === 'active') return true;
  if (agent.status === 'waiting' || agent.status === 'idle') {
    return !isParkedAgent(agent, now);
  }
  return false;
}

/** Heroes that should walk the village (live roster minus completed/error). */
export function isVillageVisibleAgent(agent: StatusAndLastEvent, now = Date.now()): boolean {
  if (agent.status === 'completed' || agent.status === 'error') return false;
  return isLiveRosterAgent(agent, now);
}
