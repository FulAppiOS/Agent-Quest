import type { AgentSource, AgentState, HeroClass, HeroColor } from '../types';
import { HERO_CLASSES, HERO_COLORS } from '../types';
import type { ParsedEvent } from '../parsers/session-parser';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

function cwdBasename(cwd: string): string {
  const parts = cwd.split('/').filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? cwd;
}

function looksLikeSessionPrefix(name: string): boolean {
  return /^[a-f0-9]{8}$/i.test(name);
}

function isSubagentId(sessionId: string): boolean {
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
  if (isSubagentId(sessionId)) return deriveSubagentName(sessionId);
  if (slug !== undefined) return slug;
  if (cwd !== undefined && cwd.length > 0) return cwdBasename(cwd);
  return sessionId.slice(0, 8);
}

export interface ProcessResult {
  agent: AgentState;
  isNew: boolean;
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
}

function isSubagentSessionId(sessionId: string): boolean {
  return sessionId.startsWith('agent-');
}

export class AgentStateManager {
  private agents = new Map<string, AgentState>();
  private classIndex = 0;
  private colorIndex = 0;
  private idleThresholdMs: number;
  private completedThresholdMs: number;
  private busyIdleGraceMs: number;
  private subagentIdleThresholdMs: number;
  private subagentCompletedThresholdMs: number;
  private subagentBusyCompletedThresholdMs: number;
  private livenessOracle: SessionLivenessOracle | undefined;

  constructor(opts: AgentStateManagerOptions = {}) {
    this.idleThresholdMs = opts.idleThresholdMs ?? 5 * 60_000;
    this.completedThresholdMs = opts.completedThresholdMs ?? 30 * 60_000;
    this.busyIdleGraceMs = opts.busyIdleGraceMs ?? 20 * 60_000;
    this.subagentIdleThresholdMs = opts.subagentIdleThresholdMs ?? 120_000;
    this.subagentCompletedThresholdMs = opts.subagentCompletedThresholdMs ?? 5 * 60_000;
    this.subagentBusyCompletedThresholdMs = opts.subagentBusyCompletedThresholdMs ?? 15 * 60_000;
    this.livenessOracle = opts.livenessOracle;
  }

  setLivenessOracle(oracle: SessionLivenessOracle | undefined): void {
    this.livenessOracle = oracle;
  }

  processEvent(
    event: ParsedEvent,
    configDir = '',
    source: AgentSource = 'claude',
    nameOverride?: string,
  ): ProcessResult | null {
    const existing = this.agents.get(event.sessionId);

    // Resume hints (last-prompt dumps) never create new agents and never advance
    // lifecycle timers — they would otherwise resurrect historical sessions.
    if (event.isResumeHint === true) {
      if (existing === undefined) return null;
      if (event.currentTask !== undefined) {
        existing.currentTask = event.currentTask;
      }
      return { agent: existing, isNew: false };
    }

    if (existing === undefined) {
      const agent = this.createAgent(event, configDir, source, nameOverride);
      this.agents.set(event.sessionId, agent);
      this.applyDerivedStatus(agent);
      this.applyTurnAndError(agent, event);
      // Liveness wins over turn-end: a dead pid can't be mid-turn.
      this.applyLivenessOverride(agent);
      return { agent, isNew: true };
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
   * we trust the JSONL lifecycle for them. Returns true when the override
   * applied and the caller should short-circuit further status changes.
   */
  private applyLivenessOverride(agent: AgentState): boolean {
    if (
      this.livenessOracle !== undefined &&
      this.livenessOracle.hasAnyLive() &&
      agent.source === 'claude' &&
      !isSubagentSessionId(agent.id) &&
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

    if (isSubagentSessionId(agent.id)) {
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

  /** Mark active agents as idle after inactivity threshold. Busy agents get a longer grace. */
  checkIdleAgents(thresholdMs: number): string[] {
    const now = Date.now();
    const idled: string[] = [];

    for (const agent of this.agents.values()) {
      if (agent.status !== 'active') continue;
      if (isSubagentSessionId(agent.id)) {
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
      if (isSubagentSessionId(agent.id)) {
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
      removed.push(agent.id);
    }

    return removed;
  }

  /** Return all agents sorted by lastEvent (most recent first). */
  getAll(): AgentState[] {
    return Array.from(this.agents.values()).sort((a, b) => b.lastEvent - a.lastEvent);
  }

  private nextHeroClass(): HeroClass {
    const cls = HERO_CLASSES[this.classIndex % HERO_CLASSES.length]!;
    this.classIndex++;
    return cls;
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

  private createAgent(
    event: ParsedEvent,
    configDir: string,
    source: AgentSource,
    nameOverride?: string,
  ): AgentState {
    const name = nameOverride !== undefined && nameOverride.length > 0
      ? nameOverride
      : deriveAgentName(event.slug, event.cwd, event.sessionId);
    const agent: AgentState = {
      id: event.sessionId,
      name,
      heroClass: this.nextHeroClass(),
      heroColor: this.pickUnusedColorFor(name),
      status: 'active',
      currentActivity: event.activity,
      currentFile: event.file,
      currentCommand: event.command,
      tokenUsage: { input: 0, output: 0, cacheRead: 0 },
      cost: 0,
      sessionStart: event.timestamp,
      toolCalls: [...event.toolCalls],
      errors: [],
      filesModified: this.extractModifiedFiles(event),
      lastEvent: event.timestamp,
      lastMessage: event.lastMessage,
      currentTask: event.currentTask,
      cwd: event.cwd ?? '',
      configDir,
      source,
      model: event.model,
    };
    return agent;
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
    if (event.model !== undefined) {
      agent.model = event.model;
    }

    // Subagents keep their filename-derived name — the event's slug is the
    // parent session's slug (copied verbatim) and would be misleading.
    if (!isSubagentId(agent.id)) {
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
