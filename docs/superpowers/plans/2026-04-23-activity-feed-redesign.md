# Activity Feed Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Activity Feed bottom panel to use real hero sprites, two view modes (All / By Agent), three fold states (Full / Compact / Closed), action filters, click-to-act behaviors (sprite → camera follow, name → filter, path → editor), persisted preferences in localStorage, and tablet-responsive layout.

**Architecture:** Decompose the current single 62-line component into a small tree of focused files under `client/src/components/`: a container (`ActivityFeed.tsx`), a header (`ActivityFeedHeader.tsx`), a memoized row (`ActivityRow.tsx`), an `AgentGroup.tsx` for the By Agent view, a shared `HeroAvatar.tsx` (also adopted by PartyBar), pure helpers in `activityFeedUtils.ts`, and a `useFeedPrefs` hook. A new `camera:follow` event on the existing `EventBridge` connects clicks in React to camera pans in the Phaser `VillageScene`.

**Tech Stack:** React 19, TypeScript strict, Vite 6, `bun:test` for unit tests, Phaser 4 (scene side only), CSS (no framework — palette already defined in existing CSS).

**Spec:** `docs/superpowers/specs/2026-04-23-activity-feed-redesign-design.md`

**Branch:** `ui-refinements` (already created and checked out).

---

## File Structure

**Create:**
- `client/src/components/HeroAvatar.tsx` — shared sprite-from-theme avatar, 24px default, used by ActivityRow and PartyBar.
- `client/src/components/ActivityFeed.tsx` — container; replaces the existing one (rewrite, not edit).
- `client/src/components/ActivityFeed.css` — full restyle (rewrite).
- `client/src/components/ActivityFeedHeader.tsx` — title, tabs, fold buttons, filter pills.
- `client/src/components/ActivityRow.tsx` — single entry, memoized.
- `client/src/components/AgentGroup.tsx` — group container for By Agent mode.
- `client/src/components/activityFeedUtils.ts` — pure helpers (filtering, grouping, isPath, isError, resolvePath, getAgentNameFallback).
- `client/src/components/activityFeedUtils.test.ts` — bun:test suite for helpers.
- `client/src/hooks/useFeedPrefs.ts` — localStorage-backed preferences hook.
- `client/src/hooks/useFeedPrefs.test.ts` — bun:test suite for prefs hook (logic-only, no DOM).

**Modify:**
- `client/src/components/PartyBar.tsx` — replace inline `<div className="partybar-hero-icon">` with `<HeroAvatar />`.
- `client/src/components/PartyBar.css` — drop the now-unused `.partybar-hero-icon` rules.
- `client/src/game/scenes/VillageScene.ts` — subscribe to `camera:follow`, pan camera to hero.

**No changes needed:**
- `client/src/game/EventBridge.ts` — `camera:follow` is just another event name; the API supports arbitrary strings.
- `client/src/hooks/useAgentState.ts` — feed already gets `log` and `agents` props.
- `client/src/App.tsx` — already passes `log` and `agents` to `<ActivityFeed />`.
- `server/*` — no server changes; the race condition note in the spec is documentation-only.

---

## Task 1: HeroAvatar shared component + PartyBar refactor

**Goal:** Extract the inline sprite rendering currently in `PartyBar.tsx:41-51` into a reusable component, then have PartyBar consume it. No behavior change for PartyBar.

**Files:**
- Create: `client/src/components/HeroAvatar.tsx`
- Modify: `client/src/components/PartyBar.tsx:30-51`
- Modify: `client/src/components/PartyBar.css` (delete `.partybar-hero-icon` block)

- [ ] **Step 1: Create HeroAvatar component**

Write `client/src/components/HeroAvatar.tsx`:

```tsx
import { getActiveTheme } from '../game/themes/registry';
import type { AgentState } from '../types/agent';

interface HeroAvatarProps {
  agent: AgentState;
  size?: number;
  className?: string;
  title?: string;
}

const DEFAULT_SIZE = 24;

export function HeroAvatar({ agent, size = DEFAULT_SIZE, className, title }: HeroAvatarProps) {
  const preview = getActiveTheme().getHeroPreview(agent.heroColor, agent.heroClass);
  const bgWidth = preview.sheetColumns * size;

  return (
    <div
      className={className ?? 'hero-avatar'}
      title={title ?? agent.heroClass}
      role="img"
      aria-label={`${agent.heroClass} ${agent.name}`}
      style={{
        backgroundImage: `url('${preview.url}')`,
        backgroundSize: `${bgWidth}px ${size}px`,
        backgroundPosition: '0 0',
        backgroundRepeat: 'no-repeat',
        width: size,
        height: size,
        imageRendering: 'pixelated',
        flexShrink: 0,
      }}
    />
  );
}
```

- [ ] **Step 2: Refactor PartyBar to use HeroAvatar**

In `client/src/components/PartyBar.tsx`, change the imports and the sprite rendering block.

Replace lines 1-3:

```tsx
import { HeroAvatar } from './HeroAvatar';
import type { AgentState } from '../types/agent';
import './PartyBar.css';
```

Remove the line `import { getActiveTheme } from '../game/themes/registry';` (no longer needed).

Remove the constant `const ICON_SIZE = 24;` (now lives in HeroAvatar).

Replace the entire mapped block (current lines 30-60) with:

```tsx
{displayed.map((agent) => (
  <div
    key={agent.id}
    className={`partybar-agent ${agent.id === selectedAgentId ? 'selected' : ''}`}
    onClick={() => onSelectAgent(agent.id)}
  >
    <HeroAvatar agent={agent} className="partybar-hero-icon" />
    <span className={`partybar-dot ${agent.status}`} />
    <span className="partybar-agent-name">{agent.name}</span>
    <span className="partybar-activity">{agent.currentActivity}</span>
    {agent.lastMessage && (
      <div className="partybar-agent-message">{agent.lastMessage.slice(0, 60)}...</div>
    )}
  </div>
))}
```

- [ ] **Step 3: Clean PartyBar.css**

