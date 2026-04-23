import { useLayoutEffect, useRef, useState } from 'react';
import type { AgentState } from '../types/agent';
import { BUILDING_DEFS } from '../game/data/building-layout';
import './BuildingInfoPanel.css';

interface BuildingInfoPanelProps {
  buildingId: string;
  anchor: { x: number; y: number };
  agents: AgentState[];
  onClose: () => void;
}

const ANCHOR_OFFSET_X = 16;
const VIEWPORT_MARGIN = 8;

export function BuildingInfoPanel({ buildingId, anchor, agents, onClose }: BuildingInfoPanelProps) {
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Start offscreen on first paint — the layout effect below measures the
  // panel and snaps it to the clamped target. Without this the user briefly
  // sees the panel at (0, 0).
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const building = BUILDING_DEFS.find((b) => b.id === buildingId);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (el === null) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Default: place to the right of the click, vertically centered on it.
    let left = anchor.x + ANCHOR_OFFSET_X;
    let top = anchor.y - h / 2;
    // Flip to the left side if the right placement would overflow.
    if (left + w + VIEWPORT_MARGIN > vw) {
      left = anchor.x - ANCHOR_OFFSET_X - w;
    }
    // Final clamp so we never spill outside the viewport, even when flipped.
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - w - VIEWPORT_MARGIN));
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, vh - h - VIEWPORT_MARGIN));
    setPosition({ left, top });
  }, [anchor.x, anchor.y, buildingId, agentsExpanded]);

  if (building === undefined) return null;

  const agentsHere = agents.filter(
    (a) => a.currentActivity === building.activity && (a.status === 'active' || a.status === 'idle'),
  );

  const style = position === null
    ? { visibility: 'hidden' as const }
    : { left: position.left, top: position.top };

  return (
    <div ref={panelRef} className="building-info-panel" style={style}>
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
