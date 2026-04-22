# Phase 3 — Placeholder Village Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the BootScene with a VillageScene featuring 8 colored-rectangle buildings and colored-circle heroes that walk between buildings based on agent activity — a fully functional visualization with placeholder graphics.

**Architecture:** A new VillageScene replaces BootScene. Buildings are positioned on a grid with labels. Heroes are colored circles with name text. When an agent's activity changes, the hero walks toward the corresponding building using simple linear interpolation (no A* yet — buildings are placed with clear paths). The EventBridge delivers agent state updates; VillageScene diffs previous vs current to trigger movement.

**Tech Stack:** Phaser 4 Graphics API (rectangles, circles, lines), Phaser Text, Phaser Tweens for movement.

---

## Building Layout

8 buildings arranged in a village pattern on the 1280x720 canvas:

```
        [Wizard Tower]        [Watchtower]
            (320,120)           (960,120)

[Library]                                    [Chapel]
 (120,300)                                   (1160,300)

[Forge]           [Tavern]             [Arena]
 (320,480)         (640,480)           (960,480)

              [Alchemist]
               (640,620)
```

Village gate (spawn point) at bottom center: (640, 700).

Each building: 120x90 rectangle with colored fill, white border, label text above.

## Building Colors

| Building | Activity | Color |
|---|---|---|
| Library | reading | #4A6FA5 (steel blue) |
| Forge | editing | #D4760A (orange) |
| Wizard Tower | thinking | #7B2D8B (purple) |
| Arena | bash | #8B0000 (dark red) |
| Tavern | idle | #8B7355 (tan) |
| Chapel | git | #FFD700 (gold) |
| Alchemist | debugging | #2E8B57 (green) |
| Watchtower | reviewing | #4682B4 (blue) |

## Hero Colors (by class)

Each hero class gets a distinct color for its circle:

| Class | Color |
|---|---|
| warrior | #FF4444 |
| mage | #6644FF |
| ranger | #44AA44 |
| paladin | #FFDD44 |
| rogue | #AA44AA |
| druid | #44DDAA |
| monk | #FF8844 |
| warlock | #8844FF |
| bard | #FF44AA |
| knight | #AAAAAA |
| shaman | #44AAFF |
| necromancer | #884488 |
| templar | #FFAA44 |
| hunter | #668844 |
| cleric | #FFFFFF |

---

## File Structure

```
client/src/game/
├── config.ts                    # Modified: add VillageScene
├── scenes/
│   ├── BootScene.ts             # Keep as-is (loading screen)
│   └── VillageScene.ts          # NEW: main village scene
├── entities/
│   ├── Building.ts              # NEW: building rectangle + label
│   └── HeroSprite.ts            # NEW: hero circle + name + movement
└── data/
    └── building-layout.ts       # NEW: building positions, colors, activity mapping
```

---

## Task 1: Building Layout Data

**Files:**
- Create: `client/src/game/data/building-layout.ts`

- [ ] **Step 1: Create the layout data file**

```typescript
import type { AgentActivity } from '../../types/agent';

export interface BuildingDef {
  id: string;
  label: string;
  activity: AgentActivity;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
}

export const BUILDING_DEFS: BuildingDef[] = [
  { id: 'library',    label: 'Library',       activity: 'reading',   x: 120,  y: 300, width: 120, height: 90, color: 0x4A6FA5 },
  { id: 'forge',      label: 'Forge',         activity: 'editing',   x: 320,  y: 480, width: 120, height: 90, color: 0xD4760A },
  { id: 'wizard',     label: 'Wizard Tower',  activity: 'thinking',  x: 320,  y: 120, width: 120, height: 90, color: 0x7B2D8B },
  { id: 'arena',      label: 'Arena',         activity: 'bash',      x: 960,  y: 480, width: 120, height: 90, color: 0x8B0000 },
  { id: 'tavern',     label: 'Tavern',        activity: 'idle',      x: 640,  y: 480, width: 120, height: 90, color: 0x8B7355 },
  { id: 'chapel',     label: 'Chapel',        activity: 'git',       x: 1160, y: 300, width: 120, height: 90, color: 0xFFD700 },
  { id: 'alchemist',  label: 'Alchemist',     activity: 'debugging', x: 640,  y: 620, width: 120, height: 90, color: 0x2E8B57 },
  { id: 'watchtower', label: 'Watchtower',    activity: 'reviewing', x: 960,  y: 120, width: 120, height: 90, color: 0x4682B4 },
];

export const VILLAGE_GATE = { x: 640, y: 700 };

export function getBuildingForActivity(activity: AgentActivity): BuildingDef {
  const building = BUILDING_DEFS.find((b) => b.activity === activity);
  return building ?? BUILDING_DEFS.find((b) => b.activity === 'idle')!;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd client && npx tsc -b --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/game/data/building-layout.ts
git commit -m "feat: building layout data with positions, colors, and activity mapping"
```

