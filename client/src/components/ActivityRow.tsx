import { memo, useCallback, useEffect, useState } from 'react';
import type { ActivityLogEntry, AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { isError, isPath, resolvePath } from './activityFeedUtils';

interface ActivityRowProps {
  entry: ActivityLogEntry;
  agent: AgentState | undefined;
  agentName: string;
  /** When true, hides the avatar+name (used inside AgentGroup). */
  inGroup?: boolean;
  onSelectAgent: (id: string) => void;
  onFilterAgent: (id: string) => void;
}

interface MenuState {
  x: number;
  y: number;
}

function ActivityRowImpl({ entry, agent, agentName, inGroup, onSelectAgent, onFilterAgent }: ActivityRowProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const error = isError(entry.action, entry.detail);
  const detailIsPath = isPath(entry.detail);
  const absolute = detailIsPath ? resolvePath(entry.detail, agent?.cwd) : null;
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).catch(() => { /* permissions; ignore */ });
    closeMenu();
  }, [closeMenu]);

  return (
    <div className={`feed-entry ${error ? 'is-error' : ''}`} onContextMenu={onContextMenu} role="listitem">
      {!inGroup && agent !== undefined && (
        <button
          type="button"
          className="feed-row-avatar"
          aria-label={`Select agent ${agentName}`}
          onClick={() => onSelectAgent(agent.id)}
        >
          <HeroAvatar agent={agent} />
        </button>
      )}

      <div className="feed-row-body">
        <div className="feed-row-meta">
          {!inGroup && agent !== undefined && (
            <button
              type="button"
              className="feed-agent-name"
              aria-label={`Filter feed to ${agentName}`}
              onClick={() => onFilterAgent(agent.id)}
              title={agentName}
            >{agentName}</button>
          )}
          <span className={`feed-action-pill ${error ? 'is-error' : ''}`}>{entry.action}</span>
          <span className="feed-time">{time}</span>
        </div>
        {detailIsPath && absolute !== null ? (
          <a
            href={`vscode://file${encodeURI(absolute)}`}
            className="feed-detail is-path"
            title={entry.detail}
          >{entry.detail}</a>
        ) : (
          <span className={`feed-detail ${detailIsPath ? 'is-path-unresolved' : ''}`} title={entry.detail}>
            {entry.detail}
          </span>
        )}
      </div>

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          actions={[
            { label: 'Copy path', onClick: () => copy(absolute ?? entry.detail), enabled: detailIsPath },
            { label: 'Copy detail', onClick: () => copy(entry.detail), enabled: true },
            { label: 'Filter to this agent', onClick: () => { if (agent !== undefined) onFilterAgent(agent.id); closeMenu(); }, enabled: agent !== undefined },
          ]}
        />
      )}
    </div>
  );
}

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  actions: { label: string; onClick: () => void; enabled: boolean }[];
}

function ContextMenu({ x, y, onClose, actions }: ContextMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="feed-menu-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <ul className="feed-menu" style={{ left: x, top: y }} role="menu">
        {actions.filter((a) => a.enabled).map((a) => (
          <li key={a.label} role="menuitem">
            <button type="button" onClick={a.onClick}>{a.label}</button>
          </li>
        ))}
      </ul>
    </>
  );
}

// Callbacks (onSelectAgent, onFilterAgent) intentionally omitted from the
// comparator — the parent must memoize them (useCallback) so their identity
// stays stable across renders, otherwise stale closures can fire.
export const ActivityRow = memo(ActivityRowImpl, (prev, next) =>
  prev.entry.timestamp === next.entry.timestamp &&
  prev.entry.agentId  === next.entry.agentId  &&
  prev.entry.action   === next.entry.action   &&
  prev.entry.detail   === next.entry.detail   &&
  prev.agentName      === next.agentName      &&
  prev.agent?.id      === next.agent?.id      &&
  prev.agent?.cwd     === next.agent?.cwd     &&
  prev.agent?.heroClass === next.agent?.heroClass &&
  prev.agent?.heroColor === next.agent?.heroColor &&
  prev.inGroup        === next.inGroup
);
