import type { AgentState } from './agent';

export function isXcodeAgent(agent: Pick<AgentState, 'configDir'>): boolean {
  return /\/Library\/Developer\/Xcode\/CodingAssistant\/(?:ClaudeAgentConfig|codex)(?:\/|$)/.test(agent.configDir);
}

export function sourceBadgeLabel(agent: Pick<AgentState, 'source' | 'configDir'>): string {
  return isXcodeAgent(agent) ? 'Xcode' : agent.source.toUpperCase();
}
