# Phase 2 — Client Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React + Vite client that mounts a Phaser 4 canvas, connects to the server via WebSocket, and displays agent state in the browser console — the shell that Phase 3 will fill with village visuals.

**Architecture:** Vite scaffolds a React 19 + TypeScript app on port 4445. The Phaser 4 game instance is created inside a React component via useRef/useEffect. A custom `useAgentState` hook manages WebSocket connection to `ws://localhost:4444/ws`, receives snapshot and incremental events, and stores `AgentState[]` in React state. The Phaser scene receives agent data via an EventEmitter bridge. Phase 2 renders a colored background with a "Connected" status text — just enough to prove the pipeline works.

**Tech Stack:** React 19, Phaser 4.0.0, Vite, TypeScript strict mode.

---

## File Structure

```
client/
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts
├── index.html
├── public/
│   └── assets/            # empty for now
└── src/
    ├── main.tsx           # React entry point
    ├── App.tsx            # Shell: Phaser container + React overlay
    ├── App.css            # Fullscreen layout, overlay positioning
    ├── types/
    │   └── agent.ts       # Client-side AgentState, WsEvent types (mirror of server)
    ├── hooks/
    │   └── useAgentState.ts  # WebSocket connection + state management
    ├── game/
    │   ├── config.ts      # Phaser GameConfig
    │   ├── PhaserGame.tsx # React component that creates/destroys the Phaser Game
    │   ├── EventBridge.ts # EventEmitter singleton for React→Phaser communication
    │   └── scenes/
    │       └── BootScene.ts  # Minimal scene: colored bg + status text
    └── vite-env.d.ts
```

---

## Task 1: Client Scaffold (Vite + React + TypeScript)

**Files:**
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/tsconfig.app.json`
- Create: `client/tsconfig.node.json`
- Create: `client/vite.config.ts`
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/vite-env.d.ts`

- [ ] **Step 1: Create client/package.json**

```json
{
  "name": "agent-quest-client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 4445",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "phaser": "^4.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "~5.7.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create client/tsconfig.json**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

- [ ] **Step 3: Create client/tsconfig.app.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create client/tsconfig.node.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create client/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4445,
    strictPort: true,
  },
});
```

- [ ] **Step 6: Create client/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Quest</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body, #root { width: 100%; height: 100%; overflow: hidden; background: #1a1a2e; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create client/src/vite-env.d.ts**

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 8: Create client/src/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Create a minimal client/src/App.tsx placeholder**

```tsx
export default function App() {
  return <div style={{ color: 'white', padding: 20 }}>Agent Quest — loading...</div>;
}
```

- [ ] **Step 10: Install dependencies**

```bash
cd client && bun install
```

- [ ] **Step 11: Verify dev server starts**

```bash
cd client && timeout 10 bun run dev 2>&1 || true
```

Expected: Vite prints `Local: http://localhost:4445/`

- [ ] **Step 12: Commit**

```bash
git add client/
git commit -m "feat: scaffold client with Vite, React 19, Phaser 4, TypeScript"
```

---

## Task 2: Client-Side Types

**Files:**
- Create: `client/src/types/agent.ts`

- [ ] **Step 1: Create the types file**

These mirror the server types needed by the client.

```typescript
export const HERO_CLASSES = [
  'warrior', 'mage', 'ranger', 'paladin', 'rogue',
  'druid', 'monk', 'warlock', 'bard', 'knight',
  'shaman', 'necromancer', 'templar', 'hunter', 'cleric',
] as const;

export type HeroClass = (typeof HERO_CLASSES)[number];

export type AgentActivity =
  | 'reading'
  | 'editing'
  | 'thinking'
  | 'bash'
  | 'idle'
  | 'git'
  | 'debugging'
  | 'reviewing';

export interface ToolCall {
  id: string;
  name: string;
  timestamp: number;
  input: Record<string, unknown>;
}

export interface AgentState {
  id: string;
  name: string;
  heroClass: HeroClass;
  status: 'active' | 'idle' | 'completed' | 'error';
  currentActivity: AgentActivity;
  currentFile?: string;
  currentCommand?: string;
  tokenUsage: { input: number; output: number; cacheRead: number };
  cost: number;
  sessionStart: number;
  toolCalls: ToolCall[];
  errors: string[];
  filesModified: string[];
  lastEvent: number;
  cwd: string;
}

export interface ActivityLogEntry {
  agentId: string;
  action: string;
  detail: string;
  timestamp: number;
}

export type WsEvent =
  | { type: 'agent:update'; agent: AgentState }
  | { type: 'agent:new'; agent: AgentState }
  | { type: 'agent:complete'; id: string }
  | { type: 'activity:log'; agentId: string; action: string; detail: string; timestamp: number }
  | { type: 'snapshot'; agents: AgentState[] };
```

