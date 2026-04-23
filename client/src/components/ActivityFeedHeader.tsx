import type { FoldState } from '../hooks/useFeedPrefs';
import type { ActionFilter } from './activityFeedUtils';
import type { AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';

interface ActivityFeedHeaderProps {
  foldState: FoldState;
  activeHighlights: ActionFilter[];
  availableCategories: Set<ActionFilter>;
  categoryCounts: Record<ActionFilter, number>;
  agentFilter: string | null;
  agents: AgentState[];
  newCount: number;
  onFoldChange: (state: FoldState) => void;
  onHighlightsChange: (highlights: ActionFilter[]) => void;
  onClearAgentFilter: () => void;
}

const PILL_ORDER: { id: ActionFilter; label: string }[] = [
  { id: 'messages', label: 'Messages' },
  { id: 'errors',   label: 'Errors'   },
  { id: 'edits',    label: 'Edits'    },
  { id: 'bash',     label: 'Bash'     },
  { id: 'reads',    label: 'Reads'    },
  { id: 'agent',    label: 'Agent'    },
  { id: 'other',    label: 'Other'    },
];

export function ActivityFeedHeader({
  foldState, activeHighlights, availableCategories, categoryCounts,
  agentFilter, agents, newCount,
  onFoldChange, onHighlightsChange, onClearAgentFilter,
}: ActivityFeedHeaderProps) {
  const filteredAgent = agentFilter !== null ? agents.find((a) => a.id === agentFilter) ?? null : null;

  function toggleHighlight(id: ActionFilter) {
    if (activeHighlights.includes(id)) {
      onHighlightsChange(activeHighlights.filter((f) => f !== id));
    } else {
      onHighlightsChange([...activeHighlights, id]);
    }
  }

  const showSecondRow = foldState === 'full';
  const pills = PILL_ORDER.filter((p) => availableCategories.has(p.id));
  const hasChip = filteredAgent !== null;
  const secondRowHasContent = pills.length > 0 || hasChip;

  return (
    <div className="feed-header">
      <div className="feed-header-row">
        <span className="feed-title">
          Activity Feed
          {foldState === 'closed' && newCount > 0 && (
            <span className="feed-new-badge" aria-live="polite">{newCount} new</span>
          )}
        </span>

        <span className="feed-spacer" />

        <div className="feed-fold-buttons">
          <button
            type="button"
            aria-label="Full"
            aria-pressed={foldState === 'full'}
            className={`feed-fold-btn ${foldState === 'full' ? 'active' : ''}`}
            onClick={() => onFoldChange('full')}
          >▭</button>
          <button
            type="button"
            aria-label="Compact"
            aria-pressed={foldState === 'compact'}
            className={`feed-fold-btn ${foldState === 'compact' ? 'active' : ''}`}
            onClick={() => onFoldChange('compact')}
          >▬</button>
          <button
            type="button"
            aria-label="Close"
            aria-pressed={foldState === 'closed'}
            className={`feed-fold-btn ${foldState === 'closed' ? 'active' : ''}`}
            onClick={() => onFoldChange('closed')}
          >▼</button>
        </div>
      </div>

      {showSecondRow && secondRowHasContent && (
        <div className="feed-header-row feed-filter-row">
          {pills.map(({ id, label }) => (
            <button
              type="button"
              key={id}
              aria-pressed={activeHighlights.includes(id)}
              className={`feed-pill ${id} ${activeHighlights.includes(id) ? 'on' : ''}`}
              onClick={() => toggleHighlight(id)}
            >{label} ({categoryCounts[id]})</button>
          ))}
          {filteredAgent !== null && (
            <span className="feed-agent-chip">
              <HeroAvatar agent={filteredAgent} size={14} />
              <span>{filteredAgent.name}</span>
              <button type="button" aria-label="Clear agent filter" className="feed-chip-close" onClick={onClearAgentFilter}>×</button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
