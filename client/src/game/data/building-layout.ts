import type { AgentActivity } from '../../types/agent';

export interface BuildingDef {
  id: string;
  label: string;
  activity: AgentActivity;
  x: number;
  y: number;
  imageKey: string;
  scale: number;
  description: string;
  toolCalls: string[];
}

/**
 * World is much larger (2800x1800) so we can render a thick decorative forest
 * around the village. The **interactive** village itself stays compact — all
 * buildings fit inside a ~1100×700 area centred at (1400, 720) — so every
 * functional target remains on-screen at default zoom.
 */
export const WORLD_WIDTH = 2800;
export const WORLD_HEIGHT = 1800;

/**
 * Main village clear-zone (no forest inside here). Forest fills everything
 * outside this ellipse, with a secondary clearing around the NPC hamlet.
 */
export const CITY_CLEAR = { x: 1400, y: 780, rx: 520, ry: 420 };

/** Plaza/fountain anchor — drives road hub & heroes' visual centre. */
export const PLAZA = { x: 1400, y: 780 };

/**
 * Building coordinates follow the handle-issue workflow order to minimise hero
 * travel distance on the transitions that happen most often in practice:
 *
 * - Forge/Arena/Alchemist cluster tightly (≤ 201 px apart) because editing,
 *   running tests, and debugging cycle rapidly within a single task step.
 * - Library and Castle sit near the south gate so the first two steps of every
 *   task (read codebase, plan) require short walks from the spawn point.
 * - Chapel and Watchtower share the north-east corner because git operations
 *   and code review happen together at end-of-task, keeping that flow local.
 * - Tavern occupies the western plaza so idle heroes stay out of the active
 *   work zone and are visually distinct from agents in progress.
 */
export const BUILDING_DEFS: BuildingDef[] = [
  { id: 'library',    label: 'Library',    activity: 'reading',   x: 1150, y: 900,  imageKey: 'building-library',    scale: 0.52, description: 'Agents come here to read and search code',                toolCalls: ['Read', 'Grep', 'Glob'] },
  { id: 'castle',     label: 'Castle',     activity: 'thinking',  x: 1300, y: 700,  imageKey: 'building-castle',     scale: 0.46, description: 'Agents come here to think and reason',                    toolCalls: ['(AI thinking/planning)'] },
  { id: 'forge',      label: 'Forge',      activity: 'editing',   x: 1380, y: 880,  imageKey: 'building-forge',      scale: 0.42, description: 'Agents come here to write and edit code',                 toolCalls: ['Edit', 'Write'] },
  { id: 'arena',      label: 'Arena',      activity: 'bash',      x: 1560, y: 880,  imageKey: 'building-arena',      scale: 0.42, description: 'Agents come here to run commands and tests',              toolCalls: ['Bash'] },
  { id: 'alchemist',  label: 'Alchemist',  activity: 'debugging', x: 1470, y: 700,  imageKey: 'building-alchemist',  scale: 0.50, description: 'Agents come here to debug and fix errors',                toolCalls: ['(fixing after errors)'] },
  { id: 'chapel',     label: 'Chapel',     activity: 'git',       x: 1720, y: 560,  imageKey: 'building-chapel',     scale: 0.38, description: 'Agents come here to commit and push code',                toolCalls: ['git commit', 'git push', 'git merge'] },
  { id: 'watchtower', label: 'Watchtower', activity: 'reviewing', x: 1600, y: 450,  imageKey: 'building-watchtower', scale: 0.42, description: 'Agents come here to review code and dispatch subagents',  toolCalls: ['Agent', 'review'] },
  { id: 'tavern',     label: 'Tavern',     activity: 'idle',      x: 1250, y: 780,  imageKey: 'building-tavern',     scale: 0.50, description: 'Agents rest here while waiting for user input',           toolCalls: ['(idle/waiting)'] },
];

/** South gate — where heroes first spawn before walking into the village. */
export const VILLAGE_GATE = { x: 1400, y: 1130 };

/**
 * Small purple NPC village tucked into the NE forest, visually separated
 * from the main village by a strip of woods.
 */
export const NPC_VILLAGE = { x: 2420, y: 1430, radius: 180 };

export function getBuildingForActivity(activity: AgentActivity): BuildingDef {
  const building = BUILDING_DEFS.find((b) => b.activity === activity);
  return building ?? BUILDING_DEFS.find((b) => b.activity === 'idle')!;
}
