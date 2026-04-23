import { useState } from 'react';
import { HERO_LABEL_COLOR, type ActivityLogEntry, type AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { ActivityRow } from './ActivityRow';
import { categorizeEntry, type ActionFilter } from './activityFeedUtils';

interface AgentGroupProps {
  agentId: string;
  agent: AgentState | undefined;
  agentName: string;
  entries: ActivityLogEntry[];
  activeHighlights: ActionFilter[];
  selectedEntryKey: string | null;
  onSelectAgent: (id: string) => void;
  onSelectEntry: (entryKey: string) => void;
  onFilterAgent: (id: string) => void;
}

const COLLAPSED_VISIBLE = 3;

export function AgentGroup({
  agentId, agent, agentName, entries,
  activeHighlights, selectedEntryKey,
  onSelectAgent, onSelectEntry, onFilterAgent,
}: AgentGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? entries : entries.slice(0, COLLAPSED_VISIBLE);
  const hidden = entries.length - visible.length;

  const shouldHighlight = (entry: ActivityLogEntry): boolean => {
    if (activeHighlights.length === 0) return false;
    return activeHighlights.includes(categorizeEntry(entry.action, entry.detail));
  };

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
            <HeroAvatar agent={agent} size="inherit" />
          </button>
        ) : <span className="feed-group-avatar-placeholder" aria-hidden="true" />}
        <span
          className="feed-group-name"
          style={agent !== undefined ? { color: HERO_LABEL_COLOR[agent.heroColor] } : undefined}
        >{agentName}</span>
        {agent !== undefined && (
          <span className="feed-group-activity">· {agent.currentActivity}</span>
        )}
      </header>

      <div className="feed-group-body">
        {visible.map((entry) => {
          const entryKey = `${entry.agentId}-${entry.timestamp}-${entry.action}-${entry.detail}`;
          return (
            <ActivityRow
              key={entryKey}
              entry={entry}
              agent={agent}
              agentName={agentName}
              inGroup
              highlighted={shouldHighlight(entry)}
              isSelected={entryKey === selectedEntryKey}
              onSelectAgent={(id) => {
                onSelectEntry(entryKey);
                onSelectAgent(id);
              }}
              onFilterAgent={onFilterAgent}
            />
          );
        })}
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
