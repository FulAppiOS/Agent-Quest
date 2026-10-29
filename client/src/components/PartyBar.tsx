import { isXcodeAgent, sourceBadgeLabel } from '../types/sessionIdentity';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HeroAvatar } from './HeroAvatar';
import { ContextMeter } from './ContextMeter';
import { buildPartyTree } from './partyTree';
import { usePartyPrefs } from '../hooks/usePartyPrefs';
import {
  HERO_LABEL_COLOR, SOURCE_BADGE_COLOR, modelBadge, displayActivity, isSubagentAgent, skillShortName,
  type AgentState, type HeroColor,
} from '../types/agent';
import './PartyBar.css';

interface PartyBarProps {
  agents: AgentState[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
  showSourceBadge: boolean;
}

const AVATAR_SIZE = 66;
const CHILD_AVATAR_SIZE = 48;
const FLASH_DURATION_MS = 400;

interface PartyRowProps {
  agent: AgentState;
  mode: 'full' | 'icons';
  isSelected: boolean;
  onClick: () => void;
  showSourceBadge: boolean;
  /** Live subagents working for this agent (parent rows only). */
  childCount?: number;
  /** Rendered nested under a parent row. */
  isChild?: boolean;
  /** Parent's label color, so the role tag reads as part of the family. */
  parentColor?: HeroColor;
}

function PartyRow({ agent, mode, isSelected, onClick, showSourceBadge, childCount = 0, isChild = false, parentColor }: PartyRowProps) {
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
    isChild ? 'partybar-agent--child' : '',
  ].filter(Boolean).join(' ');

  const role = isSubagentAgent(agent) ? (agent.subagentType ?? 'subagent') : undefined;
  const title = mode === 'icons'
    ? `${agent.name}${role !== undefined ? ` (${role})` : ''} · ${displayActivity(agent)}`
    : undefined;

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-label={`Select ${agent.name}${showSourceBadge ? ` (${agent.source})` : ''}${role !== undefined ? `, ${role} subagent` : ''}, ${displayActivity(agent)}`}
      aria-current={isSelected ? 'true' : undefined}
      title={title}
    >
      {isChild && <span className="partybar-child-connector" aria-hidden="true">└</span>}
      <span className="partybar-avatar-wrap">
        <HeroAvatar agent={agent} size={isChild ? CHILD_AVATAR_SIZE : AVATAR_SIZE} />
        <span className={`partybar-status-overlay ${agent.status}`} aria-hidden="true" />
        {mode === 'icons' && <span className="partybar-ctx-micro"><ContextMeter context={agent.context} size="micro" /></span>}
      </span>
      {mode === 'full' && (
        <span className="partybar-row-body">
          <span className="partybar-row-top">
            <span
              className="partybar-agent-name"
              style={isSelected ? undefined : { color: HERO_LABEL_COLOR[agent.heroColor] }}
            >{agent.name}</span>
            {childCount > 0 && (
              <span className="partybar-child-badge" title={`${childCount} live subagent${childCount === 1 ? '' : 's'}`}>
                {'⚑'} {childCount}
              </span>
            )}
            <span className={`partybar-dot ${agent.status}`} aria-hidden="true" />
          </span>
          {role !== undefined && (
            <span
              className="partybar-role"
              style={parentColor !== undefined ? { color: HERO_LABEL_COLOR[parentColor] } : undefined}
              title={agent.subagentType ?? 'subagent'}
            >
              {'⚔'} {role}
            </span>
          )}
          <span className="partybar-row-bottom">
            <span className={`partybar-activity status-${agent.status}`}>{displayActivity(agent)}</span>
            {agent.activeSkill !== undefined && (
              <span className="partybar-skill-chip" title={agent.activeSkill}>
                {'✦'} {skillShortName(agent.activeSkill)}
              </span>
            )}
            {(showSourceBadge || isXcodeAgent(agent)) && (
              <span
                className="partybar-source-badge"
                style={{
                  color: SOURCE_BADGE_COLOR[agent.source],
                  borderColor: `${SOURCE_BADGE_COLOR[agent.source]}80`,
                  background: `${SOURCE_BADGE_COLOR[agent.source]}14`,
                }}
                aria-label={`source ${sourceBadgeLabel(agent)} · ${agent.source}`}
              >
                {sourceBadgeLabel(agent)}
              </span>
            )}
            {(() => {
              const badge = modelBadge(agent.model);
              if (badge === null) return null;
              return (
                <span
                  className="partybar-model-badge"
                  style={{
                    color: badge.color,
                    borderColor: `${badge.color}80`,
                    background: `${badge.color}14`,
                  }}
                  aria-label={`model ${agent.model ?? ''}`}
                  title={agent.model}
                >
                  {badge.short}
                </span>
              );
            })()}
          </span>
          <ContextMeter context={agent.context} size="mini" />
        </span>
      )}
    </button>
  );
}

