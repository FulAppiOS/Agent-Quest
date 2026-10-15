import type { ContextUsage } from '../types';

/**
 * Context-window resolution for Claude Code sessions.
 *
 * Claude Code never writes the window size to the JSONL, and `message.model`
 * drops the `[1m]` suffix that marks the 1M-token variant, so we combine the
 * hints we do have, strongest first:
 *   1. an explicit override (`AGENT_QUEST_CLAUDE_CONTEXT_WINDOW`),
 *   2. a `[1m]` suffix on the session model id (rare, but authoritative),
 *   3. a `[1m]` model configured in the install's `settings.json` that matches
 *      the session's model family,
 *   4. the observed usage: anything above the 200k default proves a 1M window,
 *      and that inference sticks for the rest of the session.
 * Codex reports its window explicitly (`model_context_window`) and never goes
 * through this function.
 */
export const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200_000;
export const LARGE_CLAUDE_CONTEXT_WINDOW = 1_000_000;

const LARGE_SUFFIX = '[1m]';

export interface ResolveContextWindowInput {
  /** Session model id from the JSONL (e.g. `claude-fable-5-1`, `claude-opus-5[1m]`, or an alias like `opus`). */
  model?: string;
  /** `model` from `<configDir>/settings.json` (e.g. `claude-fable-5-1[1m]`). */
  configuredModel?: string;
  /** Raw env override, parsed as a positive integer. */
  envOverride?: string;
  /** Tokens in use for the sample being applied. */
  used: number;
  /** The agent's current context state, if any (keeps an inferred window sticky). */
  current?: ContextUsage;
}

export interface ResolvedContextWindow {
  window: number;
  source: ContextUsage['windowSource'];
}

function hasLargeSuffix(id: string): boolean {
  return id.toLowerCase().endsWith(LARGE_SUFFIX);
}

function stripSuffix(id: string): string {
  return id.toLowerCase().replace(/\[1m\]$/, '');
}

/**
 * Whether a configured model applies to the session model. Aliases (`opus`,
 * `fable`) match any id of that family; an unknown session model never
 * contradicts the configuration.
 */
function sameModelFamily(configured: string, model: string | undefined): boolean {
  if (model === undefined || model.length === 0) return true;
  const base = stripSuffix(configured);
  const m = stripSuffix(model);
  return base === m || m.includes(base) || base.includes(m);
}

export function resolveContextWindow(input: ResolveContextWindowInput): ResolvedContextWindow {
  const override = input.envOverride !== undefined ? Number.parseInt(input.envOverride, 10) : Number.NaN;
  if (Number.isFinite(override) && override > 0) return { window: override, source: 'configured' };

  if (input.model !== undefined && hasLargeSuffix(input.model)) {
    return { window: LARGE_CLAUDE_CONTEXT_WINDOW, source: 'configured' };
  }
  if (input.configuredModel !== undefined && hasLargeSuffix(input.configuredModel) && sameModelFamily(input.configuredModel, input.model)) {
    return { window: LARGE_CLAUDE_CONTEXT_WINDOW, source: 'configured' };
  }
  if (input.current?.windowSource === 'inferred' || input.used > DEFAULT_CLAUDE_CONTEXT_WINDOW) {
    return { window: LARGE_CLAUDE_CONTEXT_WINDOW, source: 'inferred' };
  }
  return { window: DEFAULT_CLAUDE_CONTEXT_WINDOW, source: 'default' };
}
