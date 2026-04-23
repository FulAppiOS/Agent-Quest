import type { ActivityLogEntry } from '../types/agent';

/**
 * Heuristic: detail looks like a single file path (not a command).
 * Path-like = starts with `/`, `./`, `../` OR is a single token containing
 * a slash and a recognisable extension. Intentionally conservative — false
 * positives just render a non-functional anchor; false negatives lose styling.
 */
export function isPath(detail: string): boolean {
  if (detail.length === 0) return false;
  if (detail.includes(' ')) return false; // commands have spaces; paths usually don't
  if (detail.startsWith('/') || detail.startsWith('./') || detail.startsWith('../')) {
    return true;
  }
  return /\/[\w.-]+\.[a-zA-Z0-9]+$/.test(detail);
}

/**
 * Heuristic: this entry represents a failed Bash invocation.
 * Bash-only — other tools surface their own errors differently and we don't
 * have structured exit codes in the activity log right now.
 */
export function isError(action: string, detail: string): boolean {
  if (action !== 'Bash') return false;
  if (detail.includes('→ exit ')) return true;
  if (detail.startsWith('error:')) return true;
  return false;
}

/**
 * Race fallback: a log entry can theoretically arrive before its agent:new.
 * Derive a readable name from the id so we don't show "agent-aside_" truncated.
 * Mirror the existing logic from ActivityFeed.tsx pre-redesign — innocuous if
 * the race never fires.
 */
export function getAgentNameFallback(agentId: string): string {
  if (agentId.startsWith('agent-')) {
    const rest = agentId.slice('agent-'.length);
    const m = rest.match(/^(.*?)-([a-f0-9]{16,})$/);
    if (m !== null && m[1] !== undefined && m[1].length > 0) return m[1];
    return rest.slice(0, 12);
  }
  return agentId.slice(0, 8);
}

/**
 * Resolve a detail path against an agent's cwd to an absolute path suitable
 * for vscode://file/. Returns null if not resolvable (relative + no cwd, or
 * a ~ path).
 */
export function resolvePath(detail: string, cwd: string | undefined): string | null {
  if (detail.length === 0) return null;
  if (detail.startsWith('~')) return null;
  if (detail.startsWith('/')) return detail;
  if (cwd === undefined || cwd.length === 0) return null;
  const base = cwd.endsWith('/') ? cwd.slice(0, -1) : cwd;
  return `${base}/${detail}`;
}

export type ActionFilter = 'errors' | 'edits' | 'bash' | 'reads' | 'messages' | 'agent' | 'other';

const READ_ACTIONS = new Set(['Read', 'Grep', 'Glob']);
const EDIT_ACTIONS = new Set(['Edit', 'Write', 'NotebookEdit']);
const MESSAGE_ACTIONS = new Set(['Reply', 'Prompt']);

export function categorizeEntry(action: string, detail: string): ActionFilter {
  if (isError(action, detail)) return 'errors';
  if (EDIT_ACTIONS.has(action)) return 'edits';
  if (action === 'Bash') return 'bash';
  if (READ_ACTIONS.has(action)) return 'reads';
  if (MESSAGE_ACTIONS.has(action)) return 'messages';
  if (action === 'Agent') return 'agent';
  return 'other';
}

function entryMatchesFilter(entry: ActivityLogEntry, filter: ActionFilter): boolean {
  return categorizeEntry(entry.action, entry.detail) === filter;
}

export function filterByAction(log: ActivityLogEntry[], filters: ActionFilter[]): ActivityLogEntry[] {
  if (filters.length === 0) return log;
  return log.filter((e) => filters.some((f) => entryMatchesFilter(e, f)));
}

export interface DetectedCategories {
  categories: Set<ActionFilter>;
  counts: Record<ActionFilter, number>;
}

export function detectCategories(log: ActivityLogEntry[]): DetectedCategories {
  const counts: Record<ActionFilter, number> = {
    errors: 0, edits: 0, bash: 0, reads: 0, messages: 0, agent: 0, other: 0,
  };
  for (const entry of log) {
    counts[categorizeEntry(entry.action, entry.detail)]++;
  }
  const categories = new Set<ActionFilter>();
  for (const key of Object.keys(counts) as ActionFilter[]) {
    if (counts[key] > 0) categories.add(key);
  }
  return { categories, counts };
}

export function filterByAgent(log: ActivityLogEntry[], agentId: string | null): ActivityLogEntry[] {
  if (agentId === null) return log;
  return log.filter((e) => e.agentId === agentId);
}

export interface AgentGroup {
  agentId: string;
  entries: ActivityLogEntry[];
  /** timestamp of the most recent entry in the group */
  latestTimestamp: number;
}

export function groupByAgent(log: ActivityLogEntry[]): AgentGroup[] {
  const map = new Map<string, ActivityLogEntry[]>();
  for (const entry of log) {
    let arr = map.get(entry.agentId);
    if (arr === undefined) {
      arr = [];
      map.set(entry.agentId, arr);
    }
    arr.push(entry);
  }
  const groups: AgentGroup[] = [];
  for (const [agentId, entries] of map) {
    entries.sort((a, b) => b.timestamp - a.timestamp);
    groups.push({
      agentId,
      entries,
      latestTimestamp: entries[0]!.timestamp,
    });
  }
  groups.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  return groups;
}
