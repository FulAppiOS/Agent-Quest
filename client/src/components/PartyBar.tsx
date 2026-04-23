import { HeroAvatar } from './HeroAvatar';
import type { AgentState } from '../types/agent';
import './PartyBar.css';

interface PartyBarProps {
  agents: AgentState[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
}

const MAX_VISIBLE = 15;

export function PartyBar({ agents, selectedAgentId, onSelectAgent }: PartyBarProps) {
  const visible = agents.filter((a) => a.status === 'active' || a.status === 'idle');
  const activeCount = visible.filter((a) => a.status === 'active').length;
  const idleCount = visible.filter((a) => a.status === 'idle').length;

  const sorted = [...visible].sort((a, b) => {
    const statusOrder = { active: 0, waiting: 1, idle: 2, error: 3, completed: 4 };
    return statusOrder[a.status] - statusOrder[b.status];
  });

  const displayed = sorted.slice(0, MAX_VISIBLE);
  const remaining = sorted.length - displayed.length;

  return (
    <div className="partybar">
      <div className="partybar-title">Party ({activeCount} active, {idleCount} idle)</div>
      {displayed.map((agent) => (
        <div
          key={agent.id}
          className={`partybar-agent ${agent.id === selectedAgentId ? 'selected' : ''}`}
          onClick={() => onSelectAgent(agent.id)}
        >
          <HeroAvatar agent={agent} />
          <span className={`partybar-dot ${agent.status}`} />
          <span className="partybar-agent-name">{agent.name}</span>
          <span className="partybar-activity">{agent.currentActivity}</span>
          {agent.lastMessage && (
            <div className="partybar-agent-message">{agent.lastMessage.slice(0, 60)}...</div>
          )}
        </div>
      ))}
      {remaining > 0 && (
        <div className="partybar-more">and {remaining} more...</div>
      )}
    </div>
  );
}
