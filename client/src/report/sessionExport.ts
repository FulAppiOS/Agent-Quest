import type { AgentSource, AgentState, SkillInventory } from '../types/agent';
import { contextPct, formatTokens, isSubagentAgent } from '../types/agent';
import { computeSessionReport } from './sessionReport';
import { aggregateFleetUsage } from './fleetUsage';

/**
 * Plain-Markdown exports meant to be pasted into another AI session so it can
 * review what an agent did: context budget, tool usage, skills, plugins and
 * delegation. Everything is derived from the live AgentState the dashboard
 * already holds; token figures marked `~` are estimates (characters ÷ 4).
 */

export interface ExportOptions {
  /** Timestamp used for the header and file names (defaults to now). */
  generatedAt?: number;
  /** Include prompt and last-message text. Default true; turn off to share a numbers-only export. */
  includeText?: boolean;
}

const TEXT_LIMIT = 2000;
const FILES_LIMIT = 30;

const SOURCE_LABEL: Record<AgentSource, string> = { claude: 'Claude Code', codex: 'Codex' };

function iso(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : 'unknown';
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec}s`;
}

function truncate(text: string): string {
  const single = text.trim();
  return single.length > TEXT_LIMIT ? `${single.slice(0, TEXT_LIMIT)} [truncated]` : single;
}

function basename(path: string): string {
  const parts = path.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

/** Keep a value from breaking a Markdown table. */
function cell(v: string | number | undefined): string {
  return String(v ?? '–').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
}

function table(headers: string[], rows: Array<Array<string | number | undefined>>): string {
  const head = `| ${headers.map(cell).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

function contextLine(agent: AgentState): string {
  const c = agent.context;
  if (c === undefined) return 'Context window: unknown (no usage sample yet).';
  const pct = contextPct(c);
  const window = c.window !== null ? `${formatTokens(c.window)}${pct !== null ? ` (${Math.round(pct)}%)` : ''}` : 'unknown window';
  return `In use: ${formatTokens(c.used)} / ${window}`;
}

/** The body of a session export: every section after the title. `level` is the heading depth for sections. */
function sessionBody(
  agent: AgentState,
  children: AgentState[],
  inventory: SkillInventory | undefined,
  opts: Required<ExportOptions>,
  level: number,
): string {
  const h = '#'.repeat(level);
  const r = computeSessionReport(agent, children);
  const out: string[] = [];

  out.push(`${h} Session`);
  out.push(`- Name: ${agent.name}`);
  out.push(`- Session id: ${agent.id}`);
  out.push(`- Source: ${SOURCE_LABEL[agent.source]}`);
  out.push(`- Model: ${agent.model ?? 'unknown'}`);
  out.push(`- Profile: ${agent.configDir.length > 0 ? basename(agent.configDir) : 'unknown'}`);
  out.push(`- Project: ${agent.cwd.length > 0 ? agent.cwd : 'unknown'}`);
  out.push(`- Status: ${agent.status} (activity: ${agent.currentActivity})`);
  if (isSubagentAgent(agent)) {
    out.push(`- Role: subagent${agent.subagentType !== undefined ? ` (${agent.subagentType})` : ''}${agent.parentId !== undefined ? `, parent session ${agent.parentId}` : ''}`);
  }
  out.push(`- Started: ${iso(agent.sessionStart)}`);
  out.push(`- Last activity: ${iso(agent.lastEvent)}`);
  out.push(`- Duration: ${formatDuration(r.durationMs)}`);
  if (opts.includeText && agent.currentTask !== undefined && agent.currentTask.length > 0) {
    out.push(`- Current task: ${truncate(agent.currentTask)}`);
  }
  out.push('');

  out.push(`${h} Context window`);
  const c = agent.context;
  if (c === undefined) {
    out.push(`- ${contextLine(agent)}`);
  } else {
    out.push(`- ${contextLine(agent)}`);
    out.push(`- Peak: ${formatTokens(c.peak)}`);
    out.push(`- Compactions: ${c.compactions}`);
    out.push(`- Window source: ${c.windowSource}`);
  }
  out.push('');

  out.push(`${h} Token usage`);
  if (r.hasTokens) {
    out.push(`- Input: ${formatTokens(r.tokens.input)}`);
    out.push(`- Output: ${formatTokens(r.tokens.output)}`);
    out.push(`- Cache read: ${formatTokens(r.tokens.cacheRead)}`);
    out.push(`- Cache write: ${formatTokens(r.tokens.cacheWrite)}`);
    out.push(`- Total: ${formatTokens(r.tokens.total)} (this session only; subagents are listed separately)`);
  } else {
    out.push(agent.source === 'codex'
      ? '- Codex does not report per-message billing usage; see the context window above.'
      : '- No token usage recorded yet.');
  }
  out.push('');

  out.push(`${h} Activity`);
  out.push(`- Tool calls: ${r.toolTotal}`);
  out.push(`- Files modified: ${r.filesModified}`);
  out.push(`- Errors: ${r.errorCount}`);
  if (r.byActivity.length > 0) {
    out.push('');
    out.push(table(['Activity', 'Calls', 'Share'], r.byActivity.map((s) => [s.activity, s.count, `${Math.round(s.pct)}%`])));
  }
  if (r.topTools.length > 0) {
    out.push('');
    out.push(`Top tools: ${r.topTools.map((t) => `${t.name} ×${t.count}`).join(', ')}`);
  }
  if (agent.filesModified.length > 0) {
    out.push('');
    out.push('Files modified:');
    for (const f of agent.filesModified.slice(-FILES_LIMIT)) out.push(`- ${f}`);
    if (agent.filesModified.length > FILES_LIMIT) out.push(`- … ${agent.filesModified.length - FILES_LIMIT} more`);
  }
  out.push('');

  out.push(`${h} Skills`);
  if (agent.activeSkill !== undefined) out.push(`- Active skill: ${agent.activeSkill}`);
  if (r.skills.length === 0) {
    out.push('No skills loaded.');
  } else {
    out.push(table(
      ['Skill', 'Plugin', 'Loads', '~Tokens injected', 'Attributed messages'],
      r.skills.map((s) => [s.name, s.plugin, s.loads, `~${formatTokens(s.loadTokens)}`, s.attributedMessages]),
    ));
  }
  if (inventory !== undefined && inventory.count > 0) {
    const loaded = r.skills.reduce((sum, s) => sum + s.loadTokens, 0);
    out.push('');
    out.push(`${inventory.count} skills installed (~${formatTokens(inventory.tokens)} tokens if always loaded); this session loaded ${r.skills.length} (~${formatTokens(loaded)}).`);
  }
  out.push('');

  out.push(`${h} Plugins & MCP`);
  if (r.plugins.length === 0) {
    out.push('No plugin or MCP calls.');
  } else {
    out.push(table(
      ['Plugin / server', 'Kind', 'Calls', '~Result tokens'],
      r.plugins.map((p) => [p.name, p.kind, p.calls, `~${formatTokens(p.resultTokens)}`]),
    ));
  }
  out.push('');

  if (r.delegation !== undefined) {
    out.push(`${h} Delegation`);
    out.push(`- Subagents: ${r.delegation.live} live / ${r.delegation.count} total`);
    out.push(`- Processed by them: ~${formatTokens(r.delegation.childPeakTokens)}`);
    out.push(`- Returned here: ~${formatTokens(r.delegation.returnedTokens)}`);
    out.push(`- Kept out of this context: ~${formatTokens(r.delegation.keptOutTokens)}`);
    out.push('');
    out.push(table(
      ['Subagent', 'Role', 'Status', 'Context peak', 'Returned'],
      children.map((ch) => [
        ch.name,
        ch.subagentType,
        ch.status,
        ch.context !== undefined ? `~${formatTokens(ch.context.peak)}` : undefined,
        ch.returnedTokens !== undefined ? `~${formatTokens(ch.returnedTokens)}` : undefined,
      ]),
    ));
    out.push('');
  }

  out.push(`${h} Last message`);
  if (!opts.includeText) {
    out.push('(omitted)');
  } else if (agent.lastMessage === undefined || agent.lastMessage.length === 0) {
    out.push('(none)');
  } else {
    out.push('```text');
    out.push(truncate(agent.lastMessage).replace(/```/g, "'''"));
    out.push('```');
  }
  out.push('');

  out.push(`${h} Review questions`);
  out.push('- Is the context window close to saturation? If so, which tool results, file reads or skill bodies account for most of it?');
  out.push('- Were skills loaded but never applied (attributed messages = 0)? Could a lighter skill or no skill have done the job?');
  out.push('- Do any plugins return large results that could be filtered, paginated or summarized before entering the context?');
  out.push('- Would delegating a long exploration to a subagent have kept this context smaller? If subagents were used, was their returned size proportionate?');
  out.push('- Are repeated reads of the same files or repeated commands visible in the activity breakdown?');
  out.push('- Given the status and the last message, what should the next prompt to this agent be?');
  return out.join('\n');
}

/** Markdown export for one agent session (plus its subagents). */
export function buildSessionMarkdown(
  agent: AgentState,
  children: AgentState[],
  inventory?: SkillInventory,
  options: ExportOptions = {},
): string {
  const opts: Required<ExportOptions> = { generatedAt: options.generatedAt ?? Date.now(), includeText: options.includeText ?? true };
  const out: string[] = [];
  out.push(`# Agent Quest session export: ${agent.name}`);
  out.push('');
  out.push(`Generated: ${iso(opts.generatedAt)}. Scope: one ${SOURCE_LABEL[agent.source]} session${children.length > 0 ? ` plus ${children.length} subagent${children.length === 1 ? '' : 's'}` : ''}.`);
  out.push('');
  out.push('> Purpose: give an AI reviewer outside Agent Quest what it needs to assess this session: context budget, tool usage, skills and plugins, delegation. Figures marked `~` are estimates (characters ÷ 4). File paths and prompt text are included unless the export was made without text.');
  out.push('');
  out.push(sessionBody(agent, children, inventory, opts, 2));
  return `${out.join('\n')}\n`;
}

/** Markdown export for every main agent (with its subagents), plus fleet-wide skill and plugin tables. */
export function buildFleetMarkdown(
  agents: AgentState[],
  skillInventory: Partial<Record<AgentSource, SkillInventory>>,
  options: ExportOptions = {},
): string {
  const opts: Required<ExportOptions> = { generatedAt: options.generatedAt ?? Date.now(), includeText: options.includeText ?? true };
  const mains = agents.filter((a) => !isSubagentAgent(a));
  const childrenOf = (id: string) => agents.filter((a) => isSubagentAgent(a) && a.parentId === id);
  const usage = aggregateFleetUsage(agents);
  const out: string[] = [];

  out.push('# Agent Quest fleet export');
  out.push('');
  out.push(`Generated: ${iso(opts.generatedAt)}. ${mains.length} main agent${mains.length === 1 ? '' : 's'}, ${agents.length - mains.length} subagent${agents.length - mains.length === 1 ? '' : 's'}.`);
  out.push('');
  out.push('> Purpose: give an AI reviewer outside Agent Quest a picture of every running or recent agent session: who is close to a context compaction, which skills and plugins cost the most context, and how work was delegated. Figures marked `~` are estimates (characters ÷ 4).');
  out.push('');

  out.push('## Overview');
  out.push(table(
    ['Agent', 'Source', 'Model', 'Status', 'Context', 'Subagents'],
    mains.map((a) => {
      const pct = contextPct(a.context);
      return [a.name, a.source, a.model, a.status, pct !== null ? `${Math.round(pct)}%` : undefined, childrenOf(a.id).length];
    }),
  ));
  out.push('');

  out.push('## Skills (all agents)');
  if (usage.skills.length === 0) {
    out.push('No skills loaded.');
  } else {
    out.push(table(
      ['Skill', 'Plugin', 'Loads', '~Tokens injected', 'Agents'],
      usage.skills.map((s) => [s.name, s.plugin, s.loads, `~${formatTokens(s.loadTokens)}`, s.agents]),
    ));
  }
  for (const source of ['claude', 'codex'] as const) {
    const inv = skillInventory[source];
    if (inv !== undefined && inv.count > 0) {
      out.push(`- ${SOURCE_LABEL[source]}: ${inv.count} skills installed (~${formatTokens(inv.tokens)} tokens if always loaded).`);
    }
  }
  out.push('');

  out.push('## Plugins & MCP (all agents)');
  if (usage.plugins.length === 0) {
    out.push('No plugin or MCP calls.');
  } else {
    out.push(table(
      ['Plugin / server', 'Kind', 'Calls', '~Result tokens', 'Agents'],
      usage.plugins.map((p) => [p.name, p.kind, p.calls, `~${formatTokens(p.resultTokens)}`, p.agents]),
    ));
  }
  out.push('');

  out.push('## Sessions');
  out.push('');
  for (const a of mains) {
    out.push(`### ${a.name}`);
    out.push('');
    out.push(sessionBody(a, childrenOf(a.id), skillInventory[a.source], opts, 4));
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

/** Trimmed JSON shape: no raw tool inputs (they can hold secrets and are huge), counts instead. */
export function buildSessionJson(agent: AgentState, children: AgentState[]): Record<string, unknown> {
  const r = computeSessionReport(agent, children);
  const toolCounts: Record<string, number> = {};
  for (const tc of agent.toolCalls) toolCounts[tc.name] = (toolCounts[tc.name] ?? 0) + 1;
  return {
    id: agent.id,
    name: agent.name,
    source: agent.source,
    model: agent.model,
    profile: agent.configDir,
    project: agent.cwd,
    status: agent.status,
    activity: agent.currentActivity,
    isSubagent: isSubagentAgent(agent),
    parentId: agent.parentId,
    subagentType: agent.subagentType,
    startedAt: iso(agent.sessionStart),
    lastActivityAt: iso(agent.lastEvent),
    durationMs: r.durationMs,
    currentTask: agent.currentTask,
    lastMessage: agent.lastMessage,
    context: agent.context,
    tokenUsage: agent.tokenUsage,
    toolCounts,
    byActivity: r.byActivity,
    filesModified: agent.filesModified,
    errors: agent.errors,
    activeSkill: agent.activeSkill,
    skills: r.skills,
    plugins: r.plugins,
    delegation: r.delegation,
    subagents: children.map((ch) => ({
      id: ch.id,
      name: ch.name,
      role: ch.subagentType,
      status: ch.status,
      contextPeak: ch.context?.peak,
      returnedTokens: ch.returnedTokens,
    })),
  };
}

/** Every main agent as `buildSessionJson`, nested subagents included. */
export function buildFleetJson(agents: AgentState[], generatedAt: number = Date.now()): Record<string, unknown> {
  const mains = agents.filter((a) => !isSubagentAgent(a));
  return {
    generatedAt: iso(generatedAt),
    agents: mains.map((a) => buildSessionJson(a, agents.filter((c) => isSubagentAgent(c) && c.parentId === a.id))),
  };
}

/** `agent-quest-<slug>-<YYYY-MM-DD>.<ext>` */
export function exportFileName(base: string, ext: 'md' | 'json', at: number = Date.now()): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
  const day = new Date(at).toISOString().slice(0, 10);
  return `agent-quest-${slug}-${day}.${ext}`;
}