In `client/src/components/PartyBar.css`, delete the `.partybar-hero-icon` rule entirely (the styling is now inline in HeroAvatar). Keep all other rules. Search for `.partybar-hero-icon` — if any rule sets `width`, `height`, `background-*`, remove it. Keep any rule that sets `margin` or `border-radius` only if PartyBar visually needs it (it doesn't — sprite is square pixel-art, no rounded corners).

- [ ] **Step 4: Build to verify no type errors**

Run from repo root:

```bash
cd client && bunx tsc -b --noEmit
```

Expected: no errors. If TS complains about unused `getActiveTheme` import in PartyBar, remove it.

- [ ] **Step 5: Smoke test in dev server**

Start dev server (in a second terminal):

```bash
cd /Users/Fulvio/Documents/AppDev/Agent\ Quest && bun start
```

Open http://localhost:4445. Verify the Party sidebar still shows hero sprites identical to before. No visual regression.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/HeroAvatar.tsx client/src/components/PartyBar.tsx client/src/components/PartyBar.css
git commit -m "refactor(client): extract HeroAvatar from PartyBar"
```

---

## Task 2: activityFeedUtils — pure helpers with TDD

**Goal:** All filtering/grouping/classification logic as pure functions, fully unit-tested. No React.

**Files:**
- Create: `client/src/components/activityFeedUtils.ts`
- Test: `client/src/components/activityFeedUtils.test.ts`

- [ ] **Step 1: Write failing tests for `isPath`**

Write `client/src/components/activityFeedUtils.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { isPath } from './activityFeedUtils';

describe('isPath', () => {
  it('returns true for absolute path with extension', () => {
    expect(isPath('/Users/foo/src/bar.ts')).toBe(true);
  });

  it('returns true for relative path with extension', () => {
    expect(isPath('src/components/Foo.tsx')).toBe(true);
  });

  it('returns true for dot-leading paths', () => {
    expect(isPath('./scripts/build.sh')).toBe(true);
  });

  it('returns false for plain bash command', () => {
    expect(isPath('git status')).toBe(false);
  });

  it('returns false for grep pattern with quotes', () => {
    expect(isPath('"AgentState" --include=*.ts')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isPath('')).toBe(false);
  });

  it('returns false for command with embedded slash', () => {
    expect(isPath('ls -la /tmp')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd client && bun test src/components/activityFeedUtils.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `isPath`**

Create `client/src/components/activityFeedUtils.ts`:

```ts
/**
 * Heuristic: detail looks like a single file path (not a command).
 * Path-like = starts with `/`, `./`, `../` OR is a single token containing
 * a slash and a recognisable extension. Intentionally conservative — false
 * positives just render a non-functional anchor; false negatives lose styling.
 */
export function isPath(detail: string): boolean {
  if (detail.length === 0) return false;
  if (detail.includes(' ')) return false; // commands have spaces; paths usually don't
  if (detail.startsWith('/') || detail.startsWith('./') || detail.startsWith('../')) {
    return true;
  }
  return /\/[\w.-]+\.[a-zA-Z0-9]+$/.test(detail);
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd client && bun test src/components/activityFeedUtils.test.ts
```

Expected: 7 pass.

- [ ] **Step 5: Add tests for `isError`**

Append to `activityFeedUtils.test.ts`:

```ts
import { isError } from './activityFeedUtils';

describe('isError', () => {
  it('returns true when detail contains "→ exit "', () => {
    expect(isError('Bash', 'npm run build → exit 1')).toBe(true);
  });

  it('returns true when detail starts with "error:"', () => {
    expect(isError('Bash', 'error: command not found')).toBe(true);
  });

  it('returns false for non-Bash actions even with error keyword', () => {
    expect(isError('Read', 'error: file not found')).toBe(false);
  });

  it('returns false for plain Bash success', () => {
    expect(isError('Bash', 'git status')).toBe(false);
  });
});
```

- [ ] **Step 6: Implement `isError`, verify pass**

Append to `activityFeedUtils.ts`:

```ts
/**
 * Heuristic: this entry represents a failed Bash invocation.
 * Bash-only — other tools surface their own errors differently and we don't
 * have structured exit codes in the activity log right now.
 */
export function isError(action: string, detail: string): boolean {
  if (action !== 'Bash') return false;
  if (detail.includes('→ exit ')) return true;
  if (detail.startsWith('error:')) return true;
  return false;
}
```

Run: `cd client && bun test src/components/activityFeedUtils.test.ts` — expect 11 pass.

- [ ] **Step 7: Add tests for `getAgentNameFallback`**

Append to test file:

```ts
import { getAgentNameFallback } from './activityFeedUtils';

describe('getAgentNameFallback', () => {
  it('extracts descriptor from agent-<descriptor>-<hex> id', () => {
    expect(getAgentNameFallback('agent-code-reviewer-abc123def4567890')).toBe('code-reviewer');
  });

  it('returns first 12 chars of rest if no hex match', () => {
    expect(getAgentNameFallback('agent-someweirdformat')).toBe('someweirdfor');
  });

  it('returns first 8 chars for non-agent-prefixed id', () => {
    expect(getAgentNameFallback('abc12345-def6-7890-1234-567890abcdef')).toBe('abc12345');
  });
});
```

- [ ] **Step 8: Implement `getAgentNameFallback`, verify pass**

Append to `activityFeedUtils.ts`:

```ts
/**
 * Race fallback: a log entry can theoretically arrive before its agent:new.
 * Derive a readable name from the id so we don't show "agent-aside_" truncated.
 * Mirror the existing logic from ActivityFeed.tsx pre-redesign — innocuous if
 * the race never fires.
 */
export function getAgentNameFallback(agentId: string): string {
  if (agentId.startsWith('agent-')) {
    const rest = agentId.slice('agent-'.length);
    const m = rest.match(/^(.*?)-([a-f0-9]{16,})$/);
    if (m !== null && m[1] !== undefined && m[1].length > 0) return m[1];
    return rest.slice(0, 12);
  }
  return agentId.slice(0, 8);
}
```

Run: `cd client && bun test src/components/activityFeedUtils.test.ts` — expect 14 pass.

- [ ] **Step 9: Add tests for `resolvePath`**

Append to test file:

```ts
import { resolvePath } from './activityFeedUtils';

describe('resolvePath', () => {
  it('returns absolute path unchanged', () => {
    expect(resolvePath('/Users/foo/bar.ts', '/cwd')).toBe('/Users/foo/bar.ts');
  });

  it('resolves relative path against cwd', () => {
    expect(resolvePath('src/foo.ts', '/Users/me/project')).toBe('/Users/me/project/src/foo.ts');
  });

  it('handles cwd with trailing slash', () => {
    expect(resolvePath('foo.ts', '/Users/me/project/')).toBe('/Users/me/project/foo.ts');
  });

  it('returns null when cwd is undefined and path is relative', () => {
    expect(resolvePath('src/foo.ts', undefined)).toBeNull();
  });

  it('returns null for ~ paths (vscode:// does not handle them)', () => {
    expect(resolvePath('~/notes.md', '/cwd')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(resolvePath('', '/cwd')).toBeNull();
  });
});
```

- [ ] **Step 10: Implement `resolvePath`, verify pass**

Append to `activityFeedUtils.ts`:

```ts
/**
 * Resolve a detail path against an agent's cwd to an absolute path suitable
 * for vscode://file/. Returns null if not resolvable (relative + no cwd, or
 * a ~ path).
 */
export function resolvePath(detail: string, cwd: string | undefined): string | null {
  if (detail.length === 0) return null;
  if (detail.startsWith('~')) return null;
  if (detail.startsWith('/')) return detail;
  if (cwd === undefined || cwd.length === 0) return null;
  const base = cwd.endsWith('/') ? cwd.slice(0, -1) : cwd;
  return `${base}/${detail}`;
}
```

Run: `cd client && bun test src/components/activityFeedUtils.test.ts` — expect 20 pass.

- [ ] **Step 11: Add tests for `filterByAction`**

Append to test file:

```ts
import { filterByAction } from './activityFeedUtils';
import type { ActivityLogEntry } from '../types/agent';

function entry(action: string, detail = ''): ActivityLogEntry {
  return { agentId: 'a', action, detail, timestamp: 1 };
}

describe('filterByAction', () => {
  const log: ActivityLogEntry[] = [
    entry('Read'),
    entry('Edit'),
    entry('Write'),
    entry('Bash', 'git status'),
    entry('Bash', 'npm build → exit 1'),
    entry('Grep'),
    entry('Agent'),
  ];

  it('returns the full log when no filters active', () => {
    expect(filterByAction(log, []).length).toBe(7);
  });

  it('filters to edits', () => {
    const result = filterByAction(log, ['edits']);
    expect(result.map((e) => e.action)).toEqual(['Edit', 'Write']);
  });

  it('filters to bash', () => {
    const result = filterByAction(log, ['bash']);
    expect(result.map((e) => e.action)).toEqual(['Bash', 'Bash']);
  });

  it('filters to reads', () => {
    const result = filterByAction(log, ['reads']);
    expect(result.map((e) => e.action)).toEqual(['Read', 'Grep']);
  });

  it('filters to errors (bash with error markers only)', () => {
    const result = filterByAction(log, ['errors']);
    expect(result.length).toBe(1);
    expect(result[0]!.detail).toBe('npm build → exit 1');
  });

  it('combines filters as union (multiselect)', () => {
    const result = filterByAction(log, ['edits', 'reads']);
    expect(result.map((e) => e.action).sort()).toEqual(['Edit', 'Grep', 'Read', 'Write']);
  });
});
```

- [ ] **Step 12: Implement `filterByAction`, verify pass**

Append to `activityFeedUtils.ts`:

```ts
import type { ActivityLogEntry } from '../types/agent';

export type ActionFilter = 'errors' | 'edits' | 'bash' | 'reads';

const READ_ACTIONS = new Set(['Read', 'Grep', 'Glob']);
const EDIT_ACTIONS = new Set(['Edit', 'Write', 'NotebookEdit']);

function entryMatchesFilter(entry: ActivityLogEntry, filter: ActionFilter): boolean {
  switch (filter) {
    case 'errors': return isError(entry.action, entry.detail);
    case 'edits':  return EDIT_ACTIONS.has(entry.action);
    case 'bash':   return entry.action === 'Bash';
    case 'reads':  return READ_ACTIONS.has(entry.action);
  }
}

export function filterByAction(log: ActivityLogEntry[], filters: ActionFilter[]): ActivityLogEntry[] {
  if (filters.length === 0) return log;
  return log.filter((e) => filters.some((f) => entryMatchesFilter(e, f)));
}
```

Run: `cd client && bun test src/components/activityFeedUtils.test.ts` — expect 26 pass.

- [ ] **Step 13: Add tests for `filterByAgent` and `groupByAgent`**

Append:

```ts
import { filterByAgent, groupByAgent } from './activityFeedUtils';

describe('filterByAgent', () => {
  const log: ActivityLogEntry[] = [
    { agentId: 'a1', action: 'Read', detail: '', timestamp: 1 },
    { agentId: 'a2', action: 'Edit', detail: '', timestamp: 2 },
    { agentId: 'a1', action: 'Bash', detail: '', timestamp: 3 },
  ];

  it('returns log unchanged when filter is null', () => {
    expect(filterByAgent(log, null).length).toBe(3);
  });

  it('keeps only entries for the given agent', () => {
    const result = filterByAgent(log, 'a1');
    expect(result.length).toBe(2);
    expect(result.every((e) => e.agentId === 'a1')).toBe(true);
  });
});

describe('groupByAgent', () => {
  it('groups entries by agentId, ordered by most-recent activity', () => {
    const log: ActivityLogEntry[] = [
      { agentId: 'a1', action: 'Read', detail: 'r1', timestamp: 100 },
      { agentId: 'a2', action: 'Edit', detail: 'e1', timestamp: 200 },
      { agentId: 'a1', action: 'Bash', detail: 'b1', timestamp: 300 },
      { agentId: 'a2', action: 'Read', detail: 'r2', timestamp: 250 },
    ];
    const groups = groupByAgent(log);
    expect(groups.map((g) => g.agentId)).toEqual(['a1', 'a2']);
    expect(groups[0]!.entries.map((e) => e.detail)).toEqual(['b1', 'r1']);
    expect(groups[1]!.entries.map((e) => e.detail)).toEqual(['e1', 'r2']);
  });

  it('returns empty array for empty log', () => {
    expect(groupByAgent([])).toEqual([]);
  });
});
```

- [ ] **Step 14: Implement `filterByAgent` and `groupByAgent`, verify pass**

Append to `activityFeedUtils.ts`:

```ts
export function filterByAgent(log: ActivityLogEntry[], agentId: string | null): ActivityLogEntry[] {
  if (agentId === null) return log;
  return log.filter((e) => e.agentId === agentId);
}

export interface AgentGroup {
  agentId: string;
  entries: ActivityLogEntry[];
  /** timestamp of the most recent entry in the group */
  latestTimestamp: number;
}

export function groupByAgent(log: ActivityLogEntry[]): AgentGroup[] {
  const map = new Map<string, ActivityLogEntry[]>();
  for (const entry of log) {
    let arr = map.get(entry.agentId);
    if (arr === undefined) {
      arr = [];
      map.set(entry.agentId, arr);
    }
    arr.push(entry);
  }
  const groups: AgentGroup[] = [];
  for (const [agentId, entries] of map) {
    groups.push({
      agentId,
      entries,
      latestTimestamp: Math.max(...entries.map((e) => e.timestamp)),
    });
  }
  groups.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  return groups;
}
```

Run: `cd client && bun test src/components/activityFeedUtils.test.ts` — expect 31 pass.

- [ ] **Step 15: Commit**

```bash
git add client/src/components/activityFeedUtils.ts client/src/components/activityFeedUtils.test.ts
git commit -m "feat(client): add activityFeedUtils with filtering, grouping, path resolution"
```

---

## Task 3: useFeedPrefs hook with TDD

**Goal:** A hook that loads/saves Activity Feed preferences in localStorage. Defensive parse, debounced writes, partial updates.

**Files:**
- Create: `client/src/hooks/useFeedPrefs.ts`
- Test: `client/src/hooks/useFeedPrefs.test.ts`

- [ ] **Step 1: Test pure helpers (parse, default, merge)**

Write `client/src/hooks/useFeedPrefs.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { DEFAULT_PREFS, parsePrefs, mergePrefs } from './useFeedPrefs';

describe('parsePrefs', () => {
  it('returns DEFAULT_PREFS for null input', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it('returns DEFAULT_PREFS for malformed JSON', () => {
    expect(parsePrefs('not json {')).toEqual(DEFAULT_PREFS);
  });

  it('returns DEFAULT_PREFS for non-object payload', () => {
    expect(parsePrefs('"a string"')).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('null')).toEqual(DEFAULT_PREFS);
  });

  it('parses a valid full payload', () => {
    const raw = JSON.stringify({
      foldState: 'compact',
      viewMode: 'byAgent',
      activeFilters: ['errors', 'edits'],
      agentFilter: 'a1',
    });
    expect(parsePrefs(raw)).toEqual({
      foldState: 'compact',
      viewMode: 'byAgent',
      activeFilters: ['errors', 'edits'],
      agentFilter: 'a1',
    });
  });

  it('falls back to defaults for invalid enum values', () => {
    const raw = JSON.stringify({
      foldState: 'gigantic',
      viewMode: 'byPlanet',
      activeFilters: ['nonsense', 'edits'],
      agentFilter: null,
    });
    const result = parsePrefs(raw);
    expect(result.foldState).toBe('full');
    expect(result.viewMode).toBe('all');
    expect(result.activeFilters).toEqual(['edits']);
  });
});

describe('mergePrefs', () => {
  it('overlays partial onto base', () => {
    const merged = mergePrefs(DEFAULT_PREFS, { foldState: 'closed' });
    expect(merged.foldState).toBe('closed');
    expect(merged.viewMode).toBe(DEFAULT_PREFS.viewMode);
  });

  it('replaces arrays wholesale', () => {
    const base = { ...DEFAULT_PREFS, activeFilters: ['edits' as const] };
    const merged = mergePrefs(base, { activeFilters: ['bash'] });
    expect(merged.activeFilters).toEqual(['bash']);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd client && bun test src/hooks/useFeedPrefs.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement helpers + hook**

Write `client/src/hooks/useFeedPrefs.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionFilter } from '../components/activityFeedUtils';

export type FoldState = 'full' | 'compact' | 'closed';
export type ViewMode = 'all' | 'byAgent';

export interface FeedPrefs {
  foldState: FoldState;
  viewMode: ViewMode;
  activeFilters: ActionFilter[];
  agentFilter: string | null;
}

export const DEFAULT_PREFS: FeedPrefs = {
  foldState: 'full',
  viewMode: 'all',
  activeFilters: [],
  agentFilter: null,
};

const STORAGE_KEY = 'agentquest:activityFeed:prefs';
const WRITE_DEBOUNCE_MS = 200;

const FOLD_STATES: FoldState[] = ['full', 'compact', 'closed'];
const VIEW_MODES: ViewMode[] = ['all', 'byAgent'];
const FILTERS: ActionFilter[] = ['errors', 'edits', 'bash', 'reads'];

function isFoldState(v: unknown): v is FoldState {
  return typeof v === 'string' && (FOLD_STATES as string[]).includes(v);
}
function isViewMode(v: unknown): v is ViewMode {
  return typeof v === 'string' && (VIEW_MODES as string[]).includes(v);
}
function isFilter(v: unknown): v is ActionFilter {
  return typeof v === 'string' && (FILTERS as string[]).includes(v);
}

export function parsePrefs(raw: string | null): FeedPrefs {
  if (raw === null) return DEFAULT_PREFS;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return DEFAULT_PREFS; }
  if (obj === null || typeof obj !== 'object') return DEFAULT_PREFS;
  const o = obj as Record<string, unknown>;
  return {
    foldState: isFoldState(o.foldState) ? o.foldState : DEFAULT_PREFS.foldState,
    viewMode: isViewMode(o.viewMode) ? o.viewMode : DEFAULT_PREFS.viewMode,
    activeFilters: Array.isArray(o.activeFilters)
      ? o.activeFilters.filter(isFilter)
      : DEFAULT_PREFS.activeFilters,
    agentFilter: typeof o.agentFilter === 'string' ? o.agentFilter : null,
  };
}

export function mergePrefs(base: FeedPrefs, patch: Partial<FeedPrefs>): FeedPrefs {
  return { ...base, ...patch };
}

export function useFeedPrefs(): [FeedPrefs, (patch: Partial<FeedPrefs>) => void] {
  const [prefs, setPrefs] = useState<FeedPrefs>(() => {
    if (typeof window === 'undefined') return DEFAULT_PREFS;
    return parsePrefs(window.localStorage.getItem(STORAGE_KEY));
  });

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      } catch { /* quota or private mode — silently ignore */ }
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    };
  }, [prefs]);

  const update = useCallback((patch: Partial<FeedPrefs>) => {
    setPrefs((prev) => mergePrefs(prev, patch));
  }, []);

  return [prefs, update];
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd client && bun test src/hooks/useFeedPrefs.test.ts
```

Expected: 7 pass.

- [ ] **Step 5: Type-check the hook in context**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: no errors. (The hook is unused so far; tsc will only flag actual type bugs in the file itself.)

- [ ] **Step 6: Commit**

```bash
git add client/src/hooks/useFeedPrefs.ts client/src/hooks/useFeedPrefs.test.ts
git commit -m "feat(client): add useFeedPrefs hook with localStorage persistence"
```

---

## Task 4: ActivityFeedHeader

**Goal:** Render title, tabs (All / By Agent), fold buttons (▭ ▬ ▼), and the second-row filter pills (visible only in Full state). Tabs and pills work; fold buttons emit a callback.

**Files:**
- Create: `client/src/components/ActivityFeedHeader.tsx`

- [ ] **Step 1: Write the component**

Create `client/src/components/ActivityFeedHeader.tsx`:

```tsx
import type { FoldState, ViewMode } from '../hooks/useFeedPrefs';
import type { ActionFilter } from './activityFeedUtils';
import type { AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';

interface ActivityFeedHeaderProps {
  foldState: FoldState;
  viewMode: ViewMode;
  activeFilters: ActionFilter[];
  agentFilter: string | null;
  agents: AgentState[];
  newCount: number;
  onFoldChange: (state: FoldState) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onFiltersChange: (filters: ActionFilter[]) => void;
  onClearAgentFilter: () => void;
}

const ALL_FILTERS: { id: ActionFilter; label: string }[] = [
  { id: 'errors', label: 'Errors' },
  { id: 'edits',  label: 'Edits'  },
  { id: 'bash',   label: 'Bash'   },
  { id: 'reads',  label: 'Reads'  },
];

export function ActivityFeedHeader({
  foldState, viewMode, activeFilters, agentFilter, agents, newCount,
  onFoldChange, onViewModeChange, onFiltersChange, onClearAgentFilter,
}: ActivityFeedHeaderProps) {
  const filteredAgent = agentFilter !== null ? agents.find((a) => a.id === agentFilter) ?? null : null;

  function toggleFilter(id: ActionFilter) {
    if (activeFilters.includes(id)) {
      onFiltersChange(activeFilters.filter((f) => f !== id));
    } else {
      onFiltersChange([...activeFilters, id]);
    }
  }

  const showSecondRow = foldState === 'full';

  return (
    <div className="feed-header">
      <div className="feed-header-row">
        <span className="feed-title">
          Activity Feed
          {foldState === 'closed' && newCount > 0 && (
            <span className="feed-new-badge" aria-live="polite">{newCount} new</span>
          )}
        </span>

        {foldState !== 'closed' && (
          <div className="feed-tabs" role="tablist" aria-label="Feed view mode">
            <button
              role="tab"
              aria-selected={viewMode === 'all'}
              className={`feed-tab ${viewMode === 'all' ? 'active' : ''}`}
              onClick={() => onViewModeChange('all')}
            >All</button>
            <button
              role="tab"
              aria-selected={viewMode === 'byAgent'}
              className={`feed-tab ${viewMode === 'byAgent' ? 'active' : ''}`}
              onClick={() => onViewModeChange('byAgent')}
            >By Agent</button>
          </div>
        )}

        <span className="feed-spacer" />

        <div className="feed-fold-buttons">
          <button
            type="button"
            aria-label="Full"
            aria-pressed={foldState === 'full'}
            className={`feed-fold-btn ${foldState === 'full' ? 'active' : ''}`}
            onClick={() => onFoldChange('full')}
          >▭</button>
          <button
            type="button"
            aria-label="Compact"
            aria-pressed={foldState === 'compact'}
            className={`feed-fold-btn ${foldState === 'compact' ? 'active' : ''}`}
            onClick={() => onFoldChange('compact')}
          >▬</button>
          <button
            type="button"
            aria-label="Close"
            aria-pressed={foldState === 'closed'}
            className={`feed-fold-btn ${foldState === 'closed' ? 'active' : ''}`}
            onClick={() => onFoldChange('closed')}
          >▼</button>
        </div>
      </div>

      {showSecondRow && (
        <div className="feed-header-row feed-filter-row">
          {ALL_FILTERS.map(({ id, label }) => (
            <button
              type="button"
              key={id}
              aria-pressed={activeFilters.includes(id)}
              className={`feed-pill ${id} ${activeFilters.includes(id) ? 'on' : ''}`}
              onClick={() => toggleFilter(id)}
            >{label}</button>
          ))}
          {filteredAgent !== null && (
            <span className="feed-agent-chip">
              <HeroAvatar agent={filteredAgent} size={14} />
              <span>{filteredAgent.name}</span>
              <button type="button" aria-label="Clear agent filter" className="feed-chip-close" onClick={onClearAgentFilter}>×</button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: no errors. The component is unused so far, so only its own types matter.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ActivityFeedHeader.tsx
git commit -m "feat(client): add ActivityFeedHeader with tabs, fold buttons, filter pills"
```

---

## Task 5: ActivityRow (memoized)

**Goal:** A single entry row with click zones (sprite, name, path) and a context menu. Memoized to skip re-renders when props are unchanged.

**Files:**
- Create: `client/src/components/ActivityRow.tsx`

- [ ] **Step 1: Write the component**

Create `client/src/components/ActivityRow.tsx`:

```tsx
import { memo, useCallback, useState } from 'react';
import type { ActivityLogEntry, AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { isError, isPath, resolvePath } from './activityFeedUtils';

interface ActivityRowProps {
  entry: ActivityLogEntry;
  agent: AgentState | undefined;
  agentName: string;
  /** When true, hides the avatar+name (used inside AgentGroup). */
  inGroup?: boolean;
  onSelectAgent: (id: string) => void;
  onFilterAgent: (id: string) => void;
}

interface MenuState {
  x: number;
  y: number;
}

function ActivityRowImpl({ entry, agent, agentName, inGroup, onSelectAgent, onFilterAgent }: ActivityRowProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const error = isError(entry.action, entry.detail);
  const detailIsPath = isPath(entry.detail);
  const absolute = detailIsPath ? resolvePath(entry.detail, agent?.cwd) : null;
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).catch(() => { /* permissions; ignore */ });
    closeMenu();
  }, [closeMenu]);

  return (
    <div className={`feed-entry ${error ? 'is-error' : ''}`} onContextMenu={onContextMenu} role="listitem">
      {!inGroup && agent !== undefined && (
        <button
          type="button"
          className="feed-row-avatar"
          aria-label={`Select agent ${agentName}`}
          onClick={() => onSelectAgent(agent.id)}
        >
          <HeroAvatar agent={agent} />
        </button>
      )}

      <div className="feed-row-body">
        <div className="feed-row-meta">
          {!inGroup && (
            <button
              type="button"
              className="feed-agent-name"
              aria-label={`Filter feed to ${agentName}`}
              onClick={() => agent !== undefined && onFilterAgent(agent.id)}
              title={agentName}
            >{agentName}</button>
          )}
          <span className={`feed-action-pill ${error ? 'is-error' : ''}`}>{entry.action}</span>
          <span className="feed-time">{time}</span>
        </div>
        {detailIsPath && absolute !== null ? (
          <a
            href={`vscode://file${absolute}`}
            className="feed-detail is-path"
            title={entry.detail}
          >{entry.detail}</a>
        ) : (
          <span className={`feed-detail ${detailIsPath ? 'is-path-unresolved' : ''}`} title={entry.detail}>
            {entry.detail}
          </span>
        )}
      </div>

      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          actions={[
            { label: 'Copy path', onClick: () => copy(absolute ?? entry.detail), enabled: detailIsPath },
            { label: 'Copy detail', onClick: () => copy(entry.detail), enabled: true },
            { label: 'Filter to this agent', onClick: () => { if (agent !== undefined) onFilterAgent(agent.id); closeMenu(); }, enabled: agent !== undefined },
          ]}
        />
      )}
    </div>
  );
}

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  actions: { label: string; onClick: () => void; enabled: boolean }[];
}

function ContextMenu({ x, y, onClose, actions }: ContextMenuProps) {
  return (
    <>
      <div className="feed-menu-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <ul className="feed-menu" style={{ left: x, top: y }} role="menu">
        {actions.filter((a) => a.enabled).map((a) => (
          <li key={a.label} role="menuitem">
            <button type="button" onClick={a.onClick}>{a.label}</button>
          </li>
        ))}
      </ul>
    </>
  );
}

export const ActivityRow = memo(ActivityRowImpl, (prev, next) =>
  prev.entry.timestamp === next.entry.timestamp &&
  prev.entry.agentId  === next.entry.agentId  &&
  prev.entry.action   === next.entry.action   &&
  prev.entry.detail   === next.entry.detail   &&
  prev.agentName      === next.agentName      &&
  prev.agent?.id      === next.agent?.id      &&
  prev.agent?.cwd     === next.agent?.cwd     &&
  prev.agent?.heroClass === next.agent?.heroClass &&
  prev.agent?.heroColor === next.agent?.heroColor &&
  prev.inGroup        === next.inGroup
);
```

- [ ] **Step 2: Type-check**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ActivityRow.tsx
git commit -m "feat(client): add ActivityRow with click zones and context menu"
```

---

## Task 6: AgentGroup

**Goal:** In By Agent mode, a group container with a header (sprite + name + activity) and indented entries (no avatar/name per row). Auto-collapses to last 3 entries with `+ N more` expansion.

**Files:**
- Create: `client/src/components/AgentGroup.tsx`

- [ ] **Step 1: Write the component**

Create `client/src/components/AgentGroup.tsx`:

```tsx
import { useState } from 'react';
import type { ActivityLogEntry, AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { ActivityRow } from './ActivityRow';

interface AgentGroupProps {
  agentId: string;
  agent: AgentState | undefined;
  agentName: string;
  entries: ActivityLogEntry[];
  onSelectAgent: (id: string) => void;
  onFilterAgent: (id: string) => void;
}

const COLLAPSED_VISIBLE = 3;

export function AgentGroup({ agentId, agent, agentName, entries, onSelectAgent, onFilterAgent }: AgentGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? entries : entries.slice(0, COLLAPSED_VISIBLE);
  const hidden = entries.length - visible.length;

  return (
    <section className="feed-group" aria-label={`Activity for ${agentName}`}>
      <header className="feed-group-header">
        {agent !== undefined ? (
          <button
            type="button"
            className="feed-group-avatar"
            aria-label={`Select agent ${agentName}`}
            onClick={() => onSelectAgent(agentId)}
          >
            <HeroAvatar agent={agent} />
          </button>
        ) : <span className="feed-group-avatar-placeholder" />}
        <span className="feed-group-name">{agentName}</span>
        {agent !== undefined && (
          <span className="feed-group-activity">· {agent.currentActivity}</span>
        )}
      </header>

      <div className="feed-group-body">
        {visible.map((entry, i) => (
          <ActivityRow
            key={`${entry.timestamp}-${i}`}
            entry={entry}
            agent={agent}
            agentName={agentName}
            inGroup
            onSelectAgent={onSelectAgent}
            onFilterAgent={onFilterAgent}
          />
        ))}
        {hidden > 0 && (
          <button type="button" className="feed-group-more" onClick={() => setExpanded(true)}>
            + {hidden} more
          </button>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/AgentGroup.tsx
git commit -m "feat(client): add AgentGroup for By Agent view mode"
```

---

## Task 7: ActivityFeed container — rewrite

**Goal:** Replace the existing `ActivityFeed.tsx` with the new container that wires the header, the list, the prefs hook, click handlers, and auto-scroll lock. Behavioral changes are observable from this commit.

**Files:**
- Modify: `client/src/components/ActivityFeed.tsx` (full rewrite)

- [ ] **Step 1: Rewrite `ActivityFeed.tsx`**

Replace the entire contents of `client/src/components/ActivityFeed.tsx` with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityLogEntry, AgentState } from '../types/agent';
import { eventBridge } from '../game/EventBridge';
import { useFeedPrefs } from '../hooks/useFeedPrefs';
import { ActivityFeedHeader } from './ActivityFeedHeader';
import { ActivityRow } from './ActivityRow';
import { AgentGroup } from './AgentGroup';
import {
  filterByAction, filterByAgent, groupByAgent, getAgentNameFallback,
} from './activityFeedUtils';
import './ActivityFeed.css';

interface ActivityFeedProps {
  log: ActivityLogEntry[];
  agents: AgentState[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
}

const SCROLL_PIN_THRESHOLD_PX = 8;

export function ActivityFeed({ log, agents, onSelectAgent }: ActivityFeedProps) {
  const [prefs, updatePrefs] = useFeedPrefs();
  const { foldState, viewMode, activeFilters, agentFilter } = prefs;

  const filtered = useMemo(
    () => filterByAgent(filterByAction(log, activeFilters), agentFilter),
    [log, activeFilters, agentFilter],
  );
  const groups = useMemo(
    () => viewMode === 'byAgent' ? groupByAgent(filtered) : null,
    [filtered, viewMode],
  );

  const agentLookup = useMemo(() => {
    const m = new Map<string, AgentState>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  const resolveName = useCallback(
    (agentId: string) => agentLookup.get(agentId)?.name ?? getAgentNameFallback(agentId),
    [agentLookup],
  );

  // --- Auto-scroll lock ---
  const listRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);
  const [newSinceUnpin, setNewSinceUnpin] = useState(0);
  const prevLogLength = useRef(log.length);

  useEffect(() => {
    if (log.length > prevLogLength.current && !pinned) {
      setNewSinceUnpin((n) => n + (log.length - prevLogLength.current));
    }
    prevLogLength.current = log.length;
    if (pinned && listRef.current !== null) {
      listRef.current.scrollTop = 0;
    }
  }, [log, pinned]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (el === null) return;
    const atTop = el.scrollTop <= SCROLL_PIN_THRESHOLD_PX;
    setPinned(atTop);
    if (atTop) setNewSinceUnpin(0);
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = listRef.current;
    if (el !== null) el.scrollTop = 0;
    setPinned(true);
    setNewSinceUnpin(0);
  }, []);

  // --- New badge counter (when closed) ---
  const [newWhileClosed, setNewWhileClosed] = useState(0);
  useEffect(() => {
    if (foldState === 'closed' && log.length > prevLogLength.current) {
      setNewWhileClosed((n) => n + (log.length - prevLogLength.current));
    } else if (foldState !== 'closed') {
      setNewWhileClosed(0);
    }
  }, [log, foldState]);

  // --- Click handlers ---
  const handleSelectAgent = useCallback((id: string) => {
    onSelectAgent(id);
    eventBridge.emit('camera:follow', id);
  }, [onSelectAgent]);

  const handleFilterAgent = useCallback((id: string) => {
    updatePrefs({ agentFilter: id });
  }, [updatePrefs]);

  const clearAgentFilter = useCallback(() => updatePrefs({ agentFilter: null }), [updatePrefs]);

  return (
    <div className={`activity-feed fold-${foldState}`} role="log" aria-live="polite" aria-relevant="additions">
      <ActivityFeedHeader
        foldState={foldState}
        viewMode={viewMode}
        activeFilters={activeFilters}
        agentFilter={agentFilter}
        agents={agents}
        newCount={newWhileClosed}
        onFoldChange={(s) => updatePrefs({ foldState: s })}
        onViewModeChange={(m) => updatePrefs({ viewMode: m })}
        onFiltersChange={(f) => updatePrefs({ activeFilters: f })}
        onClearAgentFilter={clearAgentFilter}
      />

      {foldState !== 'closed' && (
        <div className="feed-list-wrap">
          {!pinned && newSinceUnpin > 0 && (
            <button type="button" className="feed-jump-latest" onClick={jumpToLatest}>
              ↑ Jump to latest ({newSinceUnpin} new)
            </button>
          )}

          <div className="feed-list" role="list" ref={listRef} onScroll={onScroll}>
            {filtered.length === 0 ? (
              <div className="feed-empty">
                <div>Waiting for agent activity...</div>
                <div className="feed-empty-hint">Launch Claude Code in any project — it'll appear here.</div>
              </div>
            ) : viewMode === 'byAgent' && groups !== null ? (
              groups.map((g) => (
                <AgentGroup
                  key={g.agentId}
                  agentId={g.agentId}
                  agent={agentLookup.get(g.agentId)}
                  agentName={resolveName(g.agentId)}
                  entries={g.entries}
                  onSelectAgent={handleSelectAgent}
                  onFilterAgent={handleFilterAgent}
                />
              ))
            ) : (
              filtered.map((entry, i) => (
                <ActivityRow
                  key={`${entry.timestamp}-${i}`}
                  entry={entry}
                  agent={agentLookup.get(entry.agentId)}
                  agentName={resolveName(entry.agentId)}
                  onSelectAgent={handleSelectAgent}
                  onFilterAgent={handleFilterAgent}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx to pass `selectedAgentId` and `onSelectAgent`**

Open `client/src/App.tsx` and find the line that renders `<ActivityFeed log={...} agents={...} />`. Add the two new props (the `selectedAgentId` and `selectAgent` already exist for PartyBar — reuse them). Example:

```tsx
<ActivityFeed
  log={activityLog}
  agents={agents}
  selectedAgentId={selectedAgentId}
  onSelectAgent={selectAgent}
/>
```

If `selectAgent` from `useSelectedAgent()` has signature `(id: string | null) => void` (toggle), wrap it: `onSelectAgent={(id) => selectAgent(id)}` is fine since `string` is assignable to `string | null`.

- [ ] **Step 3: Type-check**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: no errors. The CSS doesn't exist yet — that's fine, CSS imports don't fail TS.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ActivityFeed.tsx client/src/App.tsx
git commit -m "feat(client): rewrite ActivityFeed container with prefs, filters, fold states"
```

---

## Task 8: ActivityFeed.css — full restyle

**Goal:** Replace the old 41-line CSS with the full visual styling matching the spec: 14px font, two-row header, fold states, hero avatars, action pills, error tinting, context menu, agent groups, jump-to-latest button.

**Files:**
- Modify: `client/src/components/ActivityFeed.css` (full rewrite)

- [ ] **Step 1: Rewrite the CSS file**

Replace the entire contents of `client/src/components/ActivityFeed.css` with:

```css
:root {
  --feed-bg: rgba(26, 26, 46, 0.9);
  --feed-border: rgba(196, 163, 90, 0.4);
  --feed-gold: #C4A35A;
  --feed-pergamena: #F5E6C8;
  --feed-blue: #7B9EC4;
  --feed-path: #9ec4f5;
  --feed-error: rgba(139, 37, 0, 0.12);
  --feed-error-strong: #8B2500;
  --feed-row-min-height: 44px;
  --feed-avatar-size: 24px;
}

.activity-feed {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--feed-bg);
  border-top: 1px solid var(--feed-border);
  font-family: 'Fira Code', ui-monospace, monospace;
  font-size: 14px;
  color: var(--feed-pergamena);
  z-index: 25;
  display: flex;
  flex-direction: column;
  transition: height 0.18s ease;
}

.activity-feed.fold-full    { height: 240px; }
.activity-feed.fold-compact { height: 92px;  }
.activity-feed.fold-closed  { height: 32px;  }

/* === Header === */
.feed-header { display: flex; flex-direction: column; flex-shrink: 0; }
.feed-header-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(196, 163, 90, 0.2);
  flex-wrap: nowrap;
}
.feed-filter-row {
  padding: 4px 12px;
  background: rgba(0, 0, 0, 0.15);
  border-bottom: 1px solid rgba(196, 163, 90, 0.15);
  overflow-x: auto;
  scrollbar-width: thin;
}

.feed-title {
  font-family: 'Cinzel', serif;
  color: var(--feed-gold);
  font-size: 14px;
  font-weight: bold;
  letter-spacing: 0.5px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.feed-new-badge {
  background: var(--feed-gold);
  color: #1a1a2e;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: bold;
  font-family: 'Fira Code', monospace;
  animation: feed-pulse 1.6s ease-in-out infinite;
}
@keyframes feed-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}

.feed-spacer { flex: 1; }

.feed-tabs {
  display: flex;
  gap: 2px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 4px;
  padding: 2px;
}
.feed-tab {
  padding: 3px 10px;
  font-size: 12px;
  color: var(--feed-pergamena);
  opacity: 0.6;
  border: none;
  background: transparent;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
}
.feed-tab.active {
  background: rgba(196, 163, 90, 0.3);
  color: #fff;
  opacity: 1;
  font-weight: bold;
}

.feed-fold-buttons { display: flex; gap: 4px; }
.feed-fold-btn {
  width: 26px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(196, 163, 90, 0.12);
  border: 1px solid rgba(196, 163, 90, 0.25);
  border-radius: 3px;
  color: var(--feed-pergamena);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.feed-fold-btn.active {
  background: rgba(196, 163, 90, 0.3);
  border-color: rgba(196, 163, 90, 0.6);
}
.feed-fold-btn:focus-visible {
  outline: 2px solid var(--feed-gold);
  outline-offset: 1px;
}

.feed-pill {
  padding: 2px 9px;
  border-radius: 10px;
  font-size: 11px;
  background: rgba(123, 158, 196, 0.15);
  color: #9bb5d6;
  border: 1px solid rgba(123, 158, 196, 0.3);
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.feed-pill.on {
  background: rgba(196, 163, 90, 0.3);
  color: #fff;
  border-color: var(--feed-gold);
  font-weight: bold;
}
.feed-pill.errors    { background: rgba(139, 37, 0, 0.18); color: #ffaaaa; border-color: rgba(139, 37, 0, 0.5); }
.feed-pill.errors.on { background: rgba(139, 37, 0, 0.4);  color: #fff;    border-color: var(--feed-error-strong); }

.feed-agent-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(196, 163, 90, 0.2);
  border: 1px solid rgba(196, 163, 90, 0.4);
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--feed-pergamena);
}
.feed-chip-close {
  background: none; border: none; color: var(--feed-pergamena);
  opacity: 0.6; cursor: pointer; font-size: 14px; line-height: 1;
  padding: 0 2px; font-family: inherit;
}
.feed-chip-close:hover { opacity: 1; }

/* === List === */
.feed-list-wrap {
  flex: 1;
  position: relative;
  min-height: 0;
}
.feed-list {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(196, 163, 90, 0.4) transparent;
}
.feed-list::-webkit-scrollbar { width: 6px; }
.feed-list::-webkit-scrollbar-thumb { background: rgba(196, 163, 90, 0.4); border-radius: 3px; }
.feed-list::-webkit-scrollbar-track { background: transparent; }

.feed-jump-latest {
  position: absolute;
  top: 6px;
  left: 12px;
  z-index: 2;
  background: var(--feed-gold);
  color: #1a1a2e;
  border: none;
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: bold;
  cursor: pointer;
  font-family: inherit;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

/* === Entry === */
.feed-entry {
  display: grid;
  grid-template-columns: var(--feed-avatar-size) minmax(0, 1fr);
  gap: 12px;
  padding: 6px 14px;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  position: relative;
  animation: feed-fade-in 0.2s ease-out;
}
@media (prefers-reduced-motion: reduce) {
  .feed-entry { animation: none; }
}
@keyframes feed-fade-in {
  from { opacity: 0; transform: translateY(-2px); }
  to   { opacity: 1; transform: none; }
}
.feed-entry.is-error { background: var(--feed-error); }

.feed-row-avatar {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  display: inline-block;
  line-height: 0;
}
.feed-row-avatar:focus-visible {
  outline: 2px solid var(--feed-gold);
  outline-offset: 2px;
  border-radius: 3px;
}

.feed-row-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.feed-row-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
}
.feed-agent-name {
  background: none; border: none; padding: 0; cursor: pointer;
  color: var(--feed-gold);
  font-weight: bold;
  font-family: inherit;
  font-size: 12px;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.feed-agent-name:hover { text-decoration: underline; }

.feed-action-pill {
  background: rgba(123, 158, 196, 0.2);
  color: var(--feed-blue);
  padding: 0 6px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.feed-action-pill.is-error {
  background: rgba(139, 37, 0, 0.4);
  color: #ffaaaa;
}

.feed-time {
  color: #888;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

.feed-detail {
  font-size: 14px;
  color: var(--feed-pergamena);
  opacity: 0.95;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-decoration: none;
  display: block;
}
.feed-detail.is-path { color: var(--feed-path); }
.feed-detail.is-path:hover { text-decoration: underline; color: #fff; }
.feed-detail.is-path-unresolved { color: var(--feed-path); opacity: 0.7; }

/* === Group (By Agent) === */
.feed-group {
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.feed-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: rgba(196, 163, 90, 0.06);
  border-bottom: 1px dashed rgba(196, 163, 90, 0.25);
}
.feed-group-avatar {
  background: none; border: none; padding: 0; cursor: pointer; line-height: 0;
}
.feed-group-name {
  color: var(--feed-gold);
  font-weight: bold;
  font-family: 'Cinzel', serif;
  font-size: 13px;
}
.feed-group-activity {
  color: var(--feed-blue);
  font-size: 11px;
  opacity: 0.8;
}
.feed-group-body { padding: 2px 0 4px 16px; }
.feed-group-more {
  background: none; border: none;
  color: var(--feed-blue);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  padding: 4px 30px;
}
.feed-group-more:hover { text-decoration: underline; }

/* === Empty state === */
.feed-empty {
  text-align: center;
  padding: 24px 14px;
  color: #666;
}
.feed-empty-hint {
  font-size: 11px;
  margin-top: 4px;
  opacity: 0.8;
}

/* === Context menu === */
.feed-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
}
.feed-menu {
  position: fixed;
  z-index: 101;
  background: rgba(26, 26, 46, 0.98);
  border: 1px solid var(--feed-border);
  border-radius: 4px;
  padding: 4px 0;
  margin: 0;
  list-style: none;
  min-width: 180px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  font-family: inherit;
  font-size: 12px;
}
.feed-menu li button {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 6px 14px;
  color: var(--feed-pergamena);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}
.feed-menu li button:hover {
  background: rgba(196, 163, 90, 0.2);
}

/* === Responsive (tablet portrait and below) === */
@media (max-width: 600px) {
  .activity-feed.fold-full    { height: 220px; }
  .feed-filter-row {
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .feed-agent-name { max-width: 90px; }
  .feed-row-meta { font-size: 10px; }
  .feed-detail { font-size: 13px; }
  .feed-time { font-size: 10px; }
}
```

- [ ] **Step 2: Smoke test in dev server**

```bash
cd /Users/Fulvio/Documents/AppDev/Agent\ Quest && bun start
```

Open http://localhost:4445. With at least one Claude Code session active locally (or accept empty state for visual check):

- Verify the bottom bar shows the new header (title · tabs · fold buttons).
- Verify font is visibly larger (14px vs 10px).
- Verify clicking ▭/▬/▼ resizes the panel; reload preserves the state.
- Verify clicking `By Agent` rearranges entries.
- Verify clicking a filter pill (e.g., `Bash`) reduces the list.
- Verify clicking on an agent's name adds the chip in the second header row; clicking × removes it.
- Verify hovering an entry shows the avatar; right-clicking shows the context menu.
- Verify resize browser to ~500px wide: header stays usable; pills scroll horizontally.

If anything looks broken, fix CSS inline (don't add a new task) before committing.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ActivityFeed.css
git commit -m "style(client): full restyle of ActivityFeed for new layout"
```

---

## Task 9: EventBridge `camera:follow` + Phaser scene subscriber

**Goal:** When `eventBridge.emit('camera:follow', agentId)` fires, the Phaser camera pans to that hero. No EventBridge code change needed — it accepts arbitrary event names.

**Files:**
- Modify: `client/src/game/scenes/VillageScene.ts` (add a single subscriber in `create()`)

- [ ] **Step 1: Locate the right spot in VillageScene**

Read `client/src/game/scenes/VillageScene.ts` around the existing `create()` method (search for `this.cameras.main.setBounds`). The subscription belongs near the other event-bridge listeners or at the end of camera setup.

If there are no existing `eventBridge.on(...)` calls in the scene, add them next to the camera setup. Look for the existing `eventBridge.emit('village:ready')` (mentioned in App.tsx) — there should be a corresponding `eventBridge` import or one to add.

- [ ] **Step 2: Add the subscriber**

At the top of `VillageScene.ts`, ensure `eventBridge` is imported:

```ts
import { eventBridge } from '../EventBridge';
```

(Adjust the relative path if needed — from `scenes/`, it's `'../EventBridge'`.)

In the `create()` method, after `this.cameras.main.centerToBounds();`, add:

```ts
const onCameraFollow = (agentId: unknown) => {
  if (typeof agentId !== 'string') return;
  const hero = this.heroes.get(agentId);
  if (hero === undefined) return;
  this.cameras.main.pan(hero.x, hero.y, 600, 'Sine.easeInOut');
};
eventBridge.on('camera:follow', onCameraFollow as (...args: unknown[]) => void);

this.events.once('shutdown', () => {
  eventBridge.off('camera:follow', onCameraFollow as (...args: unknown[]) => void);
});
this.events.once('destroy', () => {
  eventBridge.off('camera:follow', onCameraFollow as (...args: unknown[]) => void);
});
```

The cast is needed because `EventBridge`'s listener type is `(...args: unknown[]) => void` but our callback takes a single typed arg.

- [ ] **Step 3: Type-check**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 4: Smoke test**

In dev server: with a session active (so a hero is on the map), click on an avatar in the Activity Feed. The Phaser camera should pan toward that hero over ~600ms. Click another avatar — pans there. Click on an unknown agent (none exists) — no error in console.

- [ ] **Step 5: Commit**

```bash
git add client/src/game/scenes/VillageScene.ts
git commit -m "feat(client): pan Phaser camera on camera:follow event from feed"
```

---

## Task 10: Final pass — accessibility, cleanup, README

**Goal:** Verify all acceptance criteria one final time and tidy up.

**Files:**
- No new files. May touch any of the above for cleanup.

- [ ] **Step 1: Run full type check + tests**

```bash
cd client && bunx tsc -b --noEmit && bun test
```

Expected: TS clean; bun tests show all pass (existing 10 + ~31 from utils + 7 from prefs ≈ 48 pass).

- [ ] **Step 2: Stress test manually**

Start dev server. Open the app. Use the existing CLAUDE-Code session(s) you have running, or launch 2-3 fresh ones in different directories. Open the browser DevTools → Performance tab. Record 30s of activity while the feed receives events. Verify:
- Frame rate stays smooth (no obvious stutter).
- The "Components" tab in React DevTools (if installed) shows `ActivityRow` doesn't re-render when its props haven't changed (use the highlight-renders option).

If you observe re-renders on unchanged rows, double-check the `memo` comparator in `ActivityRow.tsx` — every prop the component reads must be in the comparison.

- [ ] **Step 3: Walk through acceptance criteria**

Open `docs/superpowers/specs/2026-04-23-activity-feed-redesign-design.md`, scroll to "Acceptance criteria", and tick each one mentally against the running app:

1. 14px font ✓
2. Three fold states cycle, persist on reload
3. All / By Agent toggle works, persists
4. Filter pills (multiselect) reduce visible set
5. Click sprite → selects agent + camera pans
6. Click agent name → chip appears
7. Click blue path → opens VS Code (if installed and `vscode://` registered; otherwise nothing happens silently — acceptable per spec)
8. Right-click row → context menu with Copy path / Copy detail / Filter to this agent
9. Auto-scroll lock + Jump to latest button
10. Empty state visible when no events
11. <600px viewport: header collapses, no horizontal scroll
12. `aria-live="polite"`, sprite buttons keyboard-focusable (Tab through, Enter activates)
13. With several agents emitting events, no row re-renders unnecessarily

If any fail, fix in place — don't add new tasks unless the gap is structural.

- [ ] **Step 4: Final commit (if any cleanup needed)**

```bash
git add -A
git status   # confirm only intended files
git commit -m "chore(client): final cleanup for activity feed redesign"
```

(Skip if there are no changes — empty commits are useless.)

- [ ] **Step 5: Verify branch state**

```bash
git log --oneline main..HEAD
```

Expected: ~10 commits on `ui-refinements` ahead of `main`. Each one self-contained.

---

## Self-Review

**Spec coverage:**
- 14px font → Task 8 (CSS). ✓
- Three fold states + buttons → Tasks 4, 7, 8. ✓
- Two view modes (All / By Agent) → Tasks 4, 6, 7. ✓
- Filter pills (multiselect, errors/edits/bash/reads) → Tasks 2 (logic), 4 (UI), 8 (CSS). ✓
- Agent filter chip → Tasks 4, 7, 8. ✓
- Real hero sprites via `getHeroPreview` → Task 1 (HeroAvatar) used in 4, 5, 6. ✓
- Context menu (Copy path / Copy detail / Filter to this agent) → Task 5. ✓
- Click behaviors per spec table → Task 5 (sprite, name, path), Task 9 (camera follow). ✓
- Path resolution against agent.cwd → Task 2 (`resolvePath`). ✓
- Auto-scroll lock + Jump to latest → Task 7. ✓
- Empty state → Task 7 (rendering) + Task 8 (style). ✓
- Closed state with `N new` badge → Task 4 (rendering) + Task 8 (animation). ✓
- localStorage persistence → Task 3. ✓
- React.memo on rows → Task 5. ✓
- Responsive <600px → Task 8 (media query). ✓
- Accessibility (role=log, aria-live, button elements, focus-visible) → Tasks 4, 5, 6, 7, 8. ✓
- Race fallback `getAgentNameFallback` → Task 2. ✓
- HeroAvatar shared with PartyBar → Task 1. ✓
- VS Code anchor (not window.open) → Task 5. ✓

**Placeholder scan:** none found.

**Type consistency:**
- `FoldState`, `ViewMode`, `ActionFilter`, `FeedPrefs` defined in `useFeedPrefs.ts` and reused identically in Tasks 4, 5, 7. ✓
- `ActivityLogEntry`, `AgentState` from `../types/agent` (existing, unchanged). ✓
- `getAgentNameFallback`, `filterByAction`, `filterByAgent`, `groupByAgent`, `isPath`, `isError`, `resolvePath` — all consumed in Tasks 5, 6, 7 with the signatures defined in Task 2. ✓
- `HeroAvatar` props (`agent`, `size?`, `className?`, `title?`) consistent across PartyBar refactor (Task 1) and feed components (Tasks 4, 5, 6). ✓
- `eventBridge.on('camera:follow', listener)` matches the listener signature `(...args: unknown[]) => void`; the cast in Task 9 is explicit. ✓

No issues found.
