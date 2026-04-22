import { useRef, useEffect } from 'react';
import type { AgentState } from '../types/agent';
import { BUILDING_DEFS, VILLAGE_GATE } from '../game/data/building-layout';
import './Minimap.css';

interface MinimapProps {
  agents: AgentState[];
}

const GAME_W = 1600;
const GAME_H = 900;

const HERO_COLOR_HEX: Record<string, string> = {
  blue:   '#4488FF',
  yellow: '#FFDD44',
  red:    '#FF4444',
  black:  '#333333',
  purple: '#8844FF',
};

const BUILDING_COLORS: Record<string, string> = {
  library: '#4A6FA5', forge: '#D4760A', castle: '#7B2D8B',
  arena: '#8B0000', tavern: '#8B7355', chapel: '#FFD700',
  alchemist: '#2E8B57', watchtower: '#4682B4',
};

const BUILDING_SIZE = 60;

export function Minimap({ agents }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const w = canvas.width;
    const h = canvas.height;
    const sx = w / GAME_W;
    const sy = h / GAME_H;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    for (const b of BUILDING_DEFS) {
      ctx.fillStyle = BUILDING_COLORS[b.id] ?? '#888888';
      ctx.globalAlpha = 0.6;
      ctx.fillRect((b.x - BUILDING_SIZE / 2) * sx, (b.y - BUILDING_SIZE / 2) * sy, BUILDING_SIZE * sx, BUILDING_SIZE * sy);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#C4A35A';
    ctx.lineWidth = 1;
    ctx.strokeRect((VILLAGE_GATE.x - 15) * sx, (VILLAGE_GATE.y - 8) * sy, 30 * sx, 16 * sy);

    const visible = agents.filter((a) => a.status === 'active' || a.status === 'idle');
    for (const agent of visible) {
      const building = BUILDING_DEFS.find((b) => b.activity === agent.currentActivity);
      if (building === undefined) continue;
      const ax = building.x * sx;
      const ay = (building.y + BUILDING_SIZE / 2 + 10) * sy;
      ctx.fillStyle = HERO_COLOR_HEX[agent.heroColor] ?? '#FFFFFF';
      ctx.beginPath();
      ctx.arc(ax, ay, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [agents]);

  return (
    <div className="minimap">
      <div className="minimap-title">Map</div>
      <canvas ref={canvasRef} className="minimap-canvas" width={180} height={120} />
    </div>
  );
}
