import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { HERO_LABEL_COLOR, SOURCE_BADGE_COLOR, modelBadge, type ActivityLogEntry, type AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { isError, isPath, resolvePath, categorizeEntry } from './activityFeedUtils';
import type { ActionFilter } from './activityFeedUtils';

// Message cells render detail as markdown (bold, italic, code, links). The
// custom `p` renderer emits the children followed by a trailing space so
// multiple paragraphs flow inline with a visible word-break between them —
// no extra vertical space, no paragraphs glued together ("fooBar").
const MD_COMPONENTS = {
  p: ({ children }: { children?: ReactNode }) => <>{children}{' '}</>,
};

interface ActivityRowProps {
  entry: ActivityLogEntry;
  agent: AgentState | undefined;
  agentName: string;
  /** When true, hides the avatar+name (used inside AgentGroup). */
  inGroup?: boolean;
  highlighted: boolean;
  isSelected: boolean;
  showSourceBadge?: boolean;
  onSelectAgent: (id: string) => void;
  onFilterAgent: (id: string) => void;
}

interface MenuState {
  x: number;
  y: number;
}

function ActivityRowImpl({
  entry, agent, agentName, inGroup, highlighted, isSelected, showSourceBadge,
  onSelectAgent, onFilterAgent,
}: ActivityRowProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const error = isError(entry.action, entry.detail);
  const isMessage = entry.action === 'Reply' || entry.action === 'Prompt';
  const detailIsPath = !isMessage && isPath(entry.detail);
  const absolute = detailIsPath ? resolvePath(entry.detail, agent?.cwd) : null;
  const pillVariant = entry.action === 'Reply' ? 'is-reply' : entry.action === 'Prompt' ? 'is-prompt' : '';
  const category: ActionFilter = categorizeEntry(entry.action, entry.detail);
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

  const rowClasses = [
    'feed-entry',
    error ? 'is-error' : '',
    isMessage ? 'is-message' : '',
    highlighted ? `is-highlighted hl-${category}` : '',
    isSelected ? 'is-selected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rowClasses} onContextMenu={onContextMenu} role="listitem">
      {!inGroup && agent !== undefined && (
        <button
          type="button"
          className="feed-row-avatar"
          aria-label={`Select agent ${agentName}`}
          onClick={() => onSelectAgent(agent.id)}
        >
          <HeroAvatar agent={agent} size="inherit" />
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
              style={{ color: HERO_LABEL_COLOR[agent.heroColor] }}
            >{agentName}</button>
          )}
          <span className={`feed-action-pill ${error ? 'is-error' : ''} ${pillVariant}`}>{entry.action}</span>
          {showSourceBadge === true && !inGroup && agent !== undefined && (
            <span
              className="feed-source-badge"
              style={{
                color: SOURCE_BADGE_COLOR[agent.source],
                background: `${SOURCE_BADGE_COLOR[agent.source]}26`,
              }}
              aria-label={`source ${agent.source}`}
            >
              {agent.source.toUpperCase()}
            </span>
          )}
          {!inGroup && agent !== undefined && (() => {
            const badge = modelBadge(agent.model);
            if (badge === null) return null;
            return (
              <span
                className="feed-model-badge"
                style={{
                  color: badge.color,
                  background: `${badge.color}26`,
                }}
                aria-label={`model ${agent.model ?? ''}`}
                title={agent.model}
              >
                {badge.short}
              </span>
            );
          })()}
          <span className="feed-time">{time}</span>
        </div>
        {isMessage ? (
          <div className={`feed-detail is-message ${pillVariant}`}>
            <ReactMarkdown components={MD_COMPONENTS}>{entry.detail}</ReactMarkdown>
          </div>
        ) : detailIsPath && absolute !== null ? (
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
// comparator. They are passed as fresh inline closures per render by the
// parent (ActivityFeed / AgentGroup) — each closure captures only
// row-deterministic data (`entryKey`, `agentId`), so a skipped re-render
// keeps a closure that still targets the correct row. The comparator
// trades closure identity for predictable, stable row behavior.
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
  prev.agent?.source  === next.agent?.source  &&
  prev.agent?.model   === next.agent?.model   &&
  prev.inGroup        === next.inGroup        &&
  prev.highlighted    === next.highlighted    &&
  prev.isSelected     === next.isSelected     &&
  prev.showSourceBadge === next.showSourceBadge
);
