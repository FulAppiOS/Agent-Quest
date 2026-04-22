# Phase 4 — React Overlay Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 5 React overlay panels (Party Bar, Activity Feed, Top Bar, Detail Panel, Minimap) styled with a dark fantasy MMO aesthetic, showing real-time agent data over the Phaser canvas.

**Architecture:** Each panel is a React component positioned absolutely over the canvas via CSS. They consume data from the existing `useAgentState` hook. A new `useSelectedAgent` hook tracks which agent is selected (click in Party Bar). All panels share the fantasy color palette from the spec (gold, parchment, dark stone). The overlay div already exists in App.tsx — panels mount inside it.

**Tech Stack:** React 19 functional components, CSS modules (one file per component), Google Fonts (Cinzel for titles, monospace for data).

---

## Panel Layout (overlay on 1280x720 canvas)

```
┌──────────────────────────────────────────────────────┐
│ [TopBar - full width, 40px tall]                      │
│ ┌────────┐                              ┌────────┐   │
│ │ Party  │                              │Minimap │   │
│ │ Bar    │     [PHASER CANVAS]          │ 180x140│   │
│ │ 200px  │                              └────────┘   │
│ │ wide   │                                           │
│ │        │                     ┌──────────────────┐  │
│ │        │                     │ Detail Panel     │  │
│ │        │                     │ 320px wide       │  │
│ └────────┘                     │ (when agent      │  │
│ ┌──────────────────────────────┤  selected)       │  │
│ │ Activity Feed - bottom 160px │                  │  │
│ │ full width                   └──────────────────┘  │
│ └────────────────────────────────────────────────────┘
```

## Shared Styles

- Background: `rgba(26, 26, 46, 0.85)` (dark stone, semi-transparent)
- Border: `1px solid rgba(196, 163, 90, 0.4)` (gold tint)
- Font titles: `'Cinzel', serif` loaded from Google Fonts
- Font data: `'Fira Code', 'Consolas', monospace`
- Gold: `#C4A35A`
- Parchment: `#F5E6C8`
- Dark stone: `#2A2A3D`
- Red: `#8B2500`
- Green: `#2E8B57`
- Scrollbar: thin, dark, gold thumb

---

## File Structure

```
client/src/
├── components/
│   ├── TopBar.tsx
│   ├── TopBar.css
│   ├── PartyBar.tsx
│   ├── PartyBar.css
│   ├── ActivityFeed.tsx
│   ├── ActivityFeed.css
│   ├── DetailPanel.tsx
│   ├── DetailPanel.css
│   ├── Minimap.tsx
│   └── Minimap.css
├── hooks/
│   └── useSelectedAgent.ts   # NEW
├── App.tsx                    # MODIFIED: add panels
├── App.css                    # MODIFIED: overlay grid
└── index.html                 # MODIFIED: add Google Font link
```

---

## Task 1: Google Fonts + Shared Panel Hook

**Files:**
- Modify: `client/index.html` — add Cinzel + Fira Code font links
- Create: `client/src/hooks/useSelectedAgent.ts`

- [ ] **Step 1: Add Google Fonts to index.html**

Add this inside `<head>`, before the `<style>` tag:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Create useSelectedAgent hook**

```typescript
import { useState, useCallback } from 'react';

export interface SelectedAgentHook {
  selectedAgentId: string | null;
  selectAgent: (id: string | null) => void;
}

export function useSelectedAgent(): SelectedAgentHook {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const selectAgent = useCallback((id: string | null) => {
    setSelectedAgentId((prev) => (prev === id ? null : id));
  }, []);

  return { selectedAgentId, selectAgent };
}
```

- [ ] **Step 3: Commit**

```bash
git add client/index.html client/src/hooks/useSelectedAgent.ts
git commit -m "feat: add Google Fonts and useSelectedAgent hook"
```

---

## Task 2: TopBar Component

**Files:**
- Create: `client/src/components/TopBar.tsx`
- Create: `client/src/components/TopBar.css`

- [ ] **Step 1: Create TopBar.css**