---

## Task 2: Building Entity

**Files:**
- Create: `client/src/game/entities/Building.ts`

- [ ] **Step 1: Create the Building class**

```typescript
import Phaser from 'phaser';
import type { BuildingDef } from '../data/building-layout';

export class Building {
  readonly def: BuildingDef;
  readonly graphics: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  readonly doorX: number;
  readonly doorY: number;

  constructor(scene: Phaser.Scene, def: BuildingDef) {
    this.def = def;

    // Door position: bottom-center of building
    this.doorX = def.x;
    this.doorY = def.y + def.height / 2 + 10;

    // Draw building rectangle
    this.graphics = scene.add.graphics();
    this.graphics.fillStyle(def.color, 0.8);
    this.graphics.fillRect(
      def.x - def.width / 2,
      def.y - def.height / 2,
      def.width,
      def.height,
    );
    this.graphics.lineStyle(2, 0xffffff, 0.6);
    this.graphics.strokeRect(
      def.x - def.width / 2,
      def.y - def.height / 2,
      def.width,
      def.height,
    );

    // Label above building
    this.label = scene.add.text(def.x, def.y - def.height / 2 - 12, def.label, {
      fontSize: '14px',
      color: '#F5E6C8',
      fontFamily: 'monospace',
    }).setOrigin(0.5, 1);
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd client && npx tsc -b --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/game/entities/Building.ts
git commit -m "feat: Building entity with colored rectangle and label"
```

---

## Task 3: Hero Entity

**Files:**
- Create: `client/src/game/entities/HeroSprite.ts`

- [ ] **Step 1: Create the HeroSprite class**

```typescript
import Phaser from 'phaser';
import type { HeroClass, AgentActivity } from '../../types/agent';

const HERO_COLORS: Record<HeroClass, number> = {
  warrior: 0xFF4444,
  mage: 0x6644FF,
  ranger: 0x44AA44,
  paladin: 0xFFDD44,
  rogue: 0xAA44AA,
  druid: 0x44DDAA,
  monk: 0xFF8844,
  warlock: 0x8844FF,
  bard: 0xFF44AA,
  knight: 0xAAAAAA,
  shaman: 0x44AAFF,
  necromancer: 0x884488,
  templar: 0xFFAA44,
  hunter: 0x668844,
  cleric: 0xFFFFFF,
};

const HERO_RADIUS = 10;
const MOVE_SPEED = 150; // pixels per second

export class HeroSprite {
  readonly id: string;
  readonly heroClass: HeroClass;
  private scene: Phaser.Scene;
  private graphics: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  private activityText: Phaser.GameObjects.Text;
  private _x: number;
  private _y: number;
  private moveTween: Phaser.Tweens.Tween | null = null;
  currentActivity: AgentActivity = 'idle';

  constructor(
    scene: Phaser.Scene,
    id: string,
    name: string,
    heroClass: HeroClass,
    x: number,
    y: number,
  ) {
    this.scene = scene;
    this.id = id;
    this.heroClass = heroClass;
    this._x = x;
    this._y = y;

    const color = HERO_COLORS[heroClass];

    // Hero circle
    this.graphics = scene.add.graphics();
    this.graphics.fillStyle(color, 1);
    this.graphics.fillCircle(0, 0, HERO_RADIUS);
    this.graphics.lineStyle(2, 0xffffff, 0.8);
    this.graphics.strokeCircle(0, 0, HERO_RADIUS);
    this.graphics.setPosition(x, y);
    this.graphics.setDepth(10);

    // Name label above hero
    this.nameText = scene.add.text(x, y - 20, name, {
      fontSize: '11px',
      color: '#F5E6C8',
      fontFamily: 'monospace',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(11);

    // Activity label below hero
    this.activityText = scene.add.text(x, y + 16, 'idle', {
      fontSize: '9px',
      color: '#888888',
      fontFamily: 'monospace',
      stroke: '#000000',
      strokeThickness: 1,
    }).setOrigin(0.5).setDepth(11);
  }

  get x(): number { return this._x; }
  get y(): number { return this._y; }

  moveTo(targetX: number, targetY: number, activity: AgentActivity): void {
    this.currentActivity = activity;
    this.activityText.setText(activity);

    // Cancel existing tween
    if (this.moveTween !== null) {
      this.moveTween.stop();
      this.moveTween = null;
    }

    const dx = targetX - this._x;
    const dy = targetY - this._y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 5) {
      // Already at destination
      return;
    }

    const duration = (distance / MOVE_SPEED) * 1000;

    this.moveTween = this.scene.tweens.add({
      targets: { x: this._x, y: this._y },
      x: targetX,
      y: targetY,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: (_tween, target: { x: number; y: number }) => {
        this._x = target.x;
        this._y = target.y;
        this.graphics.setPosition(this._x, this._y);
        this.nameText.setPosition(this._x, this._y - 20);
        this.activityText.setPosition(this._x, this._y + 16);
      },
      onComplete: () => {
        this.moveTween = null;
      },
    });
  }

  destroy(): void {
    if (this.moveTween !== null) {
      this.moveTween.stop();
    }
    this.graphics.destroy();
    this.nameText.destroy();
    this.activityText.destroy();
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd client && npx tsc -b --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/game/entities/HeroSprite.ts
git commit -m "feat: HeroSprite entity with colored circle, name label, and tween movement"
```