- [ ] **Step 2: Verify it compiles**

```bash
cd client && npx tsc -b --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/types/agent.ts
git commit -m "feat: add client-side AgentState and WebSocket event types"
```

---

## Task 3: WebSocket Hook (useAgentState)

**Files:**
- Create: `client/src/hooks/useAgentState.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentState, WsEvent, ActivityLogEntry } from '../types/agent';

const WS_URL = 'ws://localhost:4444/ws';
const RECONNECT_DELAY_MS = 3000;
const MAX_LOG_ENTRIES = 200;

export interface AgentStateHook {
  agents: AgentState[];
  activityLog: ActivityLogEntry[];
  connected: boolean;
}

export function useAgentState(): AgentStateHook {
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEvent = useCallback((event: WsEvent) => {
    switch (event.type) {
      case 'snapshot':
        setAgents(event.agents);
        break;

      case 'agent:new':
        setAgents((prev) => [...prev, event.agent]);
        break;

      case 'agent:update':
        setAgents((prev) =>
          prev.map((a) => (a.id === event.agent.id ? event.agent : a)),
        );
        break;

      case 'agent:complete':
        setAgents((prev) =>
          prev.map((a) =>
            a.id === event.id ? { ...a, status: 'completed' as const, currentActivity: 'idle' as const } : a,
          ),
        );
        break;

      case 'activity:log':
        setActivityLog((prev) => {
          const entry: ActivityLogEntry = {
            agentId: event.agentId,
            action: event.action,
            detail: event.detail,
            timestamp: event.timestamp,
          };
          const next = [entry, ...prev];
          return next.length > MAX_LOG_ENTRIES ? next.slice(0, MAX_LOG_ENTRIES) : next;
        });
        break;
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      console.log('[WS] connected to', WS_URL);
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as WsEvent;
        handleEvent(event);
      } catch (err) {
        console.error('[WS] failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('[WS] disconnected, reconnecting in', RECONNECT_DELAY_MS, 'ms');
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
    };

    ws.onerror = (err) => {
      console.error('[WS] error:', err);
      ws.close();
    };
  }, [handleEvent]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  return { agents, activityLog, connected };
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd client && npx tsc -b --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useAgentState.ts
git commit -m "feat: useAgentState hook with WebSocket connection and auto-reconnect"
```

---

## Task 4: Event Bridge (React → Phaser)

**Files:**
- Create: `client/src/game/EventBridge.ts`

- [ ] **Step 1: Write the EventBridge**

A simple typed EventEmitter singleton that React writes to and Phaser reads from.

```typescript
type Listener = (...args: unknown[]) => void;

class EventBridge {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, fn: Listener): void {
    let set = this.listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
  }

  off(event: string, fn: Listener): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (set !== undefined) {
      for (const fn of set) {
        fn(...args);
      }
    }
  }
}

export const eventBridge = new EventBridge();
```

- [ ] **Step 2: Verify it compiles**

```bash
cd client && npx tsc -b --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/game/EventBridge.ts
git commit -m "feat: EventBridge singleton for React-to-Phaser communication"
```

---

## Task 5: Boot Scene (Phaser)

**Files:**
- Create: `client/src/game/scenes/BootScene.ts`
- Create: `client/src/game/config.ts`

- [ ] **Step 1: Create BootScene**

A minimal Phaser scene that shows a dark background with status text. It listens to the EventBridge for agent updates and displays agent count.

```typescript
import Phaser from 'phaser';
import { eventBridge } from '../EventBridge';
import type { AgentState } from '../../types/agent';

export class BootScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private agentCountText!: Phaser.GameObjects.Text;
  private agents: AgentState[] = [];

  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    // Dark fantasy background
    this.cameras.main.setBackgroundColor('#1a1a2e');

    // Title
    this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY - 60,
      'AGENT QUEST',
      {
        fontSize: '48px',
        color: '#C4A35A',
        fontFamily: 'Georgia, serif',
      },
    ).setOrigin(0.5);

    // Connection status
    this.statusText = this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
      'Connecting...',
      {
        fontSize: '20px',
        color: '#888888',
        fontFamily: 'monospace',
      },
    ).setOrigin(0.5);

    // Agent count
    this.agentCountText = this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY + 40,
      '',
      {
        fontSize: '16px',
        color: '#F5E6C8',
        fontFamily: 'monospace',
      },
    ).setOrigin(0.5);

    // Listen for connection status
    eventBridge.on('ws:connected', () => {
      this.statusText.setText('Connected to server').setColor('#2E8B57');
    });

    eventBridge.on('ws:disconnected', () => {
      this.statusText.setText('Disconnected — reconnecting...').setColor('#8B2500');
    });

    // Listen for agent updates
    eventBridge.on('agents:updated', (agents: unknown) => {
      this.agents = agents as AgentState[];
      this.updateAgentDisplay();
    });
  }

  private updateAgentDisplay(): void {
    const active = this.agents.filter((a) => a.status === 'active').length;
    const idle = this.agents.filter((a) => a.status === 'idle').length;
    const completed = this.agents.filter((a) => a.status === 'completed').length;
    const total = this.agents.length;

    this.agentCountText.setText(
      `Agents: ${total} total | ${active} active | ${idle} idle | ${completed} completed`,
    );
  }
}
```

