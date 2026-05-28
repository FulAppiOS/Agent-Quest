import type { AgentState } from '../types/agent';

/**
 * Project the full `agents` snapshot to the subset displayed in the Party
 * Bar and the Phaser village scene. TopBar stats and DetailPanel lookup
 * keep using the unfiltered list — this projection only governs the two
 * presentation surfaces.
 *
 * This function is the single authoritative gate for which statuses reach
 * those surfaces:
 *
 *   - `active`, `idle`, `waiting` — always pass through. `waiting` is a
 *     short-lived "turn just ended, hero is resting at the tavern" state;
 *     HeroSprite has dedicated pulse/label rendering for it, so it must
 *     reach the Phaser scene. computeShowSourceBadge treats waiting as
 *     live too — keep the two functions in agreement.
 *   - `completed` — pass through only when `showCompleted` is true.
 *   - `error` — always blocked here. The scene additionally drops `error`
 *     defensively, and there is currently no Party Bar surfacing for it.
 *
 * Downstream consumers may apply additional local hiding (e.g. the Phaser
 * scene drops heroes whose last event is older than its idle threshold),
 * but they MUST NOT re-introduce `error` once it has been filtered out.
 */
export function filterAgentsForPresentation(
  agents: AgentState[],
  showCompleted: boolean,
): AgentState[] {
  return agents.filter((agent) => {
    if (agent.status === 'active' || agent.status === 'idle' || agent.status === 'waiting') {
      return true;
    }
    if (agent.status === 'completed' && showCompleted) return true;
    return false;
  });
}

/**
 * Whether the source-provider badge (Claude/Codex orange/teal pill) should
 * be shown anywhere in the UI. Only true when both providers have at least
 * one LIVE agent — completed/error sessions don't count, otherwise the
 * badge would linger after the last Codex hero finishes.
 *
 * Used by both App.tsx (React overlays) and VillageScene.ts (Phaser sprite
 * badges); keep them in sync by calling this function instead of inlining
 * the logic.
 */
export function computeShowSourceBadge(agents: AgentState[]): boolean {
  let hasClaude = false;
  let hasCodex = false;
  for (const a of agents) {
    if (a.status === 'completed' || a.status === 'error') continue;
    if (a.source === 'claude') hasClaude = true;
    else if (a.source === 'codex') hasCodex = true;
    if (hasClaude && hasCodex) return true;
  }
  return false;
}
