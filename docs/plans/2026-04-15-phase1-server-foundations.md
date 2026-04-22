# Phase 1 — Server Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Bun + Hono server that discovers active Claude Code sessions, parses their JSONL logs into AgentState objects, watches for changes in real-time, and pushes updates to browser clients via WebSocket.

**Architecture:** The server scans `~/.claude/sessions/*.json` to discover sessions, reads corresponding JSONL files from `~/.claude/projects/<project-path>/<sessionId>.jsonl`, parses tool_use events to determine agent activity, and maintains an in-memory state map. File changes trigger WebSocket broadcasts to all connected clients. A Hono HTTP layer serves the initial state snapshot and a health endpoint.

**Tech Stack:** Bun runtime, Hono HTTP framework, native Bun WebSocket, native Bun file watcher, TypeScript strict mode.

---

## JSONL Format Reference

This section documents the actual Claude Code JSONL structure (verified from live files).

**Session metadata** lives at `~/.claude/sessions/<pid>.json`:
```json
{"pid": 92166, "sessionId": "7b70c57e-...", "cwd": "/path/to/project", "startedAt": 1776273772749, "kind": "interactive", "entrypoint": "cli"}
```

**Session logs** live at `~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl` where `<sanitized-cwd>` replaces `/` with `-` and prefixes with `-` (e.g., `/Users/alice/Projects/agent-quest` → `-Users-alice-Projects-agent-quest`).

**JSONL line types:**
- `type: "assistant"` with `message.content[]` containing `{type: "tool_use", name: "Read"|"Edit"|"Bash"|..., id, input}` — this is the primary source for activity detection
- `type: "assistant"` with `message.content[]` containing `{type: "text", text: "..."}` — thinking/response text
- `type: "user"` with `message.content[]` containing `{type: "tool_result", tool_use_id, content}` — tool results
- `type: "system"` with `subtype: "turn_duration"` — contains `durationMs` and `messageCount`
- `type: "permission-mode"`, `type: "attachment"`, `type: "file-history-snapshot"` — metadata

**Key fields on every line:** `uuid`, `parentUuid`, `timestamp` (ISO string), `sessionId`, `cwd`.

**On assistant lines:** `slug` (human-readable name like "bubbly-waddling-cat"), `requestId`.

**Tool use input examples:**
- Read: `{file_path: "/path"}`
- Edit: `{file_path, old_string, new_string}`
- Write: `{file_path, content}`
- Bash: `{command, description}`
- Grep: `{pattern, path}`
- Glob: `{pattern}`

**Note:** Token/cost data is NOT available per-message in the JSONL. The `stats-cache.json` has aggregate daily data only. Phase 1 tracks tool call counts; cost estimation can be added later.

---

## File Structure

```
server/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                 # Entry point: start Hono + WebSocket server
    ├── types.ts                 # AgentState, ToolCall, WebSocket events, session metadata types
    ├── parsers/
    │   └── session-parser.ts    # Parse JSONL lines → extract tool calls and activity
    ├── watchers/
    │   └── file-watcher.ts      # Watch ~/.claude/ for new/changed JSONL files
    ├── state/
    │   └── agent-state-manager.ts  # In-memory map of session → AgentState, activity mapping
    └── ws/
        └── websocket-server.ts  # Bun native WebSocket upgrade + broadcast to clients
```

Root:
```
package.json          # Root package.json with workspace scripts
.gitignore
```

---

## Task 0: Install Bun and Initialize Root

**Files:**
- Create: `package.json` (root)
- Create: `.gitignore`

- [ ] **Step 1: Install Bun**

Run:
```bash
curl -fsSL https://bun.sh/install | bash
```

After install, restart shell or run `source ~/.bashrc` / `source ~/.zshrc`.

Verify:
```bash
bun --version
```
Expected: `1.x.x` (any recent version)

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "agent-quest",
  "private": true,
  "scripts": {
    "dev:server": "cd server && bun run dev",
    "dev:client": "cd client && bun run dev",
    "start": "bun run dev:server & bun run dev:client"
  }
}
```

- [ ] **Step 3: Create .gitignore**

```gitignore
node_modules/
dist/
.DS_Store
*.log
.env
```

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "feat: add root package.json and gitignore"
```