- [ ] **Step 2: Create game config**

```typescript
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#1a1a2e',
  scene: [BootScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  banner: false,
};
```

- [ ] **Step 3: Verify it compiles**

```bash
cd client && npx tsc -b --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add client/src/game/scenes/BootScene.ts client/src/game/config.ts
git commit -m "feat: BootScene with status display and Phaser game config"
```

---

## Task 6: PhaserGame Component (React ↔ Phaser Bridge)

**Files:**
- Create: `client/src/game/PhaserGame.tsx`

- [ ] **Step 1: Write the PhaserGame component**

This React component creates and destroys the Phaser Game instance. It uses a ref to hold the container div and a ref for the game instance.

```tsx
import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { gameConfig } from './config';

export function PhaserGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (containerRef.current === null) return;
    if (gameRef.current !== null) return;

    const game = new Phaser.Game({
      ...gameConfig,
      parent: containerRef.current,
    });

    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
      }}
    />
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd client && npx tsc -b --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/game/PhaserGame.tsx
git commit -m "feat: PhaserGame React component mounting Phaser 4 canvas"
```

---

## Task 7: Wire App.tsx (Connect Everything)

**Files:**
- Modify: `client/src/App.tsx`
- Create: `client/src/App.css`

- [ ] **Step 1: Create App.css**

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

.status-bar {
  position: absolute;
  bottom: 8px;
  right: 8px;
  padding: 4px 12px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  z-index: 20;
}

.status-bar.connected {
  background: rgba(46, 139, 87, 0.8);
  color: #F5E6C8;
}

.status-bar.disconnected {
  background: rgba(139, 37, 0, 0.8);
  color: #F5E6C8;
}
```

- [ ] **Step 2: Replace App.tsx**

```tsx
import { useEffect } from 'react';
import { PhaserGame } from './game/PhaserGame';
import { useAgentState } from './hooks/useAgentState';
import { eventBridge } from './game/EventBridge';
import './App.css';

export default function App() {
  const { agents, connected } = useAgentState();

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
        <div className={`status-bar ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? `Connected — ${agents.length} agents` : 'Disconnected'}
        </div>
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
git commit -m "feat: wire App.tsx with Phaser canvas, WebSocket hook, and EventBridge"
```

---

## Task 8: Integration Verification

- [ ] **Step 1: Start the server**

```bash
cd server && bun run dev &
```

Wait 3 seconds for the server to boot.

- [ ] **Step 2: Start the client**

```bash
cd client && bun run dev &
```

Wait for Vite to print the URL.

- [ ] **Step 3: Open browser and verify**

Open `http://localhost:4445` in a browser. Expected:

1. Dark background with "AGENT QUEST" title in gold
2. "Connected to server" text in green
3. Agent count text showing detected agents
4. Small green status bar in bottom-right corner showing "Connected — N agents"
5. Browser console should show `[WS] connected to ws://localhost:4444/ws`

- [ ] **Step 4: Verify WebSocket data flows**

Open browser DevTools console. Run:

```javascript
// Should see agents in memory
console.log('Check React DevTools or component state for agents array');
```

The Phaser canvas should show the agent count updating if agents are active.

- [ ] **Step 5: Test reconnection**

Stop the server (Ctrl+C on the server process). Expected:
- Status text changes to "Disconnected — reconnecting..." in red
- Status bar turns red
- Console shows `[WS] disconnected, reconnecting in 3000 ms`

Restart the server. Expected:
- Auto-reconnects within 3 seconds
- Status text turns green again
- Snapshot received with agents

- [ ] **Step 6: Stop processes and commit if fixes were needed**

```bash
# Kill background processes
kill %1 %2 2>/dev/null
```

If any fixes were made during integration:

```bash
git add -A client/
git commit -m "fix: integration fixes for Phase 2 client shell"
```