```css
.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  background: rgba(26, 26, 46, 0.9);
  border-bottom: 1px solid rgba(196, 163, 90, 0.4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  z-index: 30;
  font-family: 'Fira Code', monospace;
}

.topbar-title {
  font-family: 'Cinzel', serif;
  color: #C4A35A;
  font-size: 16px;
  font-weight: 700;
}

.topbar-stats {
  display: flex;
  gap: 20px;
  font-size: 12px;
  color: #F5E6C8;
}

.topbar-stat {
  display: flex;
  align-items: center;
  gap: 6px;
}

.topbar-stat-label {
  color: #888;
}

.topbar-stat-value {
  color: #F5E6C8;
  font-weight: 500;
}

.topbar-stat-value.active { color: #2E8B57; }
.topbar-stat-value.idle { color: #C4A35A; }
.topbar-stat-value.error { color: #8B2500; }
```

- [ ] **Step 2: Create TopBar.tsx**

```tsx
import type { AgentState } from '../types/agent';
import './TopBar.css';

interface TopBarProps {
  agents: AgentState[];
  connected: boolean;
}

export function TopBar({ agents, connected }: TopBarProps) {
  const active = agents.filter((a) => a.status === 'active').length;
  const idle = agents.filter((a) => a.status === 'idle').length;
  const completed = agents.filter((a) => a.status === 'completed').length;
  const errors = agents.filter((a) => a.status === 'error').length;

  return (
    <div className="topbar">
      <span className="topbar-title">Agent Quest</span>
      <div className="topbar-stats">
        <div className="topbar-stat">
          <span className="topbar-stat-label">Status:</span>
          <span className={`topbar-stat-value ${connected ? 'active' : 'error'}`}>
            {connected ? 'Online' : 'Offline'}
          </span>
        </div>
        <div className="topbar-stat">
          <span className="topbar-stat-label">Active:</span>
          <span className="topbar-stat-value active">{active}</span>
        </div>
        <div className="topbar-stat">
          <span className="topbar-stat-label">Idle:</span>
          <span className="topbar-stat-value idle">{idle}</span>
        </div>
        <div className="topbar-stat">
          <span className="topbar-stat-label">Done:</span>
          <span className="topbar-stat-value">{completed}</span>
        </div>
        {errors > 0 && (
          <div className="topbar-stat">
            <span className="topbar-stat-label">Errors:</span>
            <span className="topbar-stat-value error">{errors}</span>
          </div>
        )}
        <div className="topbar-stat">
          <span className="topbar-stat-label">Total:</span>
          <span className="topbar-stat-value">{agents.length}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TopBar.tsx client/src/components/TopBar.css
git commit -m "feat: TopBar overlay with connection status and agent counts"
```

---

## Task 3: PartyBar Component

**Files:**
- Create: `client/src/components/PartyBar.tsx`
- Create: `client/src/components/PartyBar.css`

- [ ] **Step 1: Create PartyBar.css**

```css
.partybar {
  position: absolute;
  top: 48px;
  left: 8px;
  width: 200px;
  max-height: calc(100% - 220px);
  background: rgba(26, 26, 46, 0.85);
  border: 1px solid rgba(196, 163, 90, 0.4);
  border-radius: 4px;
  overflow-y: auto;
  z-index: 25;
  font-family: 'Fira Code', monospace;
}

.partybar::-webkit-scrollbar {
  width: 6px;
}

.partybar::-webkit-scrollbar-track {
  background: rgba(26, 26, 46, 0.5);
}

.partybar::-webkit-scrollbar-thumb {
  background: rgba(196, 163, 90, 0.4);
  border-radius: 3px;
}

.partybar-title {
  font-family: 'Cinzel', serif;
  color: #C4A35A;
  font-size: 13px;
  font-weight: 700;
  padding: 8px 10px 4px;
  border-bottom: 1px solid rgba(196, 163, 90, 0.2);
}

.partybar-agent {
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  transition: background 0.15s;
}

.partybar-agent:hover {
  background: rgba(196, 163, 90, 0.1);
}

.partybar-agent.selected {
  background: rgba(196, 163, 90, 0.2);
  border-left: 3px solid #C4A35A;
}

.partybar-agent-name {
  font-size: 11px;
  color: #F5E6C8;
  margin-bottom: 2px;
}

.partybar-agent-class {
  font-size: 9px;
  color: #888;
  text-transform: capitalize;
}

.partybar-agent-status {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
}

.partybar-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.partybar-dot.active { background: #2E8B57; }
.partybar-dot.idle { background: #C4A35A; }
.partybar-dot.completed { background: #555; }
.partybar-dot.error { background: #8B2500; }

.partybar-activity {
  font-size: 9px;
  color: #aaa;
}
```

