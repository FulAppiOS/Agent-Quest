import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityLogEntry, AgentState } from '../types/agent';
import { useFeedPrefs, type FoldState, type ViewMode } from '../hooks/useFeedPrefs';
import { ActivityFeedHeader } from './ActivityFeedHeader';
import { ActivityRow } from './ActivityRow';
import { AgentGroup } from './AgentGroup';
import {
  filterByAgent, groupByAgent, getAgentNameFallback, categorizeEntry, detectCategories,
  type ActionFilter,
} from './activityFeedUtils';
import './ActivityFeed.css';

interface ActivityFeedProps {
  log: ActivityLogEntry[];
  agents: AgentState[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
}

const SCROLL_PIN_THRESHOLD_PX = 8;

export function ActivityFeed({ log, agents, selectedAgentId, onSelectAgent }: ActivityFeedProps) {
  const [prefs, updatePrefs] = useFeedPrefs();
  const { foldState, viewMode, activeHighlights, agentFilter } = prefs;

  // Identifies the single log row the user touched in the feed. Unlike
  // `selectedAgentId`, this is feed-local — it pulses exactly ONE row, not
  // every row of the same agent. Cleared when selection moves elsewhere
  // (party bar, hero sprite, deselect): we detect that by checking the key's
  // embedded agentId prefix no longer matches `selectedAgentId`.
  const [selectedEntryKey, setSelectedEntryKey] = useState<string | null>(null);
  useEffect(() => {
    if (selectedEntryKey === null) return;
    if (selectedAgentId === null || !selectedEntryKey.startsWith(`${selectedAgentId}-`)) {
      setSelectedEntryKey(null);
    }
  }, [selectedAgentId, selectedEntryKey]);

  // The agent-filter chip still hides rows (explicit user filter on one agent).
  // The action highlights do NOT hide anything; they only tint matching rows.
  const filtered = useMemo(
    () => filterByAgent(log, agentFilter),
    [log, agentFilter],
  );

  const { categories: availableCategories, counts: categoryCounts } = useMemo(
    () => detectCategories(filtered),
    [filtered],
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

  useEffect(() => {
    if (foldState !== 'closed') setNewWhileClosed(0);
  }, [foldState]);

  // Track the last non-closed fold state so the Close button can toggle
  // back to it (full ↔ closed or compact ↔ closed) instead of requiring
  // the user to re-pick the expanded state manually.
  const previousFoldRef = useRef<FoldState>(foldState === 'closed' ? 'full' : foldState);
  useEffect(() => {
    if (foldState !== 'closed') previousFoldRef.current = foldState;
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

  const handleSelectAgent = useCallback((id: string) => {
    onSelectAgent(id);
  }, [onSelectAgent]);

  const handleFilterAgent = useCallback((id: string) => {
    updatePrefs({ agentFilter: id });
  }, [updatePrefs]);

  const clearAgentFilter = useCallback(() => updatePrefs({ agentFilter: null }), [updatePrefs]);

  const onFoldChange = useCallback(
    (s: FoldState) => {
      // Close button is a toggle: if already closed, restore the previous
      // non-closed state. Otherwise apply as-is.
      if (s === 'closed' && foldState === 'closed') {
        updatePrefs({ foldState: previousFoldRef.current });
      } else {
        updatePrefs({ foldState: s });
      }
    },
    [foldState, updatePrefs],
  );
  const onViewModeChange = useCallback(
    (m: ViewMode) => updatePrefs({ viewMode: m }),
    [updatePrefs],
  );
  const onHighlightsChange = useCallback(
    (h: ActionFilter[]) => updatePrefs({ activeHighlights: h }),
    [updatePrefs],
  );

  const shouldHighlight = (entry: ActivityLogEntry): boolean => {
    if (activeHighlights.length === 0) return false;
    return activeHighlights.includes(categorizeEntry(entry.action, entry.detail));
  };

  return (
    <div className={`activity-feed fold-${foldState}`} role="log" aria-live="polite" aria-relevant="additions">
      <ActivityFeedHeader
        foldState={foldState}
        viewMode={viewMode}
        activeHighlights={activeHighlights}
        availableCategories={availableCategories}
        categoryCounts={categoryCounts}
        agentFilter={agentFilter}
        agents={agents}
        newCount={newWhileClosed}
        onFoldChange={onFoldChange}
        onViewModeChange={onViewModeChange}
        onHighlightsChange={onHighlightsChange}
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
                  activeHighlights={activeHighlights}
                  selectedEntryKey={selectedEntryKey}
                  onSelectAgent={handleSelectAgent}
                  onSelectEntry={setSelectedEntryKey}
                  onFilterAgent={handleFilterAgent}
                />
              ))
            ) : (
              filtered.map((entry) => {
                const entryKey = `${entry.agentId}-${entry.timestamp}-${entry.action}-${entry.detail}`;
                return (
                  <ActivityRow
                    key={entryKey}
                    entry={entry}
                    agent={agentLookup.get(entry.agentId)}
                    agentName={resolveName(entry.agentId)}
                    highlighted={shouldHighlight(entry)}
                    isSelected={entryKey === selectedEntryKey}
                    onSelectAgent={(id) => {
                      setSelectedEntryKey(entryKey);
                      handleSelectAgent(id);
                    }}
                    onFilterAgent={handleFilterAgent}
                  />
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
