import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityLogEntry, AgentState } from '../types/agent';
import { eventBridge } from '../game/EventBridge';
import { useFeedPrefs, type FoldState, type ViewMode } from '../hooks/useFeedPrefs';
import { ActivityFeedHeader } from './ActivityFeedHeader';
import { ActivityRow } from './ActivityRow';
import { AgentGroup } from './AgentGroup';
import {
  filterByAction, filterByAgent, groupByAgent, getAgentNameFallback,
  type ActionFilter,
} from './activityFeedUtils';
import './ActivityFeed.css';

interface ActivityFeedProps {
  log: ActivityLogEntry[];
  agents: AgentState[];
  onSelectAgent: (id: string) => void;
}

const SCROLL_PIN_THRESHOLD_PX = 8;

export function ActivityFeed({ log, agents, onSelectAgent }: ActivityFeedProps) {
  const [prefs, updatePrefs] = useFeedPrefs();
  const { foldState, viewMode, activeFilters, agentFilter } = prefs;

  const filtered = useMemo(
    () => filterByAgent(filterByAction(log, activeFilters), agentFilter),
    [log, activeFilters, agentFilter],
  );
  const groups = useMemo(
    () => viewMode === 'byAgent' ? groupByAgent(filtered) : null,
    [filtered, viewMode],
  );

  const agentLookup = useMemo(() => {
    const m = new Map<string, AgentState>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  const resolveName = useCallback(
    (agentId: string) => agentLookup.get(agentId)?.name ?? getAgentNameFallback(agentId),
    [agentLookup],
  );

  // --- Auto-scroll lock + closed-state counter ---
  const listRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);
  const [newSinceUnpin, setNewSinceUnpin] = useState(0);
  const [newWhileClosed, setNewWhileClosed] = useState(0);
  const prevLogLength = useRef(log.length);
  const isFirstRun = useRef(true);

  useEffect(() => {
    const delta = log.length - prevLogLength.current;
    // Skip first render so initial snapshot doesn't flash a fake "N new" badge.
    if (!isFirstRun.current && delta > 0) {
      if (!pinned) setNewSinceUnpin((n) => n + delta);
      if (foldState === 'closed') setNewWhileClosed((n) => n + delta);
    }
    prevLogLength.current = log.length;
    isFirstRun.current = false;

    if (pinned && listRef.current !== null) {
      listRef.current.scrollTop = 0;
    }
  }, [log, pinned, foldState]);

  // Clear the closed-state counter as soon as the user reopens the panel.
  useEffect(() => {
    if (foldState !== 'closed') setNewWhileClosed(0);
  }, [foldState]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (el === null) return;
    const atTop = el.scrollTop <= SCROLL_PIN_THRESHOLD_PX;
    setPinned(atTop);
    if (atTop) setNewSinceUnpin(0);
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = listRef.current;
    if (el !== null) el.scrollTop = 0;
    setPinned(true);
    setNewSinceUnpin(0);
  }, []);

  // --- Click handlers ---
  const handleSelectAgent = useCallback((id: string) => {
    onSelectAgent(id);
    eventBridge.emit('camera:follow', id);
  }, [onSelectAgent]);

  const handleFilterAgent = useCallback((id: string) => {
    updatePrefs({ agentFilter: id });
  }, [updatePrefs]);

  const clearAgentFilter = useCallback(() => updatePrefs({ agentFilter: null }), [updatePrefs]);

  // Header callbacks memoized for future ActivityFeedHeader memoization and to
  // stay consistent with the other handlers.
  const onFoldChange = useCallback(
    (s: FoldState) => updatePrefs({ foldState: s }),
    [updatePrefs],
  );
  const onViewModeChange = useCallback(
    (m: ViewMode) => updatePrefs({ viewMode: m }),
    [updatePrefs],
  );
  const onFiltersChange = useCallback(
    (f: ActionFilter[]) => updatePrefs({ activeFilters: f }),
    [updatePrefs],
  );

  return (
    <div className={`activity-feed fold-${foldState}`} role="log" aria-live="polite" aria-relevant="additions">
      <ActivityFeedHeader
        foldState={foldState}
        viewMode={viewMode}
        activeFilters={activeFilters}
        agentFilter={agentFilter}
        agents={agents}
        newCount={newWhileClosed}
        onFoldChange={onFoldChange}
        onViewModeChange={onViewModeChange}
        onFiltersChange={onFiltersChange}
        onClearAgentFilter={clearAgentFilter}
      />

      {foldState !== 'closed' && (
        <div className="feed-list-wrap">
          {!pinned && newSinceUnpin > 0 && (
            <button type="button" className="feed-jump-latest" onClick={jumpToLatest}>
              ↑ Jump to latest ({newSinceUnpin} new)
            </button>
          )}

          <div className="feed-list" role="list" ref={listRef} onScroll={onScroll}>
            {filtered.length === 0 ? (
              <div className="feed-empty">
                <div>Waiting for agent activity...</div>
                <div className="feed-empty-hint">Launch Claude Code in any project — it'll appear here.</div>
              </div>
            ) : viewMode === 'byAgent' && groups !== null ? (
              groups.map((g) => (
                <AgentGroup
                  key={g.agentId}
                  agentId={g.agentId}
                  agent={agentLookup.get(g.agentId)}
                  agentName={resolveName(g.agentId)}
                  entries={g.entries}
                  onSelectAgent={handleSelectAgent}
                  onFilterAgent={handleFilterAgent}
                />
              ))
            ) : (
              filtered.map((entry) => (
                <ActivityRow
                  key={`${entry.agentId}-${entry.timestamp}-${entry.action}-${entry.detail}`}
                  entry={entry}
                  agent={agentLookup.get(entry.agentId)}
                  agentName={resolveName(entry.agentId)}
                  onSelectAgent={handleSelectAgent}
                  onFilterAgent={handleFilterAgent}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