- [ ] **Step 2: Create PartyBar.tsx**

```tsx
import type { AgentState } from '../types/agent';
import './PartyBar.css';

interface PartyBarProps {
  agents: AgentState[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
}

export function PartyBar({ agents, selectedAgentId, onSelectAgent }: PartyBarProps) {
  const sorted = [...agents].sort((a, b) => {
    const statusOrder = { active: 0, idle: 1, error: 2, completed: 3 };
    return statusOrder[a.status] - statusOrder[b.status];
  });

  return (
    <div className="partybar">
      <div className="partybar-title">Party</div>
      {sorted.map((agent) => (
        <div
          key={agent.id}
          className={`partybar-agent ${agent.id === selectedAgentId ? 'selected' : ''}`}
          onClick={() => onSelectAgent(agent.id)}
        >
          <div className="partybar-agent-name">{agent.name}</div>
          <div className="partybar-agent-class">{agent.heroClass}</div>
          <div className="partybar-agent-status">
            <span className={`partybar-dot ${agent.status}`} />
            <span className="partybar-activity">{agent.currentActivity}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/PartyBar.tsx client/src/components/PartyBar.css
git commit -m "feat: PartyBar with sorted agent list and selection"
```

---

## Task 4: ActivityFeed Component

**Files:**
- Create: `client/src/components/ActivityFeed.tsx`
- Create: `client/src/components/ActivityFeed.css`

- [ ] **Step 1: Create ActivityFeed.css**

```css
.activity-feed {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 160px;
  background: rgba(26, 26, 46, 0.9);
  border-top: 1px solid rgba(196, 163, 90, 0.4);
  z-index: 25;
  font-family: 'Fira Code', monospace;
  display: flex;
  flex-direction: column;
}

.activity-feed-title {
  font-family: 'Cinzel', serif;
  color: #C4A35A;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(196, 163, 90, 0.2);
  flex-shrink: 0;
}

.activity-feed-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.activity-feed-list::-webkit-scrollbar {
  width: 6px;
}

.activity-feed-list::-webkit-scrollbar-track {
  background: rgba(26, 26, 46, 0.5);
}

.activity-feed-list::-webkit-scrollbar-thumb {
  background: rgba(196, 163, 90, 0.4);
  border-radius: 3px;
}

.feed-entry {
  padding: 2px 12px;
  font-size: 11px;
  display: flex;
  gap: 8px;
  line-height: 1.5;
}

.feed-time {
  color: #666;
  flex-shrink: 0;
  width: 70px;
}

.feed-agent {
  color: #C4A35A;
  flex-shrink: 0;
  width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feed-action {
  color: #7B9EC4;
  flex-shrink: 0;
  width: 50px;
}

.feed-detail {
  color: #F5E6C8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 2: Create ActivityFeed.tsx**

```tsx
import type { ActivityLogEntry } from '../types/agent';
import type { AgentState } from '../types/agent';
import './ActivityFeed.css';

