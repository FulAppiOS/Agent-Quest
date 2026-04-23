import type { FoldState, ViewMode } from '../hooks/useFeedPrefs';
import type { ActionFilter } from './activityFeedUtils';
import type { AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';

interface ActivityFeedHeaderProps {
  foldState: FoldState;
  viewMode: ViewMode;
  activeFilters: ActionFilter[];
  agentFilter: string | null;
  agents: AgentState[];
  newCount: number;
  onFoldChange: (state: FoldState) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onFiltersChange: (filters: ActionFilter[]) => void;
  onClearAgentFilter: () => void;
}

const ALL_FILTERS: { id: ActionFilter; label: string }[] = [
  { id: 'errors', label: 'Errors' },
  { id: 'edits',  label: 'Edits'  },
  { id: 'bash',   label: 'Bash'   },
  { id: 'reads',  label: 'Reads'  },
];

export function ActivityFeedHeader({
  foldState, viewMode, activeFilters, agentFilter, agents, newCount,
  onFoldChange, onViewModeChange, onFiltersChange, onClearAgentFilter,
}: ActivityFeedHeaderProps) {
  const filteredAgent = agentFilter !== null ? agents.find((a) => a.id === agentFilter) ?? null : null;

  function toggleFilter(id: ActionFilter) {
    if (activeFilters.includes(id)) {
      onFiltersChange(activeFilters.filter((f) => f !== id));
    } else {
      onFiltersChange([...activeFilters, id]);
    }
  }

  const showSecondRow = foldState === 'full';

  return (
    <div className="feed-header">
      <div className="feed-header-row">
        <span className="feed-title">
          Activity Feed
          {foldState === 'closed' && newCount > 0 && (
            <span className="feed-new-badge" aria-live="polite">{newCount} new</span>
          )}
        </span>

        {foldState !== 'closed' && (
          <div className="feed-tabs" role="tablist" aria-label="Feed view mode">
            <button
              role="tab"
              aria-selected={viewMode === 'all'}
              className={`feed-tab ${viewMode === 'all' ? 'active' : ''}`}
              onClick={() => onViewModeChange('all')}
            >All</button>
            <button
              role="tab"
              aria-selected={viewMode === 'byAgent'}
              className={`feed-tab ${viewMode === 'byAgent' ? 'active' : ''}`}
              onClick={() => onViewModeChange('byAgent')}
            >By Agent</button>
          </div>
        )}

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

      {showSecondRow && (
        <div className="feed-header-row feed-filter-row">
          {ALL_FILTERS.map(({ id, label }) => (
            <button
              type="button"
              key={id}
              aria-pressed={activeFilters.includes(id)}
              className={`feed-pill ${id} ${activeFilters.includes(id) ? 'on' : ''}`}
              onClick={() => toggleFilter(id)}
            >{label}</button>
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