---

## Task 4: VillageScene

**Files:**
- Create: `client/src/game/scenes/VillageScene.ts`

- [ ] **Step 1: Create the VillageScene**

```typescript
import Phaser from 'phaser';
import { eventBridge } from '../EventBridge';
import { Building } from '../entities/Building';
import { HeroSprite } from '../entities/HeroSprite';
import { BUILDING_DEFS, VILLAGE_GATE, getBuildingForActivity } from '../data/building-layout';
import type { AgentState } from '../../types/agent';

export class VillageScene extends Phaser.Scene {
  private buildings: Building[] = [];
  private heroes = new Map<string, HeroSprite>();
  private prevAgents: AgentState[] = [];

  constructor() {
    super({ key: 'VillageScene' });
  }

  create(): void {
    // Background
    this.cameras.main.setBackgroundColor('#2A2A3D');

    // Draw ground paths (simple lines connecting buildings)
    this.drawPaths();

    // Create buildings
    for (const def of BUILDING_DEFS) {
      this.buildings.push(new Building(this, def));
    }

    // Draw village gate
    const gate = this.add.graphics();
    gate.lineStyle(3, 0xC4A35A, 0.8);
    gate.strokeRect(VILLAGE_GATE.x - 30, VILLAGE_GATE.y - 15, 60, 30);
    this.add.text(VILLAGE_GATE.x, VILLAGE_GATE.y - 22, 'Gate', {
      fontSize: '12px',
      color: '#C4A35A',
      fontFamily: 'monospace',
    }).setOrigin(0.5, 1);

    // Title
    this.add.text(this.cameras.main.centerX, 20, 'AGENT QUEST', {
      fontSize: '24px',
      color: '#C4A35A',
      fontFamily: 'Georgia, serif',
    }).setOrigin(0.5, 0).setDepth(20);

    // Listen for agent updates from React
    eventBridge.on('agents:updated', (agents: unknown) => {
      this.handleAgentUpdate(agents as AgentState[]);
    });
  }

  private drawPaths(): void {
    const paths = this.add.graphics();
    paths.lineStyle(2, 0x555555, 0.4);

    // Horizontal main road
    paths.lineBetween(60, 300, 1220, 300);
    // Vertical main road
    paths.lineBetween(640, 60, 640, VILLAGE_GATE.y);
    // Cross paths
    paths.lineBetween(120, 120, 120, 480);
    paths.lineBetween(320, 120, 320, 480);
    paths.lineBetween(960, 120, 960, 480);
    paths.lineBetween(1160, 120, 1160, 480);
    // Bottom road
    paths.lineBetween(320, 480, 960, 480);
    paths.lineBetween(640, 480, 640, 620);
    // Top road
    paths.lineBetween(320, 120, 960, 120);

    paths.setDepth(0);
  }

  private handleAgentUpdate(agents: AgentState[]): void {
    // Only show active and idle agents (skip completed to avoid clutter)
    const visible = agents.filter((a) => a.status === 'active' || a.status === 'idle');

    // Remove heroes for agents no longer visible
    for (const [id, hero] of this.heroes) {
      if (!visible.some((a) => a.id === id)) {
        hero.destroy();
        this.heroes.delete(id);
      }
    }

    // Add or update heroes
    for (const agent of visible) {
      const existing = this.heroes.get(agent.id);
      const building = getBuildingForActivity(agent.currentActivity);

      if (existing === undefined) {
        // New hero — spawn at gate, then move to building
        const hero = new HeroSprite(
          this,
          agent.id,
          agent.name,
          agent.heroClass,
          VILLAGE_GATE.x,
          VILLAGE_GATE.y,
        );
        this.heroes.set(agent.id, hero);
        hero.moveTo(building.x, building.doorY, agent.currentActivity);
      } else if (existing.currentActivity !== agent.currentActivity) {
        // Activity changed — move to new building
        existing.moveTo(building.x, building.doorY, agent.currentActivity);
      }
    }

    this.prevAgents = agents;
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd client && npx tsc -b --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/game/scenes/VillageScene.ts
git commit -m "feat: VillageScene with buildings, heroes, paths, and activity-based movement"
```

