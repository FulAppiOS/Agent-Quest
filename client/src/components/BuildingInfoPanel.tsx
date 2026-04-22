import { useState } from 'react';
import type { AgentState } from '../types/agent';
import { BUILDING_DEFS } from '../game/data/building-layout';
import './BuildingInfoPanel.css';

interface BuildingInfoPanelProps {
  buildingId: string;
  agents: AgentState[];
  onClose: () => void;
}

export function BuildingInfoPanel({ buildingId, agents, onClose }: BuildingInfoPanelProps) {
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const building = BUILDING_DEFS.find((b) => b.id === buildingId);
  if (building === undefined) return null;

  const agentsHere = agents.filter(
    (a) => a.currentActivity === building.activity && (a.status === 'active' || a.status === 'idle'),
  );

  return (
    <div className="building-info-panel">
      <button className="building-info-close" onClick={onClose}>&#x2715;</button>

      <div className="building-info-header">
        <div className="building-info-name">{building.label}</div>
        <div className="building-info-activity">{building.activity}</div>
      </div>

      <div className="building-info-section">
        <div className="building-info-desc">{building.description}</div>
      </div>

      <div className="building-info-section">
        <div className="building-info-section-title">Triggers</div>
        <div className="building-info-tools">
          {building.toolCalls.map((tc) => (
            <span key={tc} className="building-info-tool-tag">{tc}</span>
          ))}
        </div>
      </div>

      <div className="building-info-section">
        <button
          className="building-info-agents-toggle"
          onClick={() => setAgentsExpanded((prev) => !prev)}
        >
          <span className={`building-info-chevron ${agentsExpanded ? 'expanded' : ''}`}>&#x25B6;</span>
          <span>Agents Here ({agentsHere.length})</span>
        </button>
        {agentsExpanded && (
          agentsHere.length === 0 ? (
            <div className="building-info-empty">No agents currently here</div>
          ) : (
            <div className="building-info-agents">
              {agentsHere.map((a) => (
                <div key={a.id} className="building-info-agent">
                  <span className="building-info-agent-dot" />
                  <span className="building-info-agent-name">{a.name}</span>
                  <span className="building-info-agent-class">{a.heroClass}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
