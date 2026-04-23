import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityLogEntry, AgentState } from '../types/agent';
import { eventBridge } from '../game/EventBridge';
import { useFeedPrefs } from '../hooks/useFeedPrefs';
import { ActivityFeedHeader } from './ActivityFeedHeader';
import { ActivityRow } from './ActivityRow';
import { AgentGroup } from './AgentGroup';
import {
  filterByAction, filterByAgent, groupByAgent, getAgentNameFallback,
} from './activityFeedUtils';
import './ActivityFeed.css';

interface ActivityFeedProps {
  log: ActivityLogEntry[];
  agents: AgentState[];
  selectedAgentId: string | null;
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

  // --- Auto-scroll lock ---
  const listRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);
  const [newSinceUnpin, setNewSinceUnpin] = useState(0);
  const prevLogLength = useRef(log.length);

  useEffect(() => {
    if (log.length > prevLogLength.current && !pinned) {
      setNewSinceUnpin((n) => n + (log.length - prevLogLength.current));
    }
    prevLogLength.current = log.length;
    if (pinned && listRef.current !== null) {
      listRef.current.scrollTop = 0;
    }
  }, [log, pinned]);

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

  // --- New badge counter (when closed) ---
  const [newWhileClosed, setNewWhileClosed] = useState(0);
  useEffect(() => {
    if (foldState === 'closed' && log.length > prevLogLength.current) {
      setNewWhileClosed((n) => n + (log.length - prevLogLength.current));
    } else if (foldState !== 'closed') {
      setNewWhileClosed(0);
    }
  }, [log, foldState]);

  // --- Click handlers ---
  const handleSelectAgent = useCallback((id: string) => {
    onSelectAgent(id);
    eventBridge.emit('camera:follow', id);
  }, [onSelectAgent]);

  const handleFilterAgent = useCallback((id: string) => {
    updatePrefs({ agentFilter: id });
  }, [updatePrefs]);

  const clearAgentFilter = useCallback(() => updatePrefs({ agentFilter: null }), [updatePrefs]);

  return (
    <div className={`activity-feed fold-${foldState}`} role="log" aria-live="polite" aria-relevant="additions">
      <ActivityFeedHeader
        foldState={foldState}
        viewMode={viewMode}
        activeFilters={activeFilters}
        agentFilter={agentFilter}
        agents={agents}
        newCount={newWhileClosed}
        onFoldChange={(s) => updatePrefs({ foldState: s })}
        onViewModeChange={(m) => updatePrefs({ viewMode: m })}
        onFiltersChange={(f) => updatePrefs({ activeFilters: f })}
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