interface ActivityFeedProps {
  log: ActivityLogEntry[];
  agents: AgentState[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getAgentName(agents: AgentState[], agentId: string): string {
  return agents.find((a) => a.id === agentId)?.name ?? agentId.slice(0, 12);
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
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ActivityFeed.tsx client/src/components/ActivityFeed.css
git commit -m "feat: ActivityFeed with timestamped action log"
```

---

## Task 5: DetailPanel Component

**Files:**
- Create: `client/src/components/DetailPanel.tsx`
- Create: `client/src/components/DetailPanel.css`

- [ ] **Step 1: Create DetailPanel.css**

```css
.detail-panel {
  position: absolute;
  top: 48px;
  right: 8px;
  width: 320px;
  max-height: calc(100% - 220px);
  background: rgba(26, 26, 46, 0.9);
  border: 1px solid rgba(196, 163, 90, 0.4);
  border-radius: 4px;
  overflow-y: auto;
  z-index: 25;
  font-family: 'Fira Code', monospace;
}

.detail-panel::-webkit-scrollbar {
  width: 6px;
}

.detail-panel::-webkit-scrollbar-track {
  background: rgba(26, 26, 46, 0.5);
}

.detail-panel::-webkit-scrollbar-thumb {
  background: rgba(196, 163, 90, 0.4);
  border-radius: 3px;
}

.detail-header {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(196, 163, 90, 0.3);
}

.detail-name {
  font-family: 'Cinzel', serif;
  color: #C4A35A;
  font-size: 16px;
  font-weight: 700;
}

.detail-class {
  font-size: 11px;
  color: #888;
  text-transform: capitalize;
  margin-top: 2px;
}

.detail-section {
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.detail-section-title {
  font-size: 10px;
  color: #C4A35A;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 6px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  margin-bottom: 3px;
}

.detail-label {
  color: #888;
}

.detail-value {
  color: #F5E6C8;
}

.detail-file-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.detail-file-list li {
  font-size: 10px;
  color: #7B9EC4;
  padding: 1px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-close {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: 1px solid rgba(196, 163, 90, 0.3);
  color: #C4A35A;
  cursor: pointer;
  font-size: 14px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
}

.detail-close:hover {
  background: rgba(196, 163, 90, 0.2);
}
```

- [ ] **Step 2: Create DetailPanel.tsx**

```tsx
import type { AgentState } from '../types/agent';
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

export function DetailPanel({ agent, onClose }: DetailPanelProps) {
  return (
    <div className="detail-panel">
      <button className="detail-close" onClick={onClose}>✕</button>

      <div className="detail-header">
        <div className="detail-name">{agent.name}</div>
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
      </div>

      {agent.currentFile !== undefined && (
        <div className="detail-section">
          <div className="detail-section-title">Current File</div>
          <div className="detail-value" style={{ fontSize: '10px', wordBreak: 'break-all' }}>
            {agent.currentFile}
          </div>
        </div>
      )}

      {agent.currentCommand !== undefined && (
        <div className="detail-section">
          <div className="detail-section-title">Current Command</div>
          <div className="detail-value" style={{ fontSize: '10px', wordBreak: 'break-all' }}>
            {agent.currentCommand}
          </div>
        </div>
      )}

      <div className="detail-section">
        <div className="detail-section-title">Project</div>
        <div className="detail-value" style={{ fontSize: '10px', wordBreak: 'break-all' }}>
          {agent.cwd}
        </div>
      </div>

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
            <div key={i} className="detail-value" style={{ fontSize: '10px', color: '#8B2500', marginBottom: 4 }}>
              {e}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/DetailPanel.tsx client/src/components/DetailPanel.css
git commit -m "feat: DetailPanel character sheet with agent stats"
```

---

## Task 6: Minimap Component

**Files:**
- Create: `client/src/components/Minimap.tsx`
- Create: `client/src/components/Minimap.css`

- [ ] **Step 1: Create Minimap.css**

```css
.minimap {
  position: absolute;
  top: 48px;
  right: 8px;
  width: 180px;
  height: 140px;
  background: rgba(26, 26, 46, 0.85);
  border: 1px solid rgba(196, 163, 90, 0.4);
  border-radius: 4px;
  z-index: 24;
  overflow: hidden;
}

.minimap-title {
  font-family: 'Cinzel', serif;
  color: #C4A35A;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 6px;
  border-bottom: 1px solid rgba(196, 163, 90, 0.2);
}

.minimap-canvas {
  width: 100%;
  height: calc(100% - 20px);
}
```

- [ ] **Step 2: Create Minimap.tsx**

```tsx
import { useRef, useEffect } from 'react';
import type { AgentState } from '../types/agent';
import { BUILDING_DEFS, VILLAGE_GATE } from '../game/data/building-layout';
import './Minimap.css';

interface MinimapProps {
  agents: AgentState[];
}

const GAME_W = 1280;
const GAME_H = 720;

const HERO_COLORS: Record<string, string> = {
  warrior: '#FF4444', mage: '#6644FF', ranger: '#44AA44',
  paladin: '#FFDD44', rogue: '#AA44AA', druid: '#44DDAA',
  monk: '#FF8844', warlock: '#8844FF', bard: '#FF44AA',
  knight: '#AAAAAA', shaman: '#44AAFF', necromancer: '#884488',
  templar: '#FFAA44', hunter: '#668844', cleric: '#FFFFFF',
};

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

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    // Draw buildings as small rectangles
    for (const b of BUILDING_DEFS) {
      ctx.fillStyle = `#${b.color.toString(16).padStart(6, '0')}`;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(
        (b.x - b.width / 2) * sx,
        (b.y - b.height / 2) * sy,
        b.width * sx,
        b.height * sy,
      );
    }
    ctx.globalAlpha = 1;

    // Draw gate
    ctx.strokeStyle = '#C4A35A';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      (VILLAGE_GATE.x - 15) * sx,
      (VILLAGE_GATE.y - 8) * sy,
      30 * sx,
      16 * sy,
    );

    // Draw agents as dots
    const visible = agents.filter((a) => a.status === 'active' || a.status === 'idle');
    for (const agent of visible) {
      const building = BUILDING_DEFS.find((b) => b.activity === agent.currentActivity);
      if (building === undefined) continue;

      const ax = building.x * sx;
      const ay = (building.y + building.height / 2 + 10) * sy;

      ctx.fillStyle = HERO_COLORS[agent.heroClass] ?? '#FFFFFF';
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
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Minimap.tsx client/src/components/Minimap.css
git commit -m "feat: Minimap with building and agent dot visualization"
```

---

## Task 7: Wire All Panels into App.tsx

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/App.css`

- [ ] **Step 1: Replace App.css**

```css
.app-container {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  background: #1a1a2e;
}

.overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

.overlay > * {
  pointer-events: auto;
}
```

- [ ] **Step 2: Replace App.tsx**

```tsx
import { useEffect } from 'react';
import { PhaserGame } from './game/PhaserGame';
import { useAgentState } from './hooks/useAgentState';
import { useSelectedAgent } from './hooks/useSelectedAgent';
import { eventBridge } from './game/EventBridge';
import { TopBar } from './components/TopBar';
import { PartyBar } from './components/PartyBar';
import { ActivityFeed } from './components/ActivityFeed';
import { DetailPanel } from './components/DetailPanel';
import { Minimap } from './components/Minimap';
import './App.css';

export default function App() {
  const { agents, activityLog, connected } = useAgentState();
  const { selectedAgentId, selectAgent } = useSelectedAgent();

  const selectedAgent = selectedAgentId !== null
    ? agents.find((a) => a.id === selectedAgentId) ?? null
    : null;

  // Bridge React state to Phaser via EventBridge
  useEffect(() => {
    eventBridge.emit('agents:updated', agents);
  }, [agents]);

  useEffect(() => {
    if (connected) {
      eventBridge.emit('ws:connected');
    } else {
      eventBridge.emit('ws:disconnected');
    }
  }, [connected]);

  return (
    <div className="app-container">
      <PhaserGame />
      <div className="overlay">
        <TopBar agents={agents} connected={connected} />
        <PartyBar
          agents={agents}
          selectedAgentId={selectedAgentId}
          onSelectAgent={selectAgent}
        />
        {selectedAgent !== null ? (
          <DetailPanel agent={selectedAgent} onClose={() => selectAgent(null)} />
        ) : (
          <Minimap agents={agents} />
        )}
        <ActivityFeed log={activityLog} agents={agents} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd client && npx tsc -b --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx client/src/App.css
git commit -m "feat: wire all overlay panels into App.tsx"
```

---

## Task 8: Integration Verification

- [ ] **Step 1: Start server and client if not running**

```bash
cd server && bun run dev &
cd client && bun run dev &
```

- [ ] **Step 2: Open browser and verify**

Open `http://localhost:4445`. Expected:

1. **TopBar**: "Agent Quest" title on left, status counts on right (Active, Idle, Done, Total)
2. **PartyBar**: Left sidebar with sorted agent list. Agents show name, class, status dot, activity
3. **Minimap**: Top-right with tiny building rectangles and colored agent dots
4. **ActivityFeed**: Bottom bar showing timestamped actions
5. **Click an agent in PartyBar**: Minimap hides, DetailPanel appears on right with agent stats
6. **Click ✕ on DetailPanel**: closes it, Minimap returns

- [ ] **Step 3: Verify panels don't block Phaser interaction**

The Phaser canvas should still be visible between panels. Pointer events pass through the overlay background but are captured by the panel elements.

- [ ] **Step 4: Commit fixes if needed**

```bash
git add -A client/
git commit -m "fix: Phase 4 integration fixes"
```