const LIVE_STATUSES = new Set<AgentState['status']>(['active', 'waiting', 'idle']);

export function PartyBar({ agents, selectedAgentId, onSelectAgent, showSourceBadge }: PartyBarProps) {
  const [prefs, updatePrefs] = usePartyPrefs();
  const mode: 'full' | 'icons' = prefs.foldState;
  const [showCompleted, setShowCompleted] = useState(false);

  // Live roster: active + waiting + idle. 'waiting' must be here — with sticky
  // waiting on the server a finished-turn agent stays 'waiting', and dropping it
  // would make heroes vanish from the party the moment they're done.
  const live = agents.filter((a) => LIVE_STATUSES.has(a.status));
  // Subagents nest under their (live) parent; everything else is a root.
  const tree = buildPartyTree(live);
  const activeCount = live.filter((a) => a.status === 'active').length;
  const waitingCount = live.filter((a) => a.status === 'waiting').length;
  const idleCount = live.filter((a) => a.status === 'idle').length;

  // Completed sessions, most recently finished first — shown in a collapsible
  // section so finished work stays reviewable instead of just disappearing.
  const completed = agents
    .filter((a) => a.status === 'completed')
    .sort((a, b) => b.lastEvent - a.lastEvent);

  const headerParts = [`${activeCount} active`];
  if (waitingCount > 0) headerParts.push(`${waitingCount} waiting`);
  headerParts.push(`${idleCount} idle`);

  const toggleFold = useCallback(() => {
    updatePrefs({ foldState: mode === 'full' ? 'icons' : 'full' });
  }, [mode, updatePrefs]);

  const handleClick = useCallback((id: string) => {
    onSelectAgent(id);
  }, [onSelectAgent]);

  return (
    <div className={`partybar mode-${mode}`} role="list" aria-label="Party">
      <div className="partybar-header">
        {mode === 'full' ? (
          <span className="partybar-title">Party ({headerParts.join(', ')})</span>
        ) : (
          <span className="partybar-title-compact">{live.length}</span>
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
        {tree.map((node) => (
          <div key={node.agent.id} className="partybar-group">
            <PartyRow
              agent={node.agent}
              mode={mode}
              isSelected={node.agent.id === selectedAgentId}
              onClick={() => handleClick(node.agent.id)}
              showSourceBadge={showSourceBadge}
              childCount={node.children.length}
            />
            {node.children.map((child) => (
              <PartyRow
                key={child.id}
                agent={child}
                mode={mode}
                isSelected={child.id === selectedAgentId}
                onClick={() => handleClick(child.id)}
                showSourceBadge={showSourceBadge}
                isChild
                parentColor={node.agent.heroColor}
              />
            ))}
          </div>
        ))}
      </div>

      {completed.length > 0 && (
        <div className="partybar-completed">
          <button
            type="button"
            className="partybar-completed-header"
            aria-expanded={showCompleted}
            onClick={() => setShowCompleted((v) => !v)}
            title={`${completed.length} completed session${completed.length === 1 ? '' : 's'}`}
          >
            <span className="partybar-completed-caret" aria-hidden="true">{showCompleted ? '▾' : '▸'}</span>
            {mode === 'full'
              ? <span>Completed ({completed.length})</span>
              : <span className="partybar-completed-count">{completed.length}✓</span>}
          </button>
          {showCompleted && (
            <div className="partybar-list partybar-completed-list">
              {completed.map((agent) => (
                <PartyRow
                  key={agent.id}
                  agent={agent}
                  mode={mode}
                  isSelected={agent.id === selectedAgentId}
                  onClick={() => handleClick(agent.id)}
                  showSourceBadge={showSourceBadge}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
