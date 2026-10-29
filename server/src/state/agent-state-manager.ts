import { isXcodeConfigDir, xcodeProjectName } from './xcode-session';
import type { AgentSource, AgentState, ContextUsage, HeroClass, HeroColor, PluginUsage, SkillUsage } from '../types';
import { HERO_COLORS, estimateTokens } from '../types';
import type { ParsedEvent } from '../parsers/session-parser';
import { resolveContextWindow } from './context-window';
import { xcodeToolActivity, xcodeToolFile } from '../parsers/xcode-tools';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
/** Tools that spawn a subagent whose result flows back as a tool_result / task-notification. */
const AGENT_TOOLS = new Set(['Agent', 'Task']);
/** A sample below this fraction of the previous one (which was above the floor) counts as a compaction. */
const COMPACTION_DROP_RATIO = 0.6;
const COMPACTION_MIN_PREV_TOKENS = 50_000;
/** Per-agent cap on tool_use ids remembered while their result is pending. */
const TOOL_USE_INDEX_CAP = 500;
/** Caps on the cross-session maps that can otherwise grow for the life of the process. */
const PENDING_AGENT_RESULTS_CAP = 1000;
const PENDING_HINTS_CAP = 200;
/** A compaction episode (markers + the zero/drop samples around it) is over once a real sample lands, or after this long. */
const COMPACTION_EPISODE_MAX_MS = 10 * 60_000;

function cwdBasename(cwd: string): string {
  const parts = cwd.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? cwd;
}

function looksLikeSessionPrefix(name: string): boolean {
  return /^[a-f0-9]{8}$/i.test(name);
}

/** Claude Code subagent transcripts are keyed by filename: `agent-<descriptor?>-<hex>`. */
function isSubagentSessionId(sessionId: string): boolean {
  return sessionId.startsWith('agent-');
}

/**
 * Subagent filenames look like `agent-<descriptor?>-<16+ hex>`. We use the
 * descriptor when present, otherwise a short hex prefix — the parent session's
 * slug must NOT be used (it's propagated verbatim into subagent JSONL lines).
 */
function deriveSubagentName(sessionId: string): string {
  const rest = sessionId.slice('agent-'.length);
  const m = rest.match(/^(.*?)-([a-f0-9]{16,})$/);
  if (m !== null && m[1] !== undefined && m[1].length > 0) return m[1];
  return rest.slice(0, 12);
}

function deriveAgentName(slug: string | undefined, cwd: string | undefined, sessionId: string): string {
  if (isSubagentSessionId(sessionId)) return deriveSubagentName(sessionId);
  if (slug !== undefined) return slug;
  if (cwd !== undefined && cwd.length > 0) return cwdBasename(cwd);
  return sessionId.slice(0, 8);
}

/**
 * Hero class by role: every main conversation is a knight (`warrior`); the
 * agents working for it are pawns, and ultra-mode Workflow squads are archers.
 * The class is the first thing the eye reads on the map, so it must never be
 * ambiguous between "the agent I'm talking to" and "its helpers".
 */
function heroClassFor(isSubagent: boolean, isWorkflow: boolean): HeroClass {
  if (!isSubagent) return 'warrior';
  return isWorkflow ? 'archer' : 'pawn';
}

/** Real API model ids only — Claude Code writes `<synthetic>` on lines it fabricates (errors, retries). */
function isRealModelId(model: string | undefined): model is string {
  return model !== undefined && model.length > 0 && !model.startsWith('<');
}

/** Drop the oldest entry when a Map reaches its cap (insertion order = age). */
function evictOldest(map: Map<string, unknown>, cap: number): void {
  if (map.size < cap) return;
  const oldest = map.keys().next().value;
  if (oldest !== undefined) map.delete(oldest);
}

/** `superpowers:brainstorming` → `superpowers`; standalone skills have no plugin. */
function pluginFromSkillName(name: string): string | undefined {
  const i = name.indexOf(':');
  return i > 0 ? name.slice(0, i) : undefined;
}

/** `/…/skills/<name>` → `<name>` (last path segment as a fallback). */
function skillNameFromPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const trimmed = path.replace(/\/+$/, '');
  const m = trimmed.match(/\/skills\/([^/]+)$/);
  if (m !== null && m[1] !== undefined) return m[1];
  const last = trimmed.split('/').pop();
  return last !== undefined && last.length > 0 ? last : undefined;
}