---

## Task 5: Update Game Config and BootScene Transition

**Files:**
- Modify: `client/src/game/config.ts`
- Modify: `client/src/game/scenes/BootScene.ts`

- [ ] **Step 1: Update config.ts to include VillageScene**

Replace the entire file:

```typescript
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { VillageScene } from './scenes/VillageScene';

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#1a1a2e',
  scene: [BootScene, VillageScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  banner: false,
};
```

- [ ] **Step 2: Update BootScene to transition to VillageScene on connect**

Replace the entire BootScene file:

```typescript
import Phaser from 'phaser';
import { eventBridge } from '../EventBridge';

export class BootScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private hasTransitioned = false;

  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1a1a2e');

    this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY - 40,
      'AGENT QUEST',
      {
        fontSize: '48px',
        color: '#C4A35A',
        fontFamily: 'Georgia, serif',
      },
    ).setOrigin(0.5);

    this.statusText = this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY + 20,
      'Connecting to server...',
      {
        fontSize: '18px',
        color: '#888888',
        fontFamily: 'monospace',
      },
    ).setOrigin(0.5);

    // Transition to VillageScene once connected
    eventBridge.on('ws:connected', () => {
      if (this.hasTransitioned) return;
      this.hasTransitioned = true;
      this.statusText.setText('Connected! Entering village...');
      this.time.delayedCall(800, () => {
        this.scene.start('VillageScene');
      });
    });
  }
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd client && npx tsc -b --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add client/src/game/config.ts client/src/game/scenes/BootScene.ts
git commit -m "feat: BootScene transitions to VillageScene on WebSocket connect"
```

---

## Task 6: Integration Verification

- [ ] **Step 1: Start server (if not running)**

```bash
cd server && bun run dev &
sleep 2
```

- [ ] **Step 2: Start client (if not running)**

```bash
cd client && bun run dev &
sleep 3
```

- [ ] **Step 3: Open browser and verify**

Open `http://localhost:4445`. Expected sequence:

1. "AGENT QUEST" loading screen appears briefly
2. "Connected! Entering village..." message
3. Transitions to VillageScene with:
   - Dark background with road grid
   - 8 labeled colored rectangles (buildings)
   - Village gate at bottom
   - Hero circles appearing at the gate and moving toward buildings
   - Each hero has a name label and activity label

- [ ] **Step 4: Verify agent movement**

While this Claude Code session is active, the agent should appear at the gate, then move to the appropriate building (e.g., moving to Library when reading files, Forge when editing).

If idle agents are detected, they should be at the Tavern.

- [ ] **Step 5: Commit if fixes needed**

```bash
git add -A client/
git commit -m "fix: Phase 3 integration fixes"
```

- [ ] **Step 6: Final all-tests check**

```bash
cd server && bun test
```

Expected: all 21 tests pass.
