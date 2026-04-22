import type { ActivityLogEntry, AgentState } from '../types/agent';
import './ActivityFeed.css';

const ACTION_ICONS: Record<string, string> = {
  Read: '/assets/ui/icons/icon_11.png',
  Grep: '/assets/ui/icons/icon_11.png',
  Glob: '/assets/ui/icons/icon_11.png',
  Edit: '/assets/ui/icons/icon_10.png',
  Write: '/assets/ui/icons/icon_10.png',
  Bash: '/assets/ui/icons/icon_05.png',
  Agent: '/assets/ui/icons/icon_06.png',
};

interface ActivityFeedProps {
  log: ActivityLogEntry[];
  agents: AgentState[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getAgentName(agents: AgentState[], agentId: string): string {
  const found = agents.find((a) => a.id === agentId);
  if (found !== undefined) return found.name;
  // Race: a log entry can arrive before the agent:new snapshot lands. Derive a
  // readable fallback from the id so we don't show "agent-aside_" (truncated).
  if (agentId.startsWith('agent-')) {
    const rest = agentId.slice('agent-'.length);
    const m = rest.match(/^(.*?)-([a-f0-9]{16,})$/);
    if (m !== null && m[1] !== undefined && m[1].length > 0) return m[1];
    return rest.slice(0, 12);
  }
  return agentId.slice(0, 8);
}

export function ActivityFeed({ log, agents }: ActivityFeedProps) {
  return (
    <div className="activity-feed">
      <div className="activity-feed-title">Activity Feed</div>
      <div className="activity-feed-list">
        {log.map((entry, i) => (
          <div key={`${entry.timestamp}-${i}`} className="feed-entry">
            <span className="feed-time">{formatTime(entry.timestamp)}</span>
            <span className="feed-agent">{getAgentName(agents, entry.agentId)}</span>
            {ACTION_ICONS[entry.action] && (
              <img src={ACTION_ICONS[entry.action]} className="feed-icon" alt="" />
            )}
            <span className="feed-action">{entry.action}</span>
            <span className="feed-detail" title={entry.detail}>{entry.detail}</span>
          </div>
        ))}
        {log.length === 0 && (
          <div className="feed-entry">
            <span className="feed-detail" style={{ color: '#666' }}>Waiting for agent activity...</span>
          </div>
        )}
      </div>
    </div>
  );
}
