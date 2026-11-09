import type { FoldState } from '../hooks/useFeedPrefs';
import type { ActionFilter } from './activityFeedUtils';
import type { AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { useI18n } from '../i18n';

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

// Labels live in i18n under `activityFeed.pill.<id>`.
const PILL_ORDER: ActionFilter[] = ['messages', 'errors', 'edits', 'bash', 'reads', 'agent', 'skills', 'other'];

export function ActivityFeedHeader({
  foldState, activeHighlights, availableCategories, categoryCounts,
  agentFilter, agents, newCount,
  onFoldChange, onHighlightsChange, onClearAgentFilter,
}: ActivityFeedHeaderProps) {
  const { t } = useI18n();
  const filteredAgent = agentFilter !== null ? agents.find((a) => a.id === agentFilter) ?? null : null;

  function toggleHighlight(id: ActionFilter) {
    if (activeHighlights.includes(id)) {
      onHighlightsChange(activeHighlights.filter((f) => f !== id));
    } else {
      onHighlightsChange([...activeHighlights, id]);
    }
  }

  const showSecondRow = foldState === 'full';
  const pills = PILL_ORDER.filter((id) => availableCategories.has(id));
  const hasChip = filteredAgent !== null;
  const secondRowHasContent = pills.length > 0 || hasChip;

  return (
    <div className="feed-header">
      <div className="feed-header-row">
        <span className="feed-title">
          {t('activityFeed.title')}
          {foldState === 'closed' && newCount > 0 && (
            <span className="feed-new-badge" aria-live="polite">{t('activityFeed.newBadge', { count: newCount })}</span>
          )}
        </span>

        <span className="feed-spacer" />

        <div className="feed-fold-buttons">
          <button
            type="button"
            aria-label={t('activityFeed.foldFull')}
            aria-pressed={foldState === 'full'}
            className={`feed-fold-btn ${foldState === 'full' ? 'active' : ''}`}
            onClick={() => onFoldChange('full')}
          >▭</button>
          <button
            type="button"
            aria-label={t('activityFeed.foldCompact')}
            aria-pressed={foldState === 'compact'}
            className={`feed-fold-btn ${foldState === 'compact' ? 'active' : ''}`}
            onClick={() => onFoldChange('compact')}
          >▬</button>
          <button
            type="button"
            aria-label={t('common.close')}
            aria-pressed={foldState === 'closed'}
            className={`feed-fold-btn ${foldState === 'closed' ? 'active' : ''}`}
            onClick={() => onFoldChange('closed')}
          >▼</button>
        </div>
      </div>

      {showSecondRow && secondRowHasContent && (
        <div className="feed-header-row feed-filter-row">
          {pills.map((id) => (
            <button
              type="button"
              key={id}
              aria-pressed={activeHighlights.includes(id)}
              className={`feed-pill ${id} ${activeHighlights.includes(id) ? 'on' : ''}`}
              onClick={() => toggleHighlight(id)}
            >{t(`activityFeed.pill.${id}`)} ({categoryCounts[id]})</button>
          ))}
          {filteredAgent !== null && (
            <span className="feed-agent-chip">
              <HeroAvatar agent={filteredAgent} size={14} />
              <span>{filteredAgent.name}</span>
              <button type="button" aria-label={t('activityFeed.clearAgentFilter')} className="feed-chip-close" onClick={onClearAgentFilter}>×</button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
