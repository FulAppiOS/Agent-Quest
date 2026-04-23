import { useCallback, useEffect, useRef, useState } from 'react';
import { HeroAvatar } from './HeroAvatar';
import { usePartyPrefs } from '../hooks/usePartyPrefs';
import { eventBridge } from '../game/EventBridge';
import type { AgentState } from '../types/agent';
import './PartyBar.css';

interface PartyBarProps {
  agents: AgentState[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
}

const AVATAR_SIZE = 40;
const FLASH_DURATION_MS = 400;

const STATUS_ORDER: Record<AgentState['status'], number> = {
  active: 0,
  waiting: 1,
  idle: 2,
  error: 3,
  completed: 4,
};

interface PartyRowProps {
  agent: AgentState;
  mode: 'full' | 'icons';
  isSelected: boolean;
  onClick: () => void;
}

function PartyRow({ agent, mode, isSelected, onClick }: PartyRowProps) {
  const [flashing, setFlashing] = useState(false);
  const prevSelected = useRef(isSelected);

  useEffect(() => {
    if (!prevSelected.current && isSelected) {
      setFlashing(true);
      const id = setTimeout(() => setFlashing(false), FLASH_DURATION_MS);
      prevSelected.current = isSelected;
      return () => clearTimeout(id);
    }
    prevSelected.current = isSelected;
  }, [isSelected]);

  const classes = [
    'partybar-agent',
    `mode-${mode}`,
    isSelected ? 'selected' : '',
    flashing ? 'flashing' : '',
  ].filter(Boolean).join(' ');

  const title = mode === 'icons'
    ? `${agent.name} · ${agent.currentActivity}`
    : undefined;

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-label={`Select ${agent.name}, ${agent.currentActivity}`}
      aria-current={isSelected ? 'true' : undefined}
      title={title}
    >
      <span className="partybar-avatar-wrap">
        <HeroAvatar agent={agent} size={AVATAR_SIZE} />
        <span className={`partybar-status-overlay ${agent.status}`} aria-hidden="true" />
      </span>
      {mode === 'full' && (
        <span className="partybar-row-body">
          <span className="partybar-row-top">
            <span className="partybar-agent-name">{agent.name}</span>
            <span className={`partybar-dot ${agent.status}`} aria-hidden="true" />
          </span>
          <span className="partybar-activity">{agent.currentActivity}</span>
        </span>
      )}
    </button>
  );
}

export function PartyBar({ agents, selectedAgentId, onSelectAgent }: PartyBarProps) {
  const [prefs, updatePrefs] = usePartyPrefs();
  const mode: 'full' | 'icons' = prefs.foldState;

  const visible = agents.filter((a) => a.status === 'active' || a.status === 'idle');
  const sorted = [...visible].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const activeCount = visible.filter((a) => a.status === 'active').length;
  const idleCount = visible.filter((a) => a.status === 'idle').length;

  const toggleFold = useCallback(() => {
    updatePrefs({ foldState: mode === 'full' ? 'icons' : 'full' });
  }, [mode, updatePrefs]);

  const handleClick = useCallback((id: string) => {
    onSelectAgent(id);
    eventBridge.emit('camera:follow', id);
  }, [onSelectAgent]);

  return (
    <div className={`partybar mode-${mode}`} role="list" aria-label="Party">
      <div className="partybar-header">
        {mode === 'full' ? (
          <span className="partybar-title">Party ({activeCount} active, {idleCount} idle)</span>
        ) : (
          <span className="partybar-title-compact">{activeCount + idleCount}</span>
        )}
        <button
          type="button"
          className="partybar-fold-btn"
          aria-label={mode === 'full' ? 'Collapse to icons' : 'Expand party'}
          aria-pressed={mode === 'icons'}
          onClick={toggleFold}
        >{mode === 'full' ? '◀' : '▶'}</button>
      </div>

      <div className="partybar-list">
        {sorted.map((agent) => (
          <PartyRow
            key={agent.id}
            agent={agent}
            mode={mode}
            isSelected={agent.id === selectedAgentId}
            onClick={() => handleClick(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}
