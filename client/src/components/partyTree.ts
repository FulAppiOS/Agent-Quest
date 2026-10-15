import type { AgentState } from '../types/agent';
import { isSubagentAgent } from '../types/agent';

/** One Party Bar row group: a top-level agent and the live subagents working for it. */
export interface PartyNode {
  agent: AgentState;
  children: AgentState[];
}

const STATUS_ORDER: Record<AgentState['status'], number> = {
  active: 0,
  waiting: 1,
  idle: 2,
  error: 3,
  completed: 4,
};

function byStatus(a: AgentState, b: AgentState): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
}

/**
 * Highest live ancestor of a subagent: climb `parentId` while the parent is in
 * the roster. Returns undefined when the direct parent is missing (parent
 * finished, or an older server without `parentId`) — the agent is then a root.
 * Sub-subagents attach to the top of their chain, so a two-level fan-out never
 * hides a working hero under a row that isn't rendered.
 */
function topAncestorId(a: AgentState, byId: Map<string, AgentState>): string | undefined {
  if (!isSubagentAgent(a)) return undefined;
  let top: AgentState | undefined;
  let cur: AgentState = a;
  const seen = new Set<string>([a.id]);
  while (cur.parentId !== undefined && !seen.has(cur.parentId)) {
    const parent = byId.get(cur.parentId);
    if (parent === undefined) break;
    seen.add(parent.id);
    top = parent;
    cur = parent;
  }
  return top?.id;
}

/**
 * Group the live roster into parent → children nodes. A subagent nests under
 * the top live agent of its parent chain; otherwise it stays a root so no
 * working hero ever disappears from the list. Roots keep the status order
 * (active → waiting → idle → …); children follow their input order.
 */
export function buildPartyTree(live: AgentState[]): PartyNode[] {
  const byId = new Map(live.map((a) => [a.id, a]));
  const childrenOf = new Map<string, AgentState[]>();
  const roots: AgentState[] = [];

  for (const a of live) {
    const parentId = topAncestorId(a, byId);
    if (parentId !== undefined) {
      const list = childrenOf.get(parentId) ?? [];
      list.push(a);
      childrenOf.set(parentId, list);
    } else {
      roots.push(a);
    }
  }

  // Stable sort: equal statuses keep their input order.
  return roots
    .map((agent, i) => ({ agent, i }))
    .sort((x, y) => byStatus(x.agent, y.agent) || x.i - y.i)
    .map(({ agent }) => ({ agent, children: childrenOf.get(agent.id) ?? [] }));
}