/** Plugin that ships a skill, from the cache layout `plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>`. */
function pluginFromSkillPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const cached = path.match(/\/plugins\/cache\/[^/]+\/([^/]+)\//);
  if (cached !== null && cached[1] !== undefined) return cached[1];
  const direct = path.match(/\/plugins\/([^/]+)\/skills\//);
  return direct !== null ? direct[1] : undefined;
}

export interface ProcessResult {
  agent: AgentState;
  isNew: boolean;
  /** Other agents whose visible state this event changed (e.g. a child agent receiving its result size). */
  alsoChanged?: AgentState[];
}

/** Facts a provider knows about a session that the events themselves don't carry. */
export interface SessionMeta {
  configDir?: string;
  source?: AgentSource;
  /** Name resolved by the provider (Claude subagent label, Codex agent nickname). */
  nameOverride?: string;
  /** Explicit subagent flag; falls back to the `agent-` id prefix when omitted. */
  isSubagent?: boolean;
  parentId?: string;
  subagentType?: string;
  /** True for ultra-mode Workflow agents (rendered as archers). */
  isWorkflow?: boolean;
  /** The parent's Agent tool_use id that spawned this subagent — links its returned result size. */
  spawnToolUseId?: string;
  /** Model configured in the install's settings.json — hints the context window. */
  configuredModel?: string;
}

/** Live-session oracle: tells the state manager whether a sessionId has a live Claude pid. */
export interface SessionLivenessOracle {
  /** True once at least one session dir has been scanned. When false the manager falls back to JSONL-only lifecycle. */
  hasAnyLive(): boolean;
  /** True if the sessionId is present in a `<configDir>/sessions/<pid>.json` whose pid is alive. */
  isLive(sessionId: string): boolean;
}

export interface AgentStateManagerOptions {
  /** Age above which an agent transitions from active → idle (ms). Default 5 min. */
  idleThresholdMs?: number;
  /** Age above which an agent transitions from idle → completed (ms). Default 30 min. */
  completedThresholdMs?: number;
  /** Grace window for busy agents — they stay active up to this age before going idle. Default 20 min. */
  busyIdleGraceMs?: number;
  /**
   * Subagent idle threshold (ms), applied only when `busy=false` (post turn-end).
   * Busy subagents never flip to idle — they are considered still working. Default 120s.
   */
  subagentIdleThresholdMs?: number;
  /** Subagent idle → completed threshold (ms), applied only when `busy=false`. Default 5 min. */
  subagentCompletedThresholdMs?: number;
  /**
   * Subagent crash timeout (ms): a `busy=true` subagent silent past this is
   * presumed crashed and is force-completed. Covers long single tool runs
   * (big Edit, slow MCP call, long Opus turn) without risking indefinite
   * ghosts. Default 15 min.
   */
  subagentBusyCompletedThresholdMs?: number;
  /** Optional oracle for cross-referencing sessions against live Claude pids. */
  livenessOracle?: SessionLivenessOracle;
  /** Forces the Claude context window (tokens) for every session, e.g. from `AGENT_QUEST_CLAUDE_CONTEXT_WINDOW`. */
  claudeContextWindowOverride?: string;
}

interface ToolUseRef {
  /** Plugin / MCP server the tool_use belongs to, for result-size attribution. */
  plugin?: string;
  /** True for Agent/Task tool_uses whose result is a subagent's report. */
  isAgent: boolean;
}

/** Per-agent bookkeeping that never leaves the server. */
interface AgentTelemetry {
  configuredModel?: string;
  /** tool_use id → what to attribute its result to, until the result arrives. */
  toolUseIndex: Map<string, ToolUseRef>;
  /** Skill names invoked whose bodies haven't been seen yet (matched by name, else FIFO). */
  pendingSkillLoads: string[];
  /**
   * True from a compaction marker until the next real context sample: both
   * CLIs write two markers per compaction and a zero/dropped sample between
   * them, which would otherwise count the same compaction 2-3 times.
   */
  compactionPending: boolean;
}

/** Telemetry that arrived before the session's first real event (Codex `turn_context` / `task_started`). */
interface SessionHints {
  model?: string;
  window?: number;
}

export class AgentStateManager {
  private agents = new Map<string, AgentState>();
  /** Per-agent set of assistant message ids whose usage has already been counted. */
  private countedUsageIds = new Map<string, Set<string>>();
  private telemetry = new Map<string, AgentTelemetry>();
  /** Parent Agent tool_use id → child agent id. */
  private spawnIndex = new Map<string, string>();
  /** Subagent results (tokens) seen before their child agent was discovered. */
  private pendingAgentResults = new Map<string, number>();
  /** Model / window telemetry seen before the agent existed, applied on creation. */
  private pendingHints = new Map<string, SessionHints>();
  private colorIndex = 0;
  private idleThresholdMs: number;
  private completedThresholdMs: number;
  private busyIdleGraceMs: number;
  private subagentIdleThresholdMs: number;
  private subagentCompletedThresholdMs: number;
  private subagentBusyCompletedThresholdMs: number;
  private livenessOracle: SessionLivenessOracle | undefined;
  private claudeContextWindowOverride: string | undefined;

  constructor(opts: AgentStateManagerOptions = {}) {
    this.idleThresholdMs = opts.idleThresholdMs ?? 5 * 60_000;
    this.completedThresholdMs = opts.completedThresholdMs ?? 30 * 60_000;
    this.busyIdleGraceMs = opts.busyIdleGraceMs ?? 20 * 60_000;
    this.subagentIdleThresholdMs = opts.subagentIdleThresholdMs ?? 120_000;
    this.subagentCompletedThresholdMs = opts.subagentCompletedThresholdMs ?? 5 * 60_000;
    this.subagentBusyCompletedThresholdMs = opts.subagentBusyCompletedThresholdMs ?? 15 * 60_000;
    this.livenessOracle = opts.livenessOracle;
    this.claudeContextWindowOverride = opts.claudeContextWindowOverride;
  }

  setLivenessOracle(oracle: SessionLivenessOracle | undefined): void {
    this.livenessOracle = oracle;
  }

  processEvent(event: ParsedEvent, meta: SessionMeta = {}): ProcessResult | null {
    const existing = this.agents.get(event.sessionId);
    const configDir = meta.configDir ?? existing?.configDir ?? '';
    const child = existing?.isSubagent ?? meta.isSubagent ?? isSubagentSessionId(event.sessionId);
    if (!child && isXcodeConfigDir(configDir)) {
      const project = xcodeProjectName(event.cwd ?? existing?.cwd ?? '');
      if (project !== undefined) {
        event = { ...event, slug: project };
        meta = { ...meta, nameOverride: project };
        if (existing !== undefined) {
          existing.name = project;
          if (event.cwd !== undefined) existing.cwd = event.cwd;
        }
      }
    }

    // Resume hints (last-prompt dumps) never create new agents and never advance
    // lifecycle timers — they would otherwise resurrect historical sessions.
    if (event.isResumeHint === true) {
      if (existing === undefined) return null;
      if (event.currentTask !== undefined) {
        existing.currentTask = event.currentTask;
      }
      return { agent: existing, isNew: false };
    }

    // Telemetry lines (tool results, skill bodies, token counts, compaction
    // markers) only feed accounting: no status, activity or timer changes, and
    // they never create an agent. Returns the agents whose visible state moved.
    if (event.kind === 'telemetry') {
      if (existing === undefined) {
        this.stashHints(event);
        return null;
      }
      const changed = this.applyTelemetry(existing, event);
      const first = changed[0];
      if (first === undefined) return null;
      return { agent: first, isNew: false, alsoChanged: changed.slice(1) };
    }

    if (existing === undefined) {
      const agent = this.createAgent(event, meta);
      this.agents.set(event.sessionId, agent);
      this.registerSpawn(agent, meta.spawnToolUseId);
      this.applyHints(agent, event.timestamp);
      this.ingestAssistantTelemetry(agent, event);
      this.applyDerivedStatus(agent);
      this.applyTurnAndError(agent, event);
      // Liveness wins over turn-end: a dead pid can't be mid-turn.
      this.applyLivenessOverride(agent);
      const recolored = this.adoptChildren(agent);
      return recolored.length > 0 ? { agent, isNew: true, alsoChanged: recolored } : { agent, isNew: true };
    }

    if (event.kind === 'task') {
      this.applyTaskUpdate(existing, event);
      this.applyDerivedStatus(existing);
    } else {
      this.updateAgent(existing, event);
      this.applyDerivedStatus(existing);
      this.applyTurnAndError(existing, event);
      this.applyLivenessOverride(existing);
    }
    return { agent: existing, isNew: false };
  }

  /** Re-run derived status on every tracked agent. Call after the liveness oracle refreshes. */
  refreshAll(): string[] {
    const changed: string[] = [];
    for (const agent of this.agents.values()) {
      const before = agent.status;
      const beforeActivity = agent.currentActivity;
      this.applyDerivedStatus(agent);
      if (agent.status !== before || agent.currentActivity !== beforeActivity) {
        changed.push(agent.id);
      }
    }
    return changed;
  }

  /**
   * Liveness override: when the oracle has at least one live session tracked,
   * any regular (non-subagent) sessionId that doesn't match a live Claude pid
   * is forced to `completed`. Subagents never get pid files of their own, so
   * we trust the JSONL lifecycle for them. Xcode also has no terminal pid
   * registration. Returns true when the override
   * applied and the caller should short-circuit further status changes.
   */
  private applyLivenessOverride(agent: AgentState): boolean {
    if (
      this.livenessOracle !== undefined &&
      this.livenessOracle.hasAnyLive() &&
      agent.source === 'claude' &&
      !isXcodeConfigDir(agent.configDir) &&
      !agent.isSubagent &&
      !this.livenessOracle.isLive(agent.id)
    ) {
      agent.status = 'completed';
      agent.currentActivity = 'idle';
      agent.busy = false;
      return true;
    }
    return false;
  }

  /** Derive status from the age of the agent's last tool event. */
  private applyDerivedStatus(agent: AgentState): void {
    if (this.applyLivenessOverride(agent)) return;

    const age = Date.now() - agent.lastEvent;

    if (agent.isSubagent) {
      // Busy subagents are mid-tool: a single long Edit / MCP call / Opus turn
      // can take many minutes without writing new JSONL lines. Keep them active
      // until the crash timeout, otherwise they flicker completed→active when
      // the trailing result line finally lands.
      if (agent.busy === true) {
        if (age > this.subagentBusyCompletedThresholdMs) {
          agent.status = 'completed';
          agent.currentActivity = 'idle';
          agent.busy = false;
        } else {
          agent.status = 'active';
        }
        return;
      }
      // Post turn-end: aggressive cleanup of finished subagents.
      if (age > this.subagentCompletedThresholdMs) {
        agent.status = 'completed';
        agent.currentActivity = 'idle';
      } else if (age > this.subagentIdleThresholdMs) {
        agent.status = 'idle';
        agent.currentActivity = 'idle';
      } else {
        agent.status = 'active';
      }
      return;
    }

    // Parent session path.
    const idleThreshold = agent.busy === true ? this.busyIdleGraceMs : this.idleThresholdMs;
    if (age > this.completedThresholdMs) {
      agent.status = 'completed';
      agent.currentActivity = 'idle';
    } else if (age > idleThreshold) {
      agent.status = 'idle';
      agent.currentActivity = 'idle';
    } else if (agent.status === 'waiting' && agent.busy !== true) {
      // Sticky 'waiting': a turn-end (inferred from JSONL or pushed by the Stop
      // hook) means "finished, your move". Without this, the periodic
      // refreshAll would recompute age < idleThreshold and revert it to
      // 'active' within ~10s, so the dashboard would never actually show that
      // the agent is done. The `busy !== true` guard lets genuine new activity
      // (a user prompt sets busy=true via applyTaskUpdate; tool events set
      // 'active' directly) pull the agent back out of waiting.
    } else {
      agent.status = 'active';
    }
  }

  /** Overlay turn-end ('waiting') and error timestamps on top of derived status. */
  private applyTurnAndError(agent: AgentState, event: ParsedEvent): void {
    if (event.hasError === true) {
      agent.lastErrorAt = event.timestamp;
    }
    if (event.isTurnEnd === true) {
      agent.busy = false;
      // Turn end only takes effect when the agent isn't already idle/completed.
      if (agent.status === 'active' || agent.status === 'waiting') {
        agent.status = 'waiting';
        // Drop activity to 'idle' so the hero walks to the tavern, not the
        // Wizard Tower (which is mapped to 'thinking', the parser's default).
        agent.currentActivity = 'idle';
      }
    } else {
      // Any non-task non-turn-end event means the agent is mid-turn.
      agent.busy = true;
    }
  }

  private applyTaskUpdate(agent: AgentState, event: ParsedEvent): void {
    if (event.currentTask !== undefined) {
      agent.currentTask = event.currentTask;
    }
    // A user prompt is real activity: bump lastEvent so the agent gets revived
    // out of idle/completed when the next applyDerivedStatus runs.
    agent.lastEvent = event.timestamp;
    agent.busy = true;
    // If the hero was parked at the Tavern (idle) and the new task event signals
    // thinking, move it to the Wizard Tower — without teleporting heroes that
    // are already mid-activity (reading/editing/bash/…).
    if (agent.currentActivity === 'idle' && event.activity === 'thinking') {
      agent.currentActivity = 'thinking';
    }
  }

  getAgent(sessionId: string): AgentState | undefined {
    return this.agents.get(sessionId);
  }

  markCompleted(sessionId: string): void {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) return;
    agent.status = 'completed';
    agent.currentActivity = 'idle';
  }

  /**
   * Authoritative turn-end pushed by the Claude Code `Stop` hook: the main
   * agent finished responding and is waiting for the user. Mirrors the JSONL
   * `isTurnEnd` path (only promotes an active/waiting agent, never resurrects an
   * idle/completed one, and never touches subagents) but arrives immediately and
   * without the inference's false positives. Does not bump `lastEvent` — the
   * idle/completed timers still run off real activity. Returns true if the
   * agent's visible state changed (so the caller can broadcast).
   */
  markTurnEnd(sessionId: string): boolean {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) return false;
    if (agent.isSubagent) return false;
    agent.busy = false;
    if (agent.status !== 'active' && agent.status !== 'waiting') return false;
    const changed = agent.status !== 'waiting' || agent.currentActivity !== 'idle';
    agent.status = 'waiting';
    agent.currentActivity = 'idle';
    return changed;
  }

  /** Mark active agents as idle after inactivity threshold. Busy agents get a longer grace. */
  checkIdleAgents(thresholdMs: number): string[] {
    const now = Date.now();
    const idled: string[] = [];

    for (const agent of this.agents.values()) {
      if (agent.status !== 'active') continue;
      if (agent.isSubagent) {
        // Subagent mid-work: stays active until the crash timeout
        // (checkCompletedAgents handles that path). No idle transition.
        if (agent.busy === true) continue;
        if (now - agent.lastEvent > this.subagentIdleThresholdMs) {
          agent.status = 'idle';
          agent.currentActivity = 'idle';
          idled.push(agent.id);
        }
        continue;
      }
      const threshold = agent.busy === true ? this.busyIdleGraceMs : thresholdMs;
      if (now - agent.lastEvent > threshold) {
        agent.status = 'idle';
        agent.currentActivity = 'idle';
        agent.busy = false;
        idled.push(agent.id);
      }
    }

    return idled;
  }

  /** Transition idle agents to completed; also force-complete busy subagents past the crash timeout. */
  checkCompletedAgents(thresholdMs: number): string[] {
    const now = Date.now();
    const completed: string[] = [];

    for (const agent of this.agents.values()) {
      if (agent.isSubagent) {
        // Crash path: busy subagent silent past the crash timeout is presumed dead.
        if (
          agent.status === 'active' &&
          agent.busy === true &&
          now - agent.lastEvent > this.subagentBusyCompletedThresholdMs
        ) {
          agent.status = 'completed';
          agent.currentActivity = 'idle';
          agent.busy = false;
          completed.push(agent.id);
          continue;
        }
        if (agent.status === 'idle' && now - agent.lastEvent > this.subagentCompletedThresholdMs) {
          agent.status = 'completed';
          completed.push(agent.id);
        }
        continue;
      }
      if (agent.status === 'idle' && now - agent.lastEvent > thresholdMs) {
        agent.status = 'completed';
        completed.push(agent.id);
      }
    }

    return completed;
  }

  /**
   * Remove completed agents older than staleThresholdMs,
   * but always keep at least `minKeep` agents (the most recent by lastEvent).
   */
  cleanupStaleAgents(staleThresholdMs: number, minKeep = 5): string[] {
    const now = Date.now();

    // Collect candidates for removal (completed + old enough)
    const candidates: AgentState[] = [];
    for (const agent of this.agents.values()) {
      if (agent.status === 'completed' && now - agent.lastEvent > staleThresholdMs) {
        candidates.push(agent);
      }
    }

    if (candidates.length === 0) return [];

    // Ensure we keep at least minKeep agents total
    const totalAfterRemoval = this.agents.size - candidates.length;
    if (totalAfterRemoval < minKeep) {
      // Sort candidates by lastEvent desc — keep the most recent ones
      candidates.sort((a, b) => b.lastEvent - a.lastEvent);
      const maxRemovable = Math.max(0, this.agents.size - minKeep);
      candidates.splice(0, candidates.length - maxRemovable);
    }

    const removed: string[] = [];
    for (const agent of candidates) {
      this.agents.delete(agent.id);
      this.countedUsageIds.delete(agent.id);
      this.telemetry.delete(agent.id);
      for (const [toolUseId, childId] of this.spawnIndex) {
        if (childId === agent.id) this.spawnIndex.delete(toolUseId);
      }
      removed.push(agent.id);
    }

    return removed;
  }

  /** Return all agents sorted by lastEvent (most recent first). */
  getAll(): AgentState[] {
    return Array.from(this.agents.values()).sort((a, b) => b.lastEvent - a.lastEvent);
  }

  /**
   * A parent discovered after its subagents: pull the children onto its color
   * so the family reads as one group. Returns the children that changed.
   */
  private adoptChildren(parent: AgentState): AgentState[] {
    if (parent.isSubagent) return [];
    const changed: AgentState[] = [];
    for (const a of this.agents.values()) {
      if (a.isSubagent && a.parentId === parent.id && a.heroColor !== parent.heroColor) {
        a.heroColor = parent.heroColor;
        changed.push(a);
      }
    }
    return changed;
  }

  private nextHeroColor(): HeroColor {
    const color = HERO_COLORS[this.colorIndex % HERO_COLORS.length]!;
    this.colorIndex++;
    return color;
  }

  /**
   * Pick a color that no other currently-tracked agent with the same name owns.
   * This keeps the name labels in the Activity Feed / Party Bar distinguishable
   * when several Claude sessions run in the same project (they all derive the
   * same name from slug/cwd). Falls back to the plain round-robin once all
   * five colors are already in use for that name.
   */
  private pickUnusedColorFor(name: string): HeroColor {
    const used = new Set<HeroColor>();
    for (const a of this.agents.values()) {
      if (a.name === name) used.add(a.heroColor);
    }
    for (let i = 0; i < HERO_COLORS.length; i++) {
      const color = HERO_COLORS[(this.colorIndex + i) % HERO_COLORS.length]!;
      if (!used.has(color)) {
        this.colorIndex += i + 1;
        return color;
      }
    }
    return this.nextHeroColor();
  }

  private createAgent(event: ParsedEvent, meta: SessionMeta): AgentState {
    const name = meta.nameOverride !== undefined && meta.nameOverride.length > 0
      ? meta.nameOverride
      : deriveAgentName(event.slug, event.cwd, event.sessionId);
    const isSubagent = meta.isSubagent ?? isSubagentSessionId(event.sessionId);
    // Subagents wear their parent's color (when the parent is already known);
    // main agents pick a color no same-named hero is using.
    const parent = isSubagent && meta.parentId !== undefined ? this.agents.get(meta.parentId) : undefined;
    const agent: AgentState = {
      id: event.sessionId,
      name,
      heroClass: heroClassFor(isSubagent, meta.isWorkflow === true),
      heroColor: parent !== undefined ? parent.heroColor : this.pickUnusedColorFor(name),
      status: 'active',
      currentActivity: event.activity,
      currentFile: event.file,
      currentCommand: event.command,
      tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
      sessionStart: event.timestamp,
      toolCalls: [...event.toolCalls],
      errors: [],
      filesModified: this.extractModifiedFiles(event),
      lastEvent: event.timestamp,
      lastMessage: event.lastMessage,
      currentTask: event.currentTask,
      cwd: event.cwd ?? '',
      configDir: meta.configDir ?? '',
      source: meta.source ?? 'claude',
      model: isRealModelId(event.model) ? event.model : undefined,
      isSubagent,
      parentId: meta.parentId,
      subagentType: meta.subagentType,
      skills: [],
      plugins: [],
    };
    this.telemetry.set(agent.id, {
      configuredModel: meta.configuredModel,
      toolUseIndex: new Map(),
      pendingSkillLoads: [],
      compactionPending: false,
    });
    return agent;
  }

  private telemetryFor(agent: AgentState): AgentTelemetry {
    let t = this.telemetry.get(agent.id);
    if (t === undefined) {
      t = { toolUseIndex: new Map(), pendingSkillLoads: [], compactionPending: false };
      this.telemetry.set(agent.id, t);
    }
    return t;
  }

  /** Remember model/window telemetry for a session we haven't created yet (Codex emits them before the first UserMessage). */
  private stashHints(event: ParsedEvent): void {
    const model = isRealModelId(event.model) ? event.model : undefined;
    const window = event.contextSample?.window;
    if (model === undefined && window === undefined) return;
    const hints = this.pendingHints.get(event.sessionId) ?? {};
    if (model !== undefined) hints.model = model;
    if (window !== undefined) hints.window = window;
    if (!this.pendingHints.has(event.sessionId)) evictOldest(this.pendingHints, PENDING_HINTS_CAP);
    this.pendingHints.set(event.sessionId, hints);
  }

  private applyHints(agent: AgentState, ts: number): void {
    const hints = this.pendingHints.get(agent.id);
    if (hints === undefined) return;
    this.pendingHints.delete(agent.id);
    if (hints.model !== undefined && agent.model === undefined) agent.model = hints.model;
    if (hints.window !== undefined) this.applyContextSample(agent, { window: hints.window }, ts, 'reported');
  }

  /** Link a child to the parent tool_use that spawned it; settle any result that arrived first. */
  private registerSpawn(child: AgentState, spawnToolUseId: string | undefined): void {
    if (spawnToolUseId === undefined) return;
    this.spawnIndex.set(spawnToolUseId, child.id);
    const pending = this.pendingAgentResults.get(spawnToolUseId);
    if (pending !== undefined) {
      this.pendingAgentResults.delete(spawnToolUseId);
      child.returnedTokens = (child.returnedTokens ?? 0) + pending;
    }
  }

  /**
   * Accounting carried by assistant/tool events: token usage (deduped per API
   * message), skill attribution, skill invocations, plugin calls and the
   * tool_use ids whose results we still have to attribute.
   */
  private ingestAssistantTelemetry(agent: AgentState, event: ParsedEvent): void {
    const countedNewMessage = this.addUsage(agent, event);
    this.applyAttribution(agent, event, countedNewMessage);
    this.recordToolTelemetry(agent, event);
  }

  /**
   * Accumulate token usage, deduped by assistant message id. Claude writes one
   * logical assistant message as several JSONL lines (one per content block)
   * that all repeat the same `usage`; without this guard a message's tokens
   * would be counted 2-3× and the cost estimate would be wildly inflated.
   * Returns true when this call counted a message not seen before.
   */
  private addUsage(agent: AgentState, event: ParsedEvent): boolean {
    if (event.usage === undefined) return false;
    const id = event.usageMessageId;
    if (id !== undefined) {
      let seen = this.countedUsageIds.get(agent.id);
      if (seen === undefined) {
        seen = new Set();
        this.countedUsageIds.set(agent.id, seen);
      }
      if (seen.has(id)) return false; // this message's usage already counted
      seen.add(id);
    }
    agent.tokenUsage.input += event.usage.input;
    agent.tokenUsage.output += event.usage.output;
    agent.tokenUsage.cacheRead += event.usage.cacheRead;
    agent.tokenUsage.cacheWrite += event.usage.cacheWrite;

    // The prompt of this request (input + both cache buckets) plus what the
    // model wrote is what sits in the context window right now.
    const used = event.usage.input + event.usage.cacheRead + event.usage.cacheWrite + event.usage.output;
    const { window, source } = resolveContextWindow({
      model: isRealModelId(event.model) ? event.model : agent.model,
      configuredModel: this.telemetryFor(agent).configuredModel,
      envOverride: this.claudeContextWindowOverride,
      used,
      current: agent.context,
    });
    this.applyContextSample(agent, { used, window }, event.timestamp, source);
    return true;
  }

  /**
   * Skill attribution. Claude Code stamps every assistant line with the skill
   * whose instructions currently apply: the latest line decides the hero's
   * active skill, and each distinct API message counts once toward the skill's
   * tally. Codex has no attribution: its active skill is the last loaded one
   * and clears at turn end.
   */
  private applyAttribution(agent: AgentState, event: ParsedEvent, countedNewMessage: boolean): void {
    if (agent.source === 'claude') {
      // `isTurnEnd` is only ever set on assistant-derived events.
      if (event.isTurnEnd !== undefined) {
        agent.activeSkill = event.attribution?.skill;
      }
      const skillName = event.attribution?.skill;
      if (skillName !== undefined) {
        const skill = this.upsertSkill(agent, skillName, event.timestamp, event.attribution?.plugin);
        if (countedNewMessage) {
          skill.attributedMessages += 1;
          skill.attributedOutputTokens += event.usage?.output ?? 0;
        }
      }
      return;
    }
    if (event.isTurnEnd === true) agent.activeSkill = undefined;
  }

  private recordToolTelemetry(agent: AgentState, event: ParsedEvent): void {
    const t = this.telemetryFor(agent);
    for (const name of event.skillInvocations ?? []) {
      this.upsertSkill(agent, name, event.timestamp);
      t.pendingSkillLoads.push(name);
    }
    for (const call of event.pluginCalls ?? []) {
      const plugin = this.upsertPlugin(agent, call.name, call.kind, event.timestamp);
      plugin.calls += 1;
      if (call.resultChars !== undefined) {
        plugin.resultTokens += estimateTokens(call.resultChars);
      } else if (call.toolUseId !== undefined) {
        this.indexToolUse(t, call.toolUseId, { plugin: call.name, isAgent: false });
      }
    }
    for (const tc of event.toolCalls) {
      if (AGENT_TOOLS.has(tc.name)) this.indexToolUse(t, tc.id, { isAgent: true });
    }
    // Codex carries the skill body on the same line as the command that read it.
    if (event.skillLoad !== undefined) this.applySkillLoad(agent, event);
  }

  private indexToolUse(t: AgentTelemetry, toolUseId: string, ref: ToolUseRef): void {
    if (t.toolUseIndex.size >= TOOL_USE_INDEX_CAP) {
      const oldest = t.toolUseIndex.keys().next().value;
      if (oldest !== undefined) t.toolUseIndex.delete(oldest);
    }
    t.toolUseIndex.set(toolUseId, ref);
  }

  private upsertSkill(agent: AgentState, name: string, ts: number, plugin?: string): SkillUsage {
    let skill = agent.skills.find((s) => s.name === name);
    if (skill === undefined) {
      skill = {
        name,
        plugin: plugin ?? pluginFromSkillName(name),
        loads: 0,
        loadTokens: 0,
        attributedMessages: 0,
        attributedOutputTokens: 0,
        firstUsedAt: ts,
        lastUsedAt: ts,
      };
      agent.skills.push(skill);
      return skill;
    }
    if (skill.plugin === undefined && plugin !== undefined) skill.plugin = plugin;
    if (ts > skill.lastUsedAt) skill.lastUsedAt = ts;
    return skill;
  }

  private upsertPlugin(agent: AgentState, name: string, kind: PluginUsage['kind'], ts: number): PluginUsage {
    let plugin = agent.plugins.find((p) => p.name === name);
    if (plugin === undefined) {
      plugin = { name, kind, calls: 0, resultTokens: 0, lastUsedAt: ts };
      agent.plugins.push(plugin);
      return plugin;
    }
    if (ts > plugin.lastUsedAt) plugin.lastUsedAt = ts;
    return plugin;
  }

  /**
   * A skill body entered the context: attribute its size to the invoked skill.
   * The body's path ends with the skill's short name, so a pending invocation
   * whose name matches (`dataviz`, or `plugin:dataviz`) wins over FIFO order —
   * a failed invocation that never produced a body must not steal the next one.
   */
  private applySkillLoad(agent: AgentState, event: ParsedEvent): boolean {
    const load = event.skillLoad;
    if (load === undefined) return false;
    const t = this.telemetryFor(agent);
    let name = load.name;
    if (name !== undefined) {
      const i = t.pendingSkillLoads.indexOf(name);
      if (i !== -1) t.pendingSkillLoads.splice(i, 1);
    } else {
      const base = skillNameFromPath(load.path);
      const i = base !== undefined
        ? t.pendingSkillLoads.findIndex((n) => n === base || n.endsWith(`:${base}`))
        : -1;
      if (i !== -1) {
        name = t.pendingSkillLoads.splice(i, 1)[0];
      } else {
        name = t.pendingSkillLoads.shift() ?? base;
      }
    }
    if (name === undefined) return false;
    const skill = this.upsertSkill(agent, name, event.timestamp, pluginFromSkillPath(load.path));
    skill.loads += 1;
    skill.loadTokens += estimateTokens(load.chars);
    if (event.timestamp > skill.lastUsedAt) skill.lastUsedAt = event.timestamp;
    if (agent.source !== 'claude') agent.activeSkill = name;
    return true;
  }

  /**
   * Fold a context sample into the agent. `windowSource` applies when the
   * sample carries a window. A sharp drop from a sizeable context is counted
   * as a compaction even without an explicit marker. Returns whether anything
   * the client renders changed.
   */
  private applyContextSample(
    agent: AgentState,
    sample: { used?: number; window?: number },
    ts: number,
    windowSource: ContextUsage['windowSource'],
  ): boolean {
    const prev = agent.context;
    const t = this.telemetryFor(agent);
    const used = sample.used ?? prev?.used ?? 0;
    const window = sample.window ?? prev?.window ?? null;
    const source = sample.window !== undefined ? windowSource : (prev?.windowSource ?? 'default');
    let compactions = prev?.compactions ?? 0;
    let lastCompactionAt = prev?.lastCompactionAt;
    if (sample.used !== undefined && sample.used > 0) {
      if (t.compactionPending) {
        // First real sample after an explicit marker: this IS the post-compaction
        // context, already counted by the marker.
        t.compactionPending = false;
      } else if (
        prev !== undefined &&
        prev.used > COMPACTION_MIN_PREV_TOKENS &&
        sample.used < prev.used * COMPACTION_DROP_RATIO
      ) {
        compactions += 1;
        lastCompactionAt = ts;
      }
    }
    const next: ContextUsage = {
      used,
      peak: Math.max(prev?.peak ?? 0, used),
      window,
      windowSource: source,
      compactions,
      lastCompactionAt,
      updatedAt: sample.used !== undefined ? ts : (prev?.updatedAt ?? ts),
    };
    const changed = prev === undefined
      || prev.used !== next.used
      || prev.window !== next.window
      || prev.windowSource !== next.windowSource
      || prev.compactions !== next.compactions;
    agent.context = next;
    return changed;
  }

  /** Explicit compaction marker. Returns false when it belongs to an episode already counted. */
  private recordCompaction(agent: AgentState, ts: number): boolean {
    const t = this.telemetryFor(agent);
    const prev = agent.context ?? {
      used: 0, peak: 0, window: null, windowSource: 'default' as const, compactions: 0, updatedAt: ts,
    };
    const episodeStart = prev.lastCompactionAt ?? Number.NEGATIVE_INFINITY;
    if (t.compactionPending && ts - episodeStart < COMPACTION_EPISODE_MAX_MS) return false;
    t.compactionPending = true;
    agent.context = { ...prev, compactions: prev.compactions + 1, lastCompactionAt: ts };
    return true;
  }

  /** Apply a telemetry event; returns the agents whose visible state changed (deduped, this agent first). */
  private applyTelemetry(agent: AgentState, event: ParsedEvent): AgentState[] {
    const changed = new Set<AgentState>();
    if (isRealModelId(event.model) && event.model !== agent.model) {
      agent.model = event.model;
      changed.add(agent);
    }
    if (event.contextSample !== undefined) {
      if (this.applyContextSample(agent, event.contextSample, event.timestamp, 'reported')) changed.add(agent);
    }
    if (event.isCompaction === true && this.recordCompaction(agent, event.timestamp)) {
      changed.add(agent);
    }
    if (event.skillLoad !== undefined && this.applySkillLoad(agent, event)) changed.add(agent);
    for (const result of event.toolResults ?? []) {
      for (const a of this.applyToolResult(agent, result.toolUseId, result.chars)) changed.add(a);
    }
    if (event.taskNotification !== undefined) {
      // The notification carries the subagent's actual report; it replaces the
      // launch acknowledgement credited from the Agent tool_result.
      for (const a of this.applyAgentResult(event.taskNotification.toolUseId, event.taskNotification.resultChars, 'set')) changed.add(a);
    }
    // Keep this agent first so the caller broadcasts the obvious one as `agent`.
    const out = [...changed];
    const self = out.indexOf(agent);
    if (self > 0) {
      out.splice(self, 1);
      out.unshift(agent);
    }
    return out;
  }

  /** A tool result landed: attribute its size to the plugin or subagent its tool_use belongs to. */
  private applyToolResult(agent: AgentState, toolUseId: string, chars: number): AgentState[] {
    const t = this.telemetryFor(agent);
    const ref = t.toolUseIndex.get(toolUseId);
    if (ref === undefined) return [];
    t.toolUseIndex.delete(toolUseId);
    if (ref.plugin !== undefined) {
      const plugin = agent.plugins.find((p) => p.name === ref.plugin);
      if (plugin === undefined) return [];
      plugin.resultTokens += estimateTokens(chars);
      return [agent];
    }
    if (ref.isAgent) return this.applyAgentResult(toolUseId, chars);
    return [];
  }

  /**
   * A subagent's report re-entered its parent's context. Credits the child
   * (looked up through the spawn index) or parks the size until the child's
   * transcript is discovered.
   */
  private applyAgentResult(toolUseId: string, chars: number, mode: 'add' | 'set' = 'add'): AgentState[] {
    const tokens = estimateTokens(chars);
    const childId = this.spawnIndex.get(toolUseId);
    const child = childId !== undefined ? this.agents.get(childId) : undefined;
    if (child === undefined) {
      const prev = this.pendingAgentResults.get(toolUseId);
      if (prev === undefined) evictOldest(this.pendingAgentResults, PENDING_AGENT_RESULTS_CAP);
      this.pendingAgentResults.set(toolUseId, mode === 'set' ? tokens : (prev ?? 0) + tokens);
      return [];
    }
    child.returnedTokens = mode === 'set' ? tokens : (child.returnedTokens ?? 0) + tokens;
    return [child];
  }

  private updateAgent(agent: AgentState, event: ParsedEvent): void {
    agent.status = 'active';
    agent.currentActivity = event.activity;
    agent.currentFile = event.file;
    agent.currentCommand = event.command;
    agent.lastEvent = event.timestamp;
    if (event.lastMessage !== undefined) {
      agent.lastMessage = event.lastMessage;
    }
    agent.toolCalls.push(...event.toolCalls);
    if (isRealModelId(event.model)) {
      agent.model = event.model;
    }
    this.ingestAssistantTelemetry(agent, event);

    // Subagents keep their provider-resolved name — the event's slug is the
    // parent session's slug (copied verbatim) and would be misleading.
    if (!agent.isSubagent) {
      if (event.slug !== undefined) {
        agent.name = event.slug;
      } else if (looksLikeSessionPrefix(agent.name) && event.cwd !== undefined) {
        agent.name = cwdBasename(event.cwd);
      }
    }

    for (const f of this.extractModifiedFiles(event)) {
      if (!agent.filesModified.includes(f)) {
        agent.filesModified.push(f);
      }
    }
  }

  private extractModifiedFiles(event: ParsedEvent): string[] {
    const files: string[] = [];
    for (const tc of event.toolCalls) {
      if (xcodeToolActivity(tc.name) === 'editing') {
        const path = xcodeToolFile(tc.name, tc.input);
        if (path !== undefined) files.push(path);
      }
      if (EDIT_TOOLS.has(tc.name)) {
        const fp = tc.input['file_path'];
        if (typeof fp === 'string') {
          files.push(fp);
        }
      }
    }
    return files;
  }
}
