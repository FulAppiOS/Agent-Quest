import ReactMarkdown from 'react-markdown';
import { HERO_LABEL_COLOR, type AgentState } from '../types/agent';
import './DetailPanel.css';

interface DetailPanelProps {
  agent: AgentState;
  onClose: () => void;
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

export function DetailPanel({ agent, onClose }: DetailPanelProps) {
  return (
    <div className="detail-panel">
      <button className="detail-close" onClick={onClose}>✕</button>
      <div className="detail-header">
        <div className="detail-name" style={{ color: HERO_LABEL_COLOR[agent.heroColor] }}>{agent.name}</div>
        <div className="detail-class">{agent.heroClass} — {agent.status}</div>
      </div>
      <div className="detail-section">
        <div className="detail-section-title">Status</div>
        <div className="detail-row">
          <span className="detail-label">Activity</span>
          <span className="detail-value">{agent.currentActivity}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Session</span>
          <span className="detail-value">{formatDuration(agent.sessionStart)}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Tool Calls</span>
          <span className="detail-value">{agent.toolCalls.length}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Profile</span>
          <span className="detail-value">{profileLabel(agent.configDir)}</span>
        </div>
      </div>
      {agent.currentFile !== undefined && (
        <div className="detail-section">
          <div className="detail-section-title">Current File</div>
          <div className="detail-value" style={{ fontSize: '10px', wordBreak: 'break-all' }}>{agent.currentFile}</div>
        </div>
      )}
      {agent.currentCommand !== undefined && (
        <div className="detail-section">
          <div className="detail-section-title">Current Command</div>
          <div className="detail-value" style={{ fontSize: '10px', wordBreak: 'break-all' }}>{agent.currentCommand}</div>
        </div>
      )}
      <div className="detail-section">
        <div className="detail-section-title">Project</div>
        <div className="detail-value" style={{ fontSize: '10px', wordBreak: 'break-all' }}>{agent.cwd}</div>
      </div>
      {agent.lastMessage !== undefined && (
        <div className="detail-section">
          <div className="detail-section-title">Last Message</div>
          <div className="detail-last-message">
            <ReactMarkdown>{agent.lastMessage}</ReactMarkdown>
          </div>
        </div>
      )}
      {agent.filesModified.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">Files Modified ({agent.filesModified.length})</div>
          <ul className="detail-file-list">
            {agent.filesModified.slice(-10).map((f) => (
              <li key={f} title={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      {agent.errors.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-title">Errors ({agent.errors.length})</div>
          {agent.errors.slice(-3).map((e, i) => (
            <div key={i} className="detail-value" style={{ fontSize: '10px', color: '#8B2500', marginBottom: 4 }}>{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