---

## Task 1: Server Scaffold

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`

- [ ] **Step 1: Create server/package.json**

```json
{
  "name": "agent-quest-server",
  "private": true,
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test"
  },
  "dependencies": {
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

- [ ] **Step 2: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd server && bun install
```

Expected: `hono` and `@types/bun` installed, `bun.lock` created.

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/tsconfig.json server/bun.lock
git commit -m "feat: scaffold server with Bun, Hono, TypeScript strict"
```

---

## Task 2: Shared Types

**Files:**
- Create: `server/src/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// --- Hero classes (15 total, assigned cyclically) ---
export const HERO_CLASSES = [
  'warrior', 'mage', 'ranger', 'paladin', 'rogue',
  'druid', 'monk', 'warlock', 'bard', 'knight',
  'shaman', 'necromancer', 'templar', 'hunter', 'cleric',
] as const;

export type HeroClass = (typeof HERO_CLASSES)[number];

// --- Agent activity (maps to village buildings) ---
export type AgentActivity =
  | 'reading'    // Library: Read, Grep, Glob
  | 'editing'    // Forge: Edit, Write
  | 'thinking'   // Wizard Tower: long text, thinking blocks
  | 'bash'       // Arena: Bash
  | 'idle'       // Tavern: no activity
  | 'git'        // Chapel: git commit/push inside Bash
  | 'debugging'  // Alchemist Shop: fix after errors
  | 'reviewing'; // Watchtower: Agent subagent, review

// --- Tool call record ---
export interface ToolCall {
  id: string;
  name: string;
  timestamp: number;
  input: Record<string, unknown>;
}

// --- Core agent state ---
export interface AgentState {
  id: string;          // sessionId
  name: string;        // slug from JSONL (e.g. "bubbly-waddling-cat")
  heroClass: HeroClass;
  status: 'active' | 'idle' | 'completed' | 'error';
  currentActivity: AgentActivity;
  currentFile?: string;
  currentCommand?: string;
  tokenUsage: { input: number; output: number; cacheRead: number };
  cost: number;
  sessionStart: number;   // timestamp ms
  toolCalls: ToolCall[];
  errors: string[];
  filesModified: string[];
  lastEvent: number;      // timestamp ms
  cwd: string;            // project working directory
}

// --- Session metadata from ~/.claude/sessions/<pid>.json ---
export interface SessionMeta {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind: string;
  entrypoint: string;
}

// --- JSONL line structures ---
export interface JsonlToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  caller?: { type: string };
}

export interface JsonlToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: string; text?: string }>;
}

export interface JsonlLine {
  type: string;
  subtype?: string;
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  sessionId: string;
  cwd?: string;
  slug?: string;
  message?: {
    role: 'user' | 'assistant' | 'system';
    content: string | Array<JsonlToolUse | JsonlToolResult | { type: string; text?: string }>;
  };
}

// --- WebSocket event types ---
export type WsEvent =
  | { type: 'agent:update'; agent: AgentState }
  | { type: 'agent:new'; agent: AgentState }
  | { type: 'agent:complete'; id: string }
  | { type: 'activity:log'; agentId: string; action: string; detail: string; timestamp: number }
  | { type: 'snapshot'; agents: AgentState[] };
```

- [ ] **Step 2: Verify types compile**

```bash
cd server && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/types.ts
git commit -m "feat: add shared types for AgentState, JSONL parsing, WebSocket events"
```

---

## Task 3: Session Parser

**Files:**
- Create: `server/src/parsers/session-parser.ts`
- Create: `server/src/parsers/session-parser.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, test, expect } from 'bun:test';
import { parseJsonlLine, toolNameToActivity, extractFileFromToolUse } from './session-parser';

describe('toolNameToActivity', () => {
  test('Read/Grep/Glob map to reading', () => {
    expect(toolNameToActivity('Read')).toBe('reading');
    expect(toolNameToActivity('Grep')).toBe('reading');
    expect(toolNameToActivity('Glob')).toBe('reading');
  });

  test('Edit/Write map to editing', () => {
    expect(toolNameToActivity('Edit')).toBe('editing');
    expect(toolNameToActivity('Write')).toBe('editing');
  });

  test('Bash maps to bash', () => {
    expect(toolNameToActivity('Bash')).toBe('bash');
  });

  test('unknown tool maps to thinking', () => {
    expect(toolNameToActivity('SomeUnknownTool')).toBe('thinking');
  });
});

describe('extractFileFromToolUse', () => {
  test('extracts file_path from Read input', () => {
    expect(extractFileFromToolUse('Read', { file_path: '/src/foo.ts' })).toBe('/src/foo.ts');
  });

  test('extracts command from Bash input', () => {
    expect(extractFileFromToolUse('Bash', { command: 'npm test', description: 'run tests' })).toBe('npm test');
  });

  test('extracts file_path from Edit input', () => {
    expect(extractFileFromToolUse('Edit', { file_path: '/src/bar.ts', old_string: 'a', new_string: 'b' })).toBe('/src/bar.ts');
  });

  test('returns undefined for unknown input', () => {
    expect(extractFileFromToolUse('Skill', { skill: 'foo' })).toBeUndefined();
  });
});

describe('parseJsonlLine', () => {
  test('extracts tool_use from assistant message', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'abc-123',
      parentUuid: null,
      timestamp: '2026-04-15T17:25:51.132Z',
      sessionId: 'sess-1',
      cwd: '/project',
      slug: 'bubbly-waddling-cat',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/src/foo.ts' } },
        ],
      },
    });

    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.toolCalls).toHaveLength(1);
    expect(result!.toolCalls[0].name).toBe('Read');
    expect(result!.activity).toBe('reading');
    expect(result!.slug).toBe('bubbly-waddling-cat');
    expect(result!.file).toBe('/src/foo.ts');
  });

  test('detects git activity from Bash command', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'abc-456',
      parentUuid: null,
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      slug: 'bubbly-waddling-cat',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-2', name: 'Bash', input: { command: 'git commit -m "feat: something"' } },
        ],
      },
    });

    const result = parseJsonlLine(line);
    expect(result!.activity).toBe('git');
  });

  test('returns null for non-assistant lines', () => {
    const line = JSON.stringify({
      type: 'user',
      uuid: 'abc-789',
      parentUuid: null,
      timestamp: '2026-04-15T17:25:00.000Z',
      sessionId: 'sess-1',
      message: { role: 'user', content: 'hello' },
    });

    const result = parseJsonlLine(line);
    expect(result).toBeNull();
  });

  test('detects thinking from text-only assistant messages', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'abc-text',
      parentUuid: null,
      timestamp: '2026-04-15T17:25:00.000Z',
      sessionId: 'sess-1',
      slug: 'bubbly-waddling-cat',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Let me analyze this carefully...' }],
      },
    });

    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.activity).toBe('thinking');
    expect(result!.toolCalls).toHaveLength(0);
  });

  test('handles malformed JSON gracefully', () => {
    const result = parseJsonlLine('not valid json {{{');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && bun test src/parsers/session-parser.test.ts
```

Expected: FAIL — `session-parser.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
import type { AgentActivity, JsonlLine, JsonlToolUse, ToolCall } from '../types';

const TOOL_ACTIVITY_MAP: Record<string, AgentActivity> = {
  Read: 'reading',
  Grep: 'reading',
  Glob: 'reading',
  Edit: 'editing',
  Write: 'editing',
  Bash: 'bash',
  NotebookEdit: 'editing',
};

const GIT_COMMAND_PATTERN = /^git\s+(commit|push|merge|rebase|cherry-pick)/;

export function toolNameToActivity(toolName: string): AgentActivity {
  return TOOL_ACTIVITY_MAP[toolName] ?? 'thinking';
}

export function extractFileFromToolUse(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  if (toolName === 'Bash') {
    const cmd = input['command'];
    return typeof cmd === 'string' ? cmd : undefined;
  }
  const filePath = input['file_path'];
  return typeof filePath === 'string' ? filePath : undefined;
}

export interface ParsedEvent {
  sessionId: string;
  slug: string | undefined;
  timestamp: number;
  activity: AgentActivity;
  toolCalls: ToolCall[];
  file: string | undefined;
  command: string | undefined;
  cwd: string | undefined;
}

export function parseJsonlLine(raw: string): ParsedEvent | null {
  let parsed: JsonlLine;
  try {
    parsed = JSON.parse(raw) as JsonlLine;
  } catch {
    return null;
  }

  if (parsed.type !== 'assistant' || parsed.message?.role !== 'assistant') {
    return null;
  }

  const content = parsed.message.content;
  if (!Array.isArray(content)) {
    return null;
  }

  const toolCalls: ToolCall[] = [];
  let activity: AgentActivity = 'thinking';
  let file: string | undefined;
  let command: string | undefined;

  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;

    if (block.type === 'tool_use') {
      const tu = block as unknown as JsonlToolUse;
      const ts = new Date(parsed.timestamp).getTime();

      toolCalls.push({
        id: tu.id,
        name: tu.name,
        timestamp: ts,
        input: tu.input,
      });

      // Determine activity — git detection overrides Bash
      if (tu.name === 'Bash' && typeof tu.input['command'] === 'string' && GIT_COMMAND_PATTERN.test(tu.input['command'])) {
        activity = 'git';
        command = tu.input['command'];
      } else {
        const mapped = toolNameToActivity(tu.name);
        // Only override if we haven't already set a more specific activity
        if (activity === 'thinking') {
          activity = mapped;
        }
      }

      const extracted = extractFileFromToolUse(tu.name, tu.input);
      if (extracted !== undefined) {
        if (tu.name === 'Bash') {
          command = extracted;
        } else {
          file = extracted;
        }
      }
    }
  }

  return {
    sessionId: parsed.sessionId,
    slug: parsed.slug,
    timestamp: new Date(parsed.timestamp).getTime(),
    activity,
    toolCalls,
    file,
    command,
    cwd: parsed.cwd,
  };
}

/**
 * Parse an entire JSONL file contents and return all events in order.
 */
export function parseSessionFile(contents: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  for (const line of contents.split('\n')) {
    if (line.trim() === '') continue;
    const event = parseJsonlLine(line);
    if (event !== null) {
      events.push(event);
    }
  }
  return events;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && bun test src/parsers/session-parser.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/parsers/session-parser.ts server/src/parsers/session-parser.test.ts
git commit -m "feat: session parser with JSONL line parsing and activity detection"
```

---

## Task 4: Agent State Manager

**Files:**
- Create: `server/src/state/agent-state-manager.ts`
- Create: `server/src/state/agent-state-manager.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, test, expect } from 'bun:test';
import { AgentStateManager } from './agent-state-manager';
import type { ParsedEvent } from '../parsers/session-parser';

function makeEvent(overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    sessionId: 'sess-1',
    slug: 'bubbly-waddling-cat',
    timestamp: Date.now(),
    activity: 'reading',
    toolCalls: [{ id: 'tc-1', name: 'Read', timestamp: Date.now(), input: { file_path: '/foo.ts' } }],
    file: '/foo.ts',
    command: undefined,
    cwd: '/project',
    ...overrides,
  };
}

describe('AgentStateManager', () => {
  test('creates new agent on first event', () => {
    const mgr = new AgentStateManager();
    const result = mgr.processEvent(makeEvent());

    expect(result.isNew).toBe(true);
    expect(result.agent.id).toBe('sess-1');
    expect(result.agent.name).toBe('bubbly-waddling-cat');
    expect(result.agent.status).toBe('active');
    expect(result.agent.currentActivity).toBe('reading');
  });

  test('updates existing agent on subsequent events', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent());

    const result = mgr.processEvent(makeEvent({ activity: 'editing', file: '/bar.ts' }));
    expect(result.isNew).toBe(false);
    expect(result.agent.currentActivity).toBe('editing');
    expect(result.agent.currentFile).toBe('/bar.ts');
  });

  test('assigns hero classes cyclically', () => {
    const mgr = new AgentStateManager();
    const r1 = mgr.processEvent(makeEvent({ sessionId: 'sess-1' }));
    const r2 = mgr.processEvent(makeEvent({ sessionId: 'sess-2', slug: 'another-slug' }));

    expect(r1.agent.heroClass).toBe('warrior');
    expect(r2.agent.heroClass).toBe('mage');
  });

  test('tracks files modified from edit/write tool calls', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({
      activity: 'editing',
      toolCalls: [{ id: 'tc-1', name: 'Edit', timestamp: Date.now(), input: { file_path: '/src/a.ts' } }],
      file: '/src/a.ts',
    }));
    mgr.processEvent(makeEvent({
      activity: 'editing',
      toolCalls: [{ id: 'tc-2', name: 'Write', timestamp: Date.now(), input: { file_path: '/src/b.ts' } }],
      file: '/src/b.ts',
    }));

    const agent = mgr.getAgent('sess-1');
    expect(agent!.filesModified).toContain('/src/a.ts');
    expect(agent!.filesModified).toContain('/src/b.ts');
  });

  test('accumulates tool calls', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent());
    mgr.processEvent(makeEvent({
      toolCalls: [{ id: 'tc-2', name: 'Bash', timestamp: Date.now(), input: { command: 'npm test' } }],
      activity: 'bash',
    }));

    const agent = mgr.getAgent('sess-1');
    expect(agent!.toolCalls).toHaveLength(2);
  });

  test('getAll returns all agents', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent({ sessionId: 'sess-1' }));
    mgr.processEvent(makeEvent({ sessionId: 'sess-2', slug: 'other' }));

    expect(mgr.getAll()).toHaveLength(2);
  });

  test('markCompleted sets status to completed', () => {
    const mgr = new AgentStateManager();
    mgr.processEvent(makeEvent());
    mgr.markCompleted('sess-1');

    const agent = mgr.getAgent('sess-1');
    expect(agent!.status).toBe('completed');
    expect(agent!.currentActivity).toBe('idle');
  });

  test('sets idle after inactivity threshold', () => {
    const mgr = new AgentStateManager();
    const oldTimestamp = Date.now() - 120_000; // 2 minutes ago
    mgr.processEvent(makeEvent({ timestamp: oldTimestamp }));

    mgr.checkIdleAgents(60_000); // 60s threshold
    const agent = mgr.getAgent('sess-1');
    expect(agent!.status).toBe('idle');
    expect(agent!.currentActivity).toBe('idle');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && bun test src/state/agent-state-manager.test.ts
```

Expected: FAIL — file doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
import type { AgentState, HeroClass, ToolCall } from '../types';
import { HERO_CLASSES } from '../types';
import type { ParsedEvent } from '../parsers/session-parser';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

export interface ProcessResult {
  agent: AgentState;
  isNew: boolean;
}

export class AgentStateManager {
  private agents = new Map<string, AgentState>();
  private classIndex = 0;

  processEvent(event: ParsedEvent): ProcessResult {
    const existing = this.agents.get(event.sessionId);

    if (existing === undefined) {
      const agent = this.createAgent(event);
      this.agents.set(event.sessionId, agent);
      return { agent, isNew: true };
    }

    this.updateAgent(existing, event);
    return { agent: existing, isNew: false };
  }

  getAgent(sessionId: string): AgentState | undefined {
    return this.agents.get(sessionId);
  }

  getAll(): AgentState[] {
    return Array.from(this.agents.values());
  }

  markCompleted(sessionId: string): void {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) return;
    agent.status = 'completed';
    agent.currentActivity = 'idle';
  }

  checkIdleAgents(thresholdMs: number): string[] {
    const now = Date.now();
    const idled: string[] = [];

    for (const agent of this.agents.values()) {
      if (agent.status === 'active' && now - agent.lastEvent > thresholdMs) {
        agent.status = 'idle';
        agent.currentActivity = 'idle';
        idled.push(agent.id);
      }
    }

    return idled;
  }

  private nextHeroClass(): HeroClass {
    const cls = HERO_CLASSES[this.classIndex % HERO_CLASSES.length]!;
    this.classIndex++;
    return cls;
  }

  private createAgent(event: ParsedEvent): AgentState {
    const agent: AgentState = {
      id: event.sessionId,
      name: event.slug ?? event.sessionId.slice(0, 8),
      heroClass: this.nextHeroClass(),
      status: 'active',
      currentActivity: event.activity,
      currentFile: event.file,
      currentCommand: event.command,
      tokenUsage: { input: 0, output: 0, cacheRead: 0 },
      cost: 0,
      sessionStart: event.timestamp,
      toolCalls: [...event.toolCalls],
      errors: [],
      filesModified: this.extractModifiedFiles(event),
      lastEvent: event.timestamp,
      cwd: event.cwd ?? '',
    };
    return agent;
  }

  private updateAgent(agent: AgentState, event: ParsedEvent): void {
    agent.status = 'active';
    agent.currentActivity = event.activity;
    agent.currentFile = event.file;
    agent.currentCommand = event.command;
    agent.lastEvent = event.timestamp;
    agent.toolCalls.push(...event.toolCalls);

    if (event.slug !== undefined) {
      agent.name = event.slug;
    }

    for (const f of this.extractModifiedFiles(event)) {
      if (!agent.filesModified.includes(f)) {
        agent.filesModified.push(f);
      }
    }
  }

  private extractModifiedFiles(event: ParsedEvent): string[] {
    const files: string[] = [];
    for (const tc of event.toolCalls) {
      if (EDIT_TOOLS.has(tc.name)) {
        const fp = tc.input['file_path'];
        if (typeof fp === 'string') {
          files.push(fp);
        }
      }
    }
    return files;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && bun test src/state/agent-state-manager.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/state/agent-state-manager.ts server/src/state/agent-state-manager.test.ts
git commit -m "feat: AgentStateManager with cyclic hero class assignment and idle detection"
```

---

## Task 5: File Watcher

**Files:**
- Create: `server/src/watchers/file-watcher.ts`

- [ ] **Step 1: Write the file watcher**

This module uses `node:fs` watch and polling to detect changes. It cannot be unit tested easily (depends on filesystem), so we test it via integration in Task 7.

```typescript
import { watch, readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface WatcherCallbacks {
  onNewSession: (sessionId: string, projectPath: string) => void;
  onSessionUpdate: (sessionId: string, projectPath: string, newContent: string) => void;
}

export class FileWatcher {
  private claudeDir: string;
  private sessionsDir: string;
  private projectsDir: string;
  private fileSizes = new Map<string, number>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private callbacks: WatcherCallbacks;

  constructor(callbacks: WatcherCallbacks) {
    this.claudeDir = join(homedir(), '.claude');
    this.sessionsDir = join(this.claudeDir, 'sessions');
    this.projectsDir = join(this.claudeDir, 'projects');
    this.callbacks = callbacks;
  }

  async start(intervalMs = 2000): Promise<void> {
    // Initial scan
    await this.scan();

    // Poll for changes
    this.pollInterval = setInterval(() => {
      this.scan().catch((err) => {
        console.error('[FileWatcher] scan error:', err);
      });
    }, intervalMs);

    console.log(`[FileWatcher] watching ${this.projectsDir} every ${intervalMs}ms`);
  }

  stop(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async scan(): Promise<void> {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(this.projectsDir);
    } catch {
      return; // ~/.claude/projects/ may not exist yet
    }

    for (const projectDir of projectDirs) {
      const projectPath = join(this.projectsDir, projectDir);
      const projectStat = await stat(projectPath).catch(() => null);
      if (projectStat === null || !projectStat.isDirectory()) continue;

      let files: string[];
      try {
        files = await readdir(projectPath);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;

        const filePath = join(projectPath, file);
        const sessionId = file.replace('.jsonl', '');

        const fileStat = await stat(filePath).catch(() => null);
        if (fileStat === null) continue;

        const previousSize = this.fileSizes.get(filePath);
        const currentSize = fileStat.size;

        if (previousSize === undefined) {
          // New session file
          this.fileSizes.set(filePath, currentSize);
          this.callbacks.onNewSession(sessionId, filePath);
        } else if (currentSize > previousSize) {
          // File grew — read only the new bytes
          const fd = Bun.file(filePath);
          const newBytes = fd.slice(previousSize, currentSize);
          const newContent = await newBytes.text();
          this.fileSizes.set(filePath, currentSize);
          this.callbacks.onSessionUpdate(sessionId, filePath, newContent);
        }
      }
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd server && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/watchers/file-watcher.ts
git commit -m "feat: FileWatcher polling ~/.claude/projects/ for JSONL changes"
```

---

## Task 6: WebSocket Server

**Files:**
- Create: `server/src/ws/websocket-server.ts`

- [ ] **Step 1: Write the WebSocket server**

```typescript
import type { ServerWebSocket } from 'bun';
import type { WsEvent, AgentState } from '../types';

export type WsClient = ServerWebSocket<{ id: string }>;

export class WebSocketServer {
  private clients = new Set<WsClient>();

  handleOpen(ws: WsClient): void {
    this.clients.add(ws);
    console.log(`[WS] client connected (total: ${this.clients.size})`);
  }

  handleClose(ws: WsClient): void {
    this.clients.delete(ws);
    console.log(`[WS] client disconnected (total: ${this.clients.size})`);
  }

  sendSnapshot(ws: WsClient, agents: AgentState[]): void {
    const event: WsEvent = { type: 'snapshot', agents };
    ws.send(JSON.stringify(event));
  }

  broadcastAgentUpdate(agent: AgentState): void {
    this.broadcast({ type: 'agent:update', agent });
  }

  broadcastNewAgent(agent: AgentState): void {
    this.broadcast({ type: 'agent:new', agent });
  }

  broadcastAgentComplete(id: string): void {
    this.broadcast({ type: 'agent:complete', id });
  }

  broadcastActivityLog(agentId: string, action: string, detail: string, timestamp: number): void {
    this.broadcast({ type: 'activity:log', agentId, action, detail, timestamp });
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private broadcast(event: WsEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      client.send(data);
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd server && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/ws/websocket-server.ts
git commit -m "feat: WebSocket server with broadcast and snapshot support"
```

---

## Task 7: Server Entry Point (Wiring Everything Together)

**Files:**
- Create: `server/src/index.ts`

- [ ] **Step 1: Write the entry point**

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AgentStateManager } from './state/agent-state-manager';
import { FileWatcher } from './watchers/file-watcher';
import { parseJsonlLine, parseSessionFile } from './parsers/session-parser';
import { WebSocketServer } from './ws/websocket-server';
import type { WsClient } from './ws/websocket-server';

const PORT = 4444;
const IDLE_THRESHOLD_MS = 60_000; // 1 minute without events → idle

const app = new Hono();
const stateManager = new AgentStateManager();
const wsServer = new WebSocketServer();

// --- CORS for client on :4445 ---
app.use('*', cors({ origin: 'http://localhost:4445' }));

// --- HTTP endpoints ---
app.get('/api/health', (c) => c.json({ status: 'ok', agents: stateManager.getAll().length, clients: wsServer.clientCount }));

app.get('/api/agents', (c) => c.json(stateManager.getAll()));

// --- File watcher callbacks ---
const watcher = new FileWatcher({
  onNewSession: async (sessionId, filePath) => {
    console.log(`[Server] new session: ${sessionId}`);
    // Parse the full file to build initial state
    const file = Bun.file(filePath);
    const contents = await file.text();
    const events = parseSessionFile(contents);

    for (const event of events) {
      const result = stateManager.processEvent(event);
      if (result.isNew) {
        wsServer.broadcastNewAgent(result.agent);
      }
    }

    // Broadcast final state after processing all events
    const agent = stateManager.getAgent(sessionId);
    if (agent !== undefined) {
      wsServer.broadcastAgentUpdate(agent);
    }
  },

  onSessionUpdate: (_sessionId, _filePath, newContent) => {
    for (const line of newContent.split('\n')) {
      if (line.trim() === '') continue;
      const event = parseJsonlLine(line);
      if (event === null) continue;

      const result = stateManager.processEvent(event);

      if (result.isNew) {
        wsServer.broadcastNewAgent(result.agent);
      } else {
        wsServer.broadcastAgentUpdate(result.agent);
      }

      // Broadcast activity log for tool calls
      for (const tc of event.toolCalls) {
        const detail = event.file ?? event.command ?? '';
        wsServer.broadcastActivityLog(event.sessionId, tc.name, detail, tc.timestamp);
      }
    }
  },
});

// --- Idle check interval ---
setInterval(() => {
  const idled = stateManager.checkIdleAgents(IDLE_THRESHOLD_MS);
  for (const sessionId of idled) {
    const agent = stateManager.getAgent(sessionId);
    if (agent !== undefined) {
      wsServer.broadcastAgentUpdate(agent);
    }
  }
}, 30_000);

// --- Start ---
const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    // WebSocket upgrade
    if (new URL(req.url).pathname === '/ws') {
      const id = crypto.randomUUID();
      const upgraded = server.upgrade(req, { data: { id } });
      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // Hono handles HTTP
    return app.fetch(req);
  },
  websocket: {
    open(ws: WsClient) {
      wsServer.handleOpen(ws);
      wsServer.sendSnapshot(ws, stateManager.getAll());
    },
    close(ws: WsClient) {
      wsServer.handleClose(ws);
    },
    message() {
      // Client-to-server messages not needed in Phase 1
    },
  },
});

// Start file watcher
watcher.start(2000);

console.log(`[Server] Agent Quest server running on http://localhost:${PORT}`);
console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/ws`);
console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);
```

- [ ] **Step 2: Start the server and verify**

```bash
cd server && bun run dev
```

Expected output:
```
[FileWatcher] watching /Users/<you>/.claude/projects every 2000ms
[Server] Agent Quest server running on http://localhost:4444
[Server] WebSocket endpoint: ws://localhost:4444/ws
[Server] Health check: http://localhost:4444/api/health
```

- [ ] **Step 3: Test the HTTP endpoints**

In another terminal:

```bash
curl http://localhost:4444/api/health
```

Expected: `{"status":"ok","agents":<number>,"clients":0}`

```bash
curl http://localhost:4444/api/agents
```

Expected: JSON array with agent states (might be empty if no active sessions, or populated if the current Claude Code session is detected).

- [ ] **Step 4: Test WebSocket with a quick script**

Create a temporary test (don't commit):

```bash
cd server && bun -e "
const ws = new WebSocket('ws://localhost:4444/ws');
ws.onopen = () => console.log('Connected!');
ws.onmessage = (e) => { console.log('Event:', JSON.parse(e.data).type); setTimeout(() => ws.close(), 2000); };
ws.onerror = (e) => console.error('Error:', e);
ws.onclose = () => { console.log('Closed'); process.exit(0); };
"
```

Expected:
```
Connected!
Event: snapshot
Closed
```

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat: server entry point wiring Hono, WebSocket, FileWatcher, and StateManager"
```

---

## Task 8: Integration Verification

This task verifies the entire Phase 1 pipeline works end-to-end.

- [ ] **Step 1: Start the server**

```bash
cd server && bun run dev
```

- [ ] **Step 2: Verify this Claude Code session is detected**

In another terminal:

```bash
curl -s http://localhost:4444/api/agents | python3 -m json.tool
```

Expected: at least one agent in the array with:
- `status`: `"active"` or `"idle"`
- `name`: a slug like `"bubbly-waddling-cat"`
- `currentActivity`: one of the valid activities
- `toolCalls`: non-empty array

- [ ] **Step 3: Watch WebSocket events while Claude Code works**

```bash
cd server && bun -e "
const ws = new WebSocket('ws://localhost:4444/ws');
ws.onmessage = (e) => {
  const evt = JSON.parse(e.data);
  if (evt.type === 'snapshot') {
    console.log('Snapshot:', evt.agents.length, 'agents');
    for (const a of evt.agents) console.log('  -', a.name, a.currentActivity, a.status);
  } else {
    console.log(evt.type, evt.agentId ?? evt.agent?.name ?? '', evt.action ?? evt.agent?.currentActivity ?? '');
  }
};
"
```

Let it run while Claude Code is active. Expected: `agent:update` and `activity:log` events streaming in real-time.

- [ ] **Step 4: Run all tests**

```bash
cd server && bun test
```

Expected: all tests pass (parser + state manager tests).

- [ ] **Step 5: Final commit if any fixes were needed**

If you made fixes during integration:

```bash
git add -A server/
git commit -m "fix: integration fixes for Phase 1 server"
```
