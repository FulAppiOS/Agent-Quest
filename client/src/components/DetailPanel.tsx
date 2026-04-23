import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { HERO_LABEL_COLOR, SOURCE_BADGE_COLOR, type AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { isPath, resolvePath } from './activityFeedUtils';
import './DetailPanel.css';

interface DetailPanelProps {
  agent: AgentState;
  onClose: () => void;
  showSourceBadge: boolean;
}

function formatDuration(startMs: number): string {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${mins}m ${secs}s`;
}

function profileLabel(configDir: string): string {
  if (configDir === '') return 'default';
  const base = configDir.split('/').pop() ?? configDir;
  if (base === '.claude') return 'default';
  return base.replace(/^\.claude-?/, '') || base;
}

function PathValue({ path, cwd, className }: { path: string; cwd: string; className?: string }) {
  if (!isPath(path)) {
    return <span className={className}>{path}</span>;
  }
  const absolute = resolvePath(path, cwd);
  if (absolute === null) {
    return <span className={className}>{path}</span>;
  }
  return (
    <a
      href={`vscode://file${encodeURI(absolute)}`}
      className={`${className ?? ''} detail-path-link`}
      title={absolute}
    >{path}</a>
  );
}

export function DetailPanel({ agent, onClose, showSourceBadge }: DetailPanelProps) {
  // Tick every second so duration-derived values refresh between server pushes.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const isLive = agent.status === 'active' || agent.status === 'waiting';
  const currentFile = isLive ? agent.currentFile : undefined;
  const currentCommand = isLive ? agent.currentCommand : undefined;
  const lastMessage = isLive ? agent.lastMessage : undefined;

  return (
    <div className="detail-panel">
      <div className="detail-topbar">
        <span className="detail-avatar-wrap">
          <HeroAvatar agent={agent} size={44} />
          <span className={`detail-status-overlay ${agent.status}`} aria-hidden="true" />
        </span>
        <div className="detail-topbar-body">
          <div className="detail-name-row">
            <span className="detail-name" style={{ color: HERO_LABEL_COLOR[agent.heroColor] }}>{agent.name}</span>
            {showSourceBadge && (
              <span
                className="detail-source-badge"
                style={{
                  color: SOURCE_BADGE_COLOR[agent.source],
                  borderColor: `${SOURCE_BADGE_COLOR[agent.source]}80`,
                  background: `${SOURCE_BADGE_COLOR[agent.source]}14`,
                }}
                aria-label={`source ${agent.source}`}
              >
                {agent.source.toUpperCase()}
              </span>
            )}
          </div>
          <div className="detail-class">{agent.heroClass}</div>
        </div>
        <button className="detail-close" onClick={onClose} aria-label="Close panel">✕</button>
      </div>

      <div className="detail-body">
        <div className="detail-section">
          <div className="detail-section-title">Status</div>
          <div className="detail-row">
            <span className="detail-label">Activity</span>
            <span className="detail-value">{agent.currentActivity}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Session</span>
            <span className="detail-value detail-value--num">{formatDuration(agent.sessionStart)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Tool Calls</span>
            <span className="detail-value detail-value--num">{agent.toolCalls.length}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Profile</span>
            <span className="detail-value">{profileLabel(agent.configDir)}</span>
          </div>
        </div>

        {currentFile !== undefined && (
          <div className="detail-section">
            <div className="detail-section-title">Current File</div>
            <PathValue path={currentFile} cwd={agent.cwd} className="detail-value detail-value--path" />
          </div>
        )}

        {currentCommand !== undefined && (
          <div className="detail-section">
            <div className="detail-section-title">Current Command</div>
            <div className="detail-value detail-value--path">{currentCommand}</div>
          </div>
        )}

        <div className="detail-section">
          <div className="detail-section-title">Project</div>
          <PathValue path={agent.cwd} cwd={agent.cwd} className="detail-value detail-value--path" />
        </div>

        {lastMessage !== undefined && (
          <div className="detail-section">
            <div className="detail-section-title">Last Message</div>
            <div className="detail-last-message">
              <ReactMarkdown>{lastMessage}</ReactMarkdown>
            </div>
          </div>
        )}

        {agent.filesModified.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title">Files Modified ({agent.filesModified.length})</div>
            <ul className="detail-file-list">
              {agent.filesModified.slice(-10).map((f) => (
                <li key={f} title={f}>
                  <PathValue path={f} cwd={agent.cwd} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {agent.errors.length > 0 && (
          <div className="detail-section detail-section--errors">
            <div className="detail-section-title">Errors ({agent.errors.length})</div>
            {agent.errors.slice(-3).map((e, i) => (
              <div key={i} className="detail-value detail-value--error">{e}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
