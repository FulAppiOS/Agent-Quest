import { useState } from 'react';
import type { ActivityLogEntry, AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { ActivityRow } from './ActivityRow';

interface AgentGroupProps {
  agentId: string;
  agent: AgentState | undefined;
  agentName: string;
  entries: ActivityLogEntry[];
  onSelectAgent: (id: string) => void;
  onFilterAgent: (id: string) => void;
}

const COLLAPSED_VISIBLE = 3;

export function AgentGroup({ agentId, agent, agentName, entries, onSelectAgent, onFilterAgent }: AgentGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? entries : entries.slice(0, COLLAPSED_VISIBLE);
  const hidden = entries.length - visible.length;

  return (
    <section className="feed-group" aria-label={`Activity for ${agentName}`}>
      <header className="feed-group-header">
        {agent !== undefined ? (
          <button
            type="button"
            className="feed-group-avatar"
            aria-label={`Select agent ${agentName}`}
            onClick={() => onSelectAgent(agentId)}
          >
            <HeroAvatar agent={agent} />
          </button>
        ) : <span className="feed-group-avatar-placeholder" aria-hidden="true" />}
        <span className="feed-group-name">{agentName}</span>
        {agent !== undefined && (
          <span className="feed-group-activity">· {agent.currentActivity}</span>
        )}
      </header>

      <div className="feed-group-body">
        {visible.map((entry) => (
          <ActivityRow
            key={`${entry.agentId}-${entry.timestamp}-${entry.action}-${entry.detail}`}
            entry={entry}
            agent={agent}
            agentName={agentName}
            inGroup
            onSelectAgent={onSelectAgent}
            onFilterAgent={onFilterAgent}
          />
        ))}
        {hidden > 0 && (
          <button type="button" className="feed-group-more" onClick={() => setExpanded(true)}>
            + {hidden} more
          </button>
        )}
        {expanded && entries.length > COLLAPSED_VISIBLE && (
          <button type="button" className="feed-group-less" onClick={() => setExpanded(false)}>
            Show less
          </button>
        )}
      </div>
    </section>
  );
}
