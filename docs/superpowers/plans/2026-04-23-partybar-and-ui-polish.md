# PartyBar Redesign + Cross-Component UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix avatar rendering across components, redesign PartyBar with fold states / 40px avatars / camera follow / selection highlight with flash, wire scene-level hero clicks into the shared selection state, and convert Activity Feed filter pills from hide-filter semantics to auto-detected highlight semantics with **seven categories** (errors, edits, bash, reads, messages, agent, other) and per-pill counters.

**Architecture:** A single `selectedAgentId` in `App.tsx` is the one source of truth. Three sources (Phaser hero click → `eventBridge.emit('hero:clicked')`, PartyBar row click, ActivityFeed avatar click) all funnel to `handleSelectAgent` (toggle semantics). `App.tsx` emits `selection:changed` on every change; `VillageScene` listens to paint an outline on the selected hero; the `ActivityFeed` receives `selectedAgentId` as a prop to highlight matching rows. Feed pills shift from filter to highlight: rows are never hidden, the pills tint matching rows and show counters derived from the log.

**Tech Stack:** React 19 strict-TS, Vite 6, `bun:test`, Phaser 4, CSS. All patterns established in the prior UI pass (`ui-refinements` branch).

**Spec:** `docs/superpowers/specs/2026-04-23-partybar-and-ui-polish-design.md`

**Branch:** `ui-refinements` (continuing — do NOT switch branches).

**Pre-existing manual changes (preserve, do NOT revert):**
- `client/src/components/activityFeedUtils.ts` already has `ActionFilter` including `'messages'` and a `MESSAGE_ACTIONS = Set(['Reply', 'Prompt'])` constant. Task 2 builds on top of this.
- `client/src/hooks/useFeedPrefs.ts` already has `FILTERS = [..., 'messages']`. Task 3 builds on top.
- `client/src/components/ActivityFeedHeader.tsx` already lists `Messages` as a pill (filter semantics — Task 5 converts to highlight).
- `client/src/components/ActivityRow.tsx` has `is-message`, `is-reply`, `is-prompt` class rendering for `Reply`/`Prompt` actions. Task 6 preserves that and adds `highlighted`/`isSelected`.
- `client/src/components/AgentGroup.tsx` uses `HERO_LABEL_COLOR[agent.heroColor]` from `../types/agent` to tint the group-name span. Task 7 preserves this styling.
- `client/src/components/ActivityFeed.css` already has `.feed-detail { font-size: 16px }` (user-tuned). Task 9 appends rules only — does NOT revert existing styling.

---

## File Structure

**Create:**
- `client/src/hooks/usePartyPrefs.ts` — persistent prefs for PartyBar (fold state).
- `client/src/hooks/usePartyPrefs.test.ts` — bun:test suite.

**Modify:**
- `client/src/game/themes/types.ts` — add `sheetRows` to `HeroPreview`.
- `client/src/game/themes/tiny-swords-cc0.ts` — populate `sheetRows`.
- `client/src/components/HeroAvatar.tsx` — use `sheetRows`.
- `client/src/components/activityFeedUtils.ts` — expand `ActionFilter` to 7 categories, add `categorizeEntry`, add `detectCategories`.
- `client/src/components/activityFeedUtils.test.ts` — new tests.
- `client/src/hooks/useFeedPrefs.ts` — rename `activeFilters` → `activeHighlights` with backwards-compat, update `FILTERS` to 7 values.
- `client/src/hooks/useFeedPrefs.test.ts` — update for rename.
- `client/src/components/ActivityFeedHeader.tsx` — auto-detected pills with counters, highlight semantics.
- `client/src/components/ActivityRow.tsx` — new `highlighted` + `isSelected` props, preserve `is-message` rendering.
- `client/src/components/AgentGroup.tsx` — propagate `activeHighlights` + `selectedAgentId`.
- `client/src/components/ActivityFeed.tsx` — drop filter-by-action call, compute `availableCategories`, pass highlights + selection.
- `client/src/components/ActivityFeed.css` — append highlight + selection styles.
- `client/src/components/PartyBar.tsx` — full rewrite.
- `client/src/components/PartyBar.css` — full restyle.
- `client/src/game/scenes/VillageScene.ts` — hero click + `selection:changed` listener.
- `client/src/game/entities/HeroSprite.ts` — public methods for interaction + selection tint.
- `client/src/App.tsx` — wire `hero:clicked`, emit `selection:changed`, pass `selectedAgentId`.

---

## Task 1: HeroAvatar fix — `sheetRows` across types, theme, component

**Files:**
- Modify: `client/src/game/themes/types.ts`
- Modify: `client/src/game/themes/tiny-swords-cc0.ts`
- Modify: `client/src/components/HeroAvatar.tsx`

- [ ] **Step 1: Add `sheetRows` to `HeroPreview`**

Open `client/src/game/themes/types.ts`, find `export interface HeroPreview`, and update:

```ts
export interface HeroPreview {
  url: string;
  sheetColumns: number;
  sheetRows: number;
  frameWidth?: number;
  frameHeight?: number;
}
```

- [ ] **Step 2: Inspect theme spec to find row counts**

Open `client/src/game/themes/tiny-swords-cc0.ts`. Find the `SHEET_SPEC` constant that `getHeroPreview` reads from. Look for the property that tells how many rows each spritesheet has. Common names: `sheetRows`, `rows`, or a total frame count divisible by `sheetCols`. For Tiny Swords CC0, hero sheets typically have 5 rows (idle/run/attack/hurt/death) but verify per class.

If `sheetRows` isn't already present in `SHEET_SPEC`, add it per class with verified values. For pawn/warrior/knight/archer variants, inspect the asset file dimensions (height / frameHeight).

Report findings before modifying.

- [ ] **Step 3: Populate `sheetRows` in `getHeroPreview`**

In the same file, update `getHeroPreview` (around line 168) to include `sheetRows`:

```ts
getHeroPreview(color: UnitColor, unit: UnitType): HeroPreview {
  const spec = SHEET_SPEC[resolveUnit(unit)];
  return {
    url: `/${filePath(color, unit)}`,
    sheetColumns: spec.sheetCols,
    sheetRows: spec.sheetRows,
    frameWidth: 192,
    frameHeight: 192,
  };
},
```

- [ ] **Step 4: Update `HeroAvatar.tsx`**

Replace the body of `client/src/components/HeroAvatar.tsx`:

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
  const bgHeight = preview.sheetRows * size;

  return (
    <div
      className={className}
      title={title ?? agent.heroClass}
      role="img"
      aria-label={`${agent.heroClass} ${agent.name}`}
      style={{
        backgroundImage: `url('${preview.url}')`,
        backgroundSize: `${bgWidth}px ${bgHeight}px`,
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

- [ ] **Step 5: Type check**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: clean. If another theme implementation fails, update it too (at time of writing only `tiny-swords-cc0.ts` implements `getHeroPreview`).

- [ ] **Step 6: Commit**

```bash
git add client/src/game/themes/types.ts client/src/game/themes/tiny-swords-cc0.ts client/src/components/HeroAvatar.tsx
git commit -m "fix(client): HeroAvatar uses sheetRows so only first idle frame renders"
```

---

## Task 2: activityFeedUtils — expand to 7 categories, add `categorizeEntry` + `detectCategories`

**Files:**
- Modify: `client/src/components/activityFeedUtils.ts`
- Modify: `client/src/components/activityFeedUtils.test.ts`

Note: the file already has `ActionFilter = 'errors' | 'edits' | 'bash' | 'reads' | 'messages'` and the `MESSAGE_ACTIONS` set (from manual edits). This task expands it to 7 (adds `agent` and `other`) and introduces `categorizeEntry` + `detectCategories`.

- [ ] **Step 1: Write failing tests for `categorizeEntry`**

Append to `client/src/components/activityFeedUtils.test.ts`:

```ts
import { categorizeEntry } from './activityFeedUtils';

describe('categorizeEntry', () => {
  it('classifies Bash error as errors', () => {
    expect(categorizeEntry('Bash', 'npm run build → exit 1')).toBe('errors');
  });

  it('classifies Edit/Write/NotebookEdit as edits', () => {
    expect(categorizeEntry('Edit', 'src/foo.ts')).toBe('edits');
    expect(categorizeEntry('Write', 'src/bar.ts')).toBe('edits');
    expect(categorizeEntry('NotebookEdit', 'foo.ipynb')).toBe('edits');
  });

  it('classifies plain Bash as bash', () => {
    expect(categorizeEntry('Bash', 'git status')).toBe('bash');
  });

  it('classifies Read/Grep/Glob as reads', () => {
    expect(categorizeEntry('Read', 'src/foo.ts')).toBe('reads');
    expect(categorizeEntry('Grep', '"AgentState"')).toBe('reads');
    expect(categorizeEntry('Glob', '**/*.ts')).toBe('reads');
  });

  it('classifies Reply/Prompt as messages', () => {
    expect(categorizeEntry('Reply', 'Hello')).toBe('messages');
    expect(categorizeEntry('Prompt', 'Please do X')).toBe('messages');
  });

  it('classifies Agent as agent', () => {
    expect(categorizeEntry('Agent', 'subagent-general')).toBe('agent');
  });

  it('classifies anything else as other', () => {
    expect(categorizeEntry('TodoWrite', '')).toBe('other');
    expect(categorizeEntry('Thinking', '...')).toBe('other');
    expect(categorizeEntry('WebFetch', 'https://example.com')).toBe('other');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd client && bun test src/components/activityFeedUtils.test.ts
```

Expected: FAIL — `categorizeEntry` not exported (and the `'agent'`/`'other'` values don't exist in `ActionFilter` yet).

- [ ] **Step 3: Expand `ActionFilter` and implement `categorizeEntry`**

Open `client/src/components/activityFeedUtils.ts`. Replace the existing line:

```ts
export type ActionFilter = 'errors' | 'edits' | 'bash' | 'reads' | 'messages';
```

with:

```ts
export type ActionFilter = 'errors' | 'edits' | 'bash' | 'reads' | 'messages' | 'agent' | 'other';
```

`MESSAGE_ACTIONS`, `READ_ACTIONS`, `EDIT_ACTIONS` stay unchanged.

Below those constants, add the new helper:

```ts
export function categorizeEntry(action: string, detail: string): ActionFilter {
  if (isError(action, detail)) return 'errors';
  if (EDIT_ACTIONS.has(action)) return 'edits';
  if (action === 'Bash') return 'bash';
  if (READ_ACTIONS.has(action)) return 'reads';
  if (MESSAGE_ACTIONS.has(action)) return 'messages';
  if (action === 'Agent') return 'agent';
  return 'other';
}
```

Update `entryMatchesFilter` to delegate to `categorizeEntry` (one source of truth):

```ts
function entryMatchesFilter(entry: ActivityLogEntry, filter: ActionFilter): boolean {
  return categorizeEntry(entry.action, entry.detail) === filter;
}
```

This replaces the explicit switch; `filterByAction` is unchanged.

- [ ] **Step 4: Run tests to verify pass**

```bash
cd client && bun test src/components/activityFeedUtils.test.ts
```

Expected: all previous tests still pass, plus the 7 new `categorizeEntry` tests.

- [ ] **Step 5: Write failing tests for `detectCategories`**

Append to `activityFeedUtils.test.ts`:

```ts
import { detectCategories } from './activityFeedUtils';
import type { ActionFilter } from './activityFeedUtils';

describe('detectCategories', () => {
  it('returns empty set and zero counts for empty log', () => {
    const { categories, counts } = detectCategories([]);
    expect(categories.size).toBe(0);
    expect(counts.errors).toBe(0);
    expect(counts.edits).toBe(0);
    expect(counts.bash).toBe(0);
    expect(counts.reads).toBe(0);
    expect(counts.messages).toBe(0);
    expect(counts.agent).toBe(0);
    expect(counts.other).toBe(0);
  });

  it('includes only categories actually present, with counts', () => {
    const log = [
      { agentId: 'a', action: 'Read',   detail: 'foo.ts',           timestamp: 1 },
      { agentId: 'a', action: 'Read',   detail: 'bar.ts',           timestamp: 2 },
      { agentId: 'a', action: 'Agent',  detail: 'sub',              timestamp: 3 },
      { agentId: 'a', action: 'Bash',   detail: 'npm → exit 1',     timestamp: 4 },
      { agentId: 'a', action: 'Reply',  detail: 'Done',             timestamp: 5 },
    ];
    const { categories, counts } = detectCategories(log);
    const sortedCats = [...categories].sort();
    expect(sortedCats).toEqual(['agent', 'errors', 'messages', 'reads'] as ActionFilter[]);
    expect(counts.reads).toBe(2);
    expect(counts.agent).toBe(1);
    expect(counts.errors).toBe(1);
    expect(counts.messages).toBe(1);
    expect(counts.bash).toBe(0);
    expect(counts.edits).toBe(0);
    expect(counts.other).toBe(0);
  });

  it('puts unknown actions into other', () => {
    const { categories, counts } = detectCategories([
      { agentId: 'a', action: 'TodoWrite', detail: '', timestamp: 1 },
      { agentId: 'a', action: 'Thinking',  detail: '', timestamp: 2 },
    ]);
    expect([...categories]).toEqual(['other']);
    expect(counts.other).toBe(2);
  });
});
```

- [ ] **Step 6: Run tests to verify failure**

```bash
cd client && bun test src/components/activityFeedUtils.test.ts
```

Expected: FAIL — `detectCategories` not exported.

- [ ] **Step 7: Implement `detectCategories`**

Append to `activityFeedUtils.ts`:

```ts
export interface DetectedCategories {
  categories: Set<ActionFilter>;
  counts: Record<ActionFilter, number>;
}

export function detectCategories(log: ActivityLogEntry[]): DetectedCategories {
  const counts: Record<ActionFilter, number> = {
    errors: 0, edits: 0, bash: 0, reads: 0, messages: 0, agent: 0, other: 0,
  };
  for (const entry of log) {
    counts[categorizeEntry(entry.action, entry.detail)]++;
  }
  const categories = new Set<ActionFilter>();
  for (const key of Object.keys(counts) as ActionFilter[]) {
    if (counts[key] > 0) categories.add(key);
  }
  return { categories, counts };
}
```

- [ ] **Step 8: Run tests to verify pass**

```bash
cd client && bun test src/components/activityFeedUtils.test.ts
```

Expected: all tests pass (previous 30 + 7 new categorizeEntry + 3 new detectCategories = 40).

- [ ] **Step 9: Commit**

```bash
git add client/src/components/activityFeedUtils.ts client/src/components/activityFeedUtils.test.ts
git commit -m "feat(client): activityFeedUtils adds agent/other + categorizeEntry + detectCategories"
```

---

## Task 3: useFeedPrefs — rename `activeFilters` → `activeHighlights`, extend `FILTERS` to 7

**Files:**
- Modify: `client/src/hooks/useFeedPrefs.ts`
- Modify: `client/src/hooks/useFeedPrefs.test.ts`

Note: the file already has `FILTERS = ['errors', 'edits', 'bash', 'reads', 'messages']`. This task extends to 7 and renames the field.

- [ ] **Step 1: Update tests**

In `client/src/hooks/useFeedPrefs.test.ts`, update every assertion that references `activeFilters` to `activeHighlights`:

- "parses a valid full payload":
  ```ts
  const raw = JSON.stringify({
    foldState: 'compact',
    viewMode: 'byAgent',
    activeHighlights: ['errors', 'edits'],
    agentFilter: 'a1',
  });
  expect(parsePrefs(raw)).toEqual({
    foldState: 'compact',
    viewMode: 'byAgent',
    activeHighlights: ['errors', 'edits'],
    agentFilter: 'a1',
  });
  ```

- "falls back to defaults for invalid enum values":
  ```ts
  const raw = JSON.stringify({
    foldState: 'gigantic',
    viewMode: 'byPlanet',
    activeHighlights: ['nonsense', 'edits'],
    agentFilter: null,
  });
  const result = parsePrefs(raw);
  expect(result.foldState).toBe('full');
  expect(result.viewMode).toBe('all');
  expect(result.activeHighlights).toEqual(['edits']);
  ```

- "replaces arrays wholesale":
  ```ts
  const base = { ...DEFAULT_PREFS, activeHighlights: ['edits' as const] };
  const merged = mergePrefs(base, { activeHighlights: ['bash'] });
  expect(merged.activeHighlights).toEqual(['bash']);
  ```

Add a new test for backwards compatibility:

```ts
  it('reads legacy activeFilters key as activeHighlights', () => {
    const raw = JSON.stringify({
      foldState: 'full',
      viewMode: 'all',
      activeFilters: ['errors', 'bash'],
      agentFilter: null,
    });
    const result = parsePrefs(raw);
    expect(result.activeHighlights).toEqual(['errors', 'bash']);
  });
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd client && bun test src/hooks/useFeedPrefs.test.ts
```

Expected: FAIL — `activeHighlights` doesn't exist yet.

- [ ] **Step 3: Rename + extend in `useFeedPrefs.ts`**

Open `client/src/hooks/useFeedPrefs.ts`. Update the interface:

```ts
export interface FeedPrefs {
  foldState: FoldState;
  viewMode: ViewMode;
  activeHighlights: ActionFilter[];
  agentFilter: string | null;
}
```

Update the defaults:

```ts
export const DEFAULT_PREFS: FeedPrefs = {
  foldState: 'full',
  viewMode: 'all',
  activeHighlights: [],
  agentFilter: null,
};
```

Extend `FILTERS` to cover all 7 `ActionFilter` values:

```ts
const FILTERS: ActionFilter[] = ['errors', 'edits', 'bash', 'reads', 'messages', 'agent', 'other'];
```

Update `parsePrefs` to accept both the new and legacy key:

```ts
export function parsePrefs(raw: string | null): FeedPrefs {
  if (raw === null) return DEFAULT_PREFS;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return DEFAULT_PREFS; }
  if (obj === null || typeof obj !== 'object') return DEFAULT_PREFS;
  const o = obj as Record<string, unknown>;
  const highlightsRaw = Array.isArray(o.activeHighlights)
    ? o.activeHighlights
    : Array.isArray(o.activeFilters)
      ? o.activeFilters
      : null;
  return {
    foldState: isFoldState(o.foldState) ? o.foldState : DEFAULT_PREFS.foldState,
    viewMode: isViewMode(o.viewMode) ? o.viewMode : DEFAULT_PREFS.viewMode,
    activeHighlights: highlightsRaw !== null
      ? highlightsRaw.filter(isFilter)
      : DEFAULT_PREFS.activeHighlights,
    agentFilter: typeof o.agentFilter === 'string' && o.agentFilter.length > 0
      ? o.agentFilter
      : null,
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd client && bun test src/hooks/useFeedPrefs.test.ts
```

Expected: all pass including the backwards-compat test.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useFeedPrefs.ts client/src/hooks/useFeedPrefs.test.ts
git commit -m "refactor(client): rename activeFilters to activeHighlights with 7-category FILTERS"
```

---

## Task 4: usePartyPrefs — new hook with TDD

**Files:**
- Create: `client/src/hooks/usePartyPrefs.ts`
- Create: `client/src/hooks/usePartyPrefs.test.ts`

- [ ] **Step 1: Write failing tests**

Create `client/src/hooks/usePartyPrefs.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { DEFAULT_PARTY_PREFS, parsePartyPrefs, mergePartyPrefs } from './usePartyPrefs';

describe('parsePartyPrefs', () => {
  it('returns DEFAULT_PARTY_PREFS for null input', () => {
    expect(parsePartyPrefs(null)).toEqual(DEFAULT_PARTY_PREFS);
  });

  it('returns DEFAULT_PARTY_PREFS for malformed JSON', () => {
    expect(parsePartyPrefs('not json {')).toEqual(DEFAULT_PARTY_PREFS);
  });

  it('returns DEFAULT_PARTY_PREFS for non-object payload', () => {
    expect(parsePartyPrefs('"a string"')).toEqual(DEFAULT_PARTY_PREFS);
    expect(parsePartyPrefs('null')).toEqual(DEFAULT_PARTY_PREFS);
  });

  it('parses a valid payload', () => {
    const raw = JSON.stringify({ foldState: 'icons' });
    expect(parsePartyPrefs(raw)).toEqual({ foldState: 'icons' });
  });

  it('falls back to default for invalid fold state', () => {
    const raw = JSON.stringify({ foldState: 'gigantic' });
    expect(parsePartyPrefs(raw)).toEqual(DEFAULT_PARTY_PREFS);
  });
});

describe('mergePartyPrefs', () => {
  it('overlays partial onto base', () => {
    const merged = mergePartyPrefs(DEFAULT_PARTY_PREFS, { foldState: 'icons' });
    expect(merged.foldState).toBe('icons');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd client && bun test src/hooks/usePartyPrefs.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `client/src/hooks/usePartyPrefs.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export type PartyFoldState = 'full' | 'icons';

export interface PartyPrefs {
  foldState: PartyFoldState;
}

export const DEFAULT_PARTY_PREFS: PartyPrefs = {
  foldState: 'full',
};

const STORAGE_KEY = 'agentquest:partyBar:prefs';
const WRITE_DEBOUNCE_MS = 200;

const FOLD_STATES: PartyFoldState[] = ['full', 'icons'];

function isPartyFoldState(v: unknown): v is PartyFoldState {
  return typeof v === 'string' && (FOLD_STATES as string[]).includes(v);
}

export function parsePartyPrefs(raw: string | null): PartyPrefs {
  if (raw === null) return DEFAULT_PARTY_PREFS;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return DEFAULT_PARTY_PREFS; }
  if (obj === null || typeof obj !== 'object') return DEFAULT_PARTY_PREFS;
  const o = obj as Record<string, unknown>;
  return {
    foldState: isPartyFoldState(o.foldState) ? o.foldState : DEFAULT_PARTY_PREFS.foldState,
  };
}

export function mergePartyPrefs(base: PartyPrefs, patch: Partial<PartyPrefs>): PartyPrefs {
  return { ...base, ...patch };
}

export function usePartyPrefs(): [PartyPrefs, (patch: Partial<PartyPrefs>) => void] {
  const [prefs, setPrefs] = useState<PartyPrefs>(() => {
    if (typeof window === 'undefined') return DEFAULT_PARTY_PREFS;
    return parsePartyPrefs(window.localStorage.getItem(STORAGE_KEY));
  });

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValue = useRef<PartyPrefs | null>(null);

  useEffect(() => {
    if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    pendingValue.current = prefs;
    writeTimer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      } catch { /* quota or private mode — silently ignore */ }
      pendingValue.current = null;
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (writeTimer.current !== null) clearTimeout(writeTimer.current);
    };
  }, [prefs]);

  useEffect(() => {
    return () => {
      if (pendingValue.current !== null) {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingValue.current));
        } catch { /* quota or private mode — silently ignore */ }
        pendingValue.current = null;
      }
    };
  }, []);

  const update = useCallback((patch: Partial<PartyPrefs>) => {
    setPrefs((prev) => mergePartyPrefs(prev, patch));
  }, []);

  return [prefs, update];
}
```

- [ ] **Step 4: Run tests + type check**

```bash
cd client && bun test src/hooks/usePartyPrefs.test.ts && bunx tsc -b --noEmit
```

Expected: 6 tests pass, TS clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/usePartyPrefs.ts client/src/hooks/usePartyPrefs.test.ts
git commit -m "feat(client): add usePartyPrefs hook with localStorage persistence"
```

---

## Task 5: ActivityFeedHeader — auto-detected pills with counters, highlight semantics

**Files:**
- Modify: `client/src/components/ActivityFeedHeader.tsx`

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `client/src/components/ActivityFeedHeader.tsx` with:

```tsx
import type { FoldState, ViewMode } from '../hooks/useFeedPrefs';
import type { ActionFilter } from './activityFeedUtils';
import type { AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';

interface ActivityFeedHeaderProps {
  foldState: FoldState;
  viewMode: ViewMode;
  activeHighlights: ActionFilter[];
  availableCategories: Set<ActionFilter>;
  categoryCounts: Record<ActionFilter, number>;
  agentFilter: string | null;
  agents: AgentState[];
  newCount: number;
  onFoldChange: (state: FoldState) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onHighlightsChange: (highlights: ActionFilter[]) => void;
  onClearAgentFilter: () => void;
}

const PILL_ORDER: { id: ActionFilter; label: string }[] = [
  { id: 'messages', label: 'Messages' },
  { id: 'errors',   label: 'Errors'   },
  { id: 'edits',    label: 'Edits'    },
  { id: 'bash',     label: 'Bash'     },
  { id: 'reads',    label: 'Reads'    },
  { id: 'agent',    label: 'Agent'    },
  { id: 'other',    label: 'Other'    },
];

export function ActivityFeedHeader({
  foldState, viewMode, activeHighlights, availableCategories, categoryCounts,
  agentFilter, agents, newCount,
  onFoldChange, onViewModeChange, onHighlightsChange, onClearAgentFilter,
}: ActivityFeedHeaderProps) {
  const filteredAgent = agentFilter !== null ? agents.find((a) => a.id === agentFilter) ?? null : null;

  function toggleHighlight(id: ActionFilter) {
    if (activeHighlights.includes(id)) {
      onHighlightsChange(activeHighlights.filter((f) => f !== id));
    } else {
      onHighlightsChange([...activeHighlights, id]);
    }
  }

  const showSecondRow = foldState === 'full';
  const pills = PILL_ORDER.filter((p) => availableCategories.has(p.id));
  const hasChip = filteredAgent !== null;
  const secondRowHasContent = pills.length > 0 || hasChip;

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
          <div className="feed-tabs" role="group" aria-label="Feed view mode">
            <button
              type="button"
              aria-pressed={viewMode === 'all'}
              className={`feed-tab ${viewMode === 'all' ? 'active' : ''}`}
              onClick={() => onViewModeChange('all')}
            >All</button>
            <button
              type="button"
              aria-pressed={viewMode === 'byAgent'}
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

      {showSecondRow && secondRowHasContent && (
        <div className="feed-header-row feed-filter-row">
          {pills.map(({ id, label }) => (
            <button
              type="button"
              key={id}
              aria-pressed={activeHighlights.includes(id)}
              className={`feed-pill ${id} ${activeHighlights.includes(id) ? 'on' : ''}`}
              onClick={() => toggleHighlight(id)}
            >{label} ({categoryCounts[id]})</button>
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

- [ ] **Step 2: Type check**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: errors in `ActivityFeed.tsx` (prop shape changed). Fixed in Task 8.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ActivityFeedHeader.tsx
git commit -m "feat(client): ActivityFeedHeader renders auto-detected pills with counters"
```

---

## Task 6: ActivityRow — preserve Reply/Prompt rendering + add `highlighted`/`isSelected`

**Files:**
- Modify: `client/src/components/ActivityRow.tsx`

Note: the file already has special rendering for `Reply`/`Prompt` (`is-message`, `is-reply`, `is-prompt` classes). Preserve that. Add the two new props + update `memo` comparator.

- [ ] **Step 1: Update `ActivityRow.tsx`**

Replace the entire contents of `client/src/components/ActivityRow.tsx` with:

```tsx
import { memo, useCallback, useEffect, useState } from 'react';
import type { ActivityLogEntry, AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { isError, isPath, resolvePath, categorizeEntry } from './activityFeedUtils';
import type { ActionFilter } from './activityFeedUtils';

interface ActivityRowProps {
  entry: ActivityLogEntry;
  agent: AgentState | undefined;
  agentName: string;
  /** When true, hides the avatar+name (used inside AgentGroup). */
  inGroup?: boolean;
  highlighted: boolean;
  isSelected: boolean;
  onSelectAgent: (id: string) => void;
  onFilterAgent: (id: string) => void;
}

interface MenuState {
  x: number;
  y: number;
}

function ActivityRowImpl({
  entry, agent, agentName, inGroup, highlighted, isSelected,
  onSelectAgent, onFilterAgent,
}: ActivityRowProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const error = isError(entry.action, entry.detail);
  const isMessage = entry.action === 'Reply' || entry.action === 'Prompt';
  const detailIsPath = !isMessage && isPath(entry.detail);
  const absolute = detailIsPath ? resolvePath(entry.detail, agent?.cwd) : null;
  const pillVariant = entry.action === 'Reply' ? 'is-reply' : entry.action === 'Prompt' ? 'is-prompt' : '';
  const category: ActionFilter = categorizeEntry(entry.action, entry.detail);
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

  const rowClasses = [
    'feed-entry',
    error ? 'is-error' : '',
    isMessage ? 'is-message' : '',
    highlighted ? `is-highlighted hl-${category}` : '',
    isSelected ? 'is-selected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rowClasses} onContextMenu={onContextMenu} role="listitem">
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
          {!inGroup && agent !== undefined && (
            <button
              type="button"
              className="feed-agent-name"
              aria-label={`Filter feed to ${agentName}`}
              onClick={() => onFilterAgent(agent.id)}
              title={agentName}
            >{agentName}</button>
          )}
          <span className={`feed-action-pill ${error ? 'is-error' : ''} ${pillVariant}`}>{entry.action}</span>
          <span className="feed-time">{time}</span>
        </div>
        {isMessage ? (
          <span className={`feed-detail is-message ${pillVariant}`}>{entry.detail}</span>
        ) : detailIsPath && absolute !== null ? (
          <a
            href={`vscode://file${encodeURI(absolute)}`}
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

// Callbacks (onSelectAgent, onFilterAgent) intentionally omitted from the
// comparator — the parent must memoize them (useCallback) so their identity
// stays stable across renders, otherwise stale closures can fire.
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
  prev.inGroup        === next.inGroup        &&
  prev.highlighted    === next.highlighted    &&
  prev.isSelected     === next.isSelected
);
```

- [ ] **Step 2: Type check (fails on AgentGroup/ActivityFeed until Task 7/8)**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: errors in `AgentGroup.tsx` and `ActivityFeed.tsx` for missing `highlighted`/`isSelected`.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ActivityRow.tsx
git commit -m "feat(client): ActivityRow exposes highlighted and isSelected props"
```

---

## Task 7: AgentGroup — propagate selection and highlights

**Files:**
- Modify: `client/src/components/AgentGroup.tsx`

- [ ] **Step 1: Update `AgentGroup.tsx`**

Replace the entire contents with:

```tsx
import { useState } from 'react';
import { HERO_LABEL_COLOR, type ActivityLogEntry, type AgentState } from '../types/agent';
import { HeroAvatar } from './HeroAvatar';
import { ActivityRow } from './ActivityRow';
import { categorizeEntry, type ActionFilter } from './activityFeedUtils';

interface AgentGroupProps {
  agentId: string;
  agent: AgentState | undefined;
  agentName: string;
  entries: ActivityLogEntry[];
  activeHighlights: ActionFilter[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onFilterAgent: (id: string) => void;
}

const COLLAPSED_VISIBLE = 3;

export function AgentGroup({
  agentId, agent, agentName, entries,
  activeHighlights, selectedAgentId,
  onSelectAgent, onFilterAgent,
}: AgentGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? entries : entries.slice(0, COLLAPSED_VISIBLE);
  const hidden = entries.length - visible.length;
  const isSelected = agentId === selectedAgentId;

  const shouldHighlight = (entry: ActivityLogEntry): boolean => {
    if (activeHighlights.length === 0) return false;
    return activeHighlights.includes(categorizeEntry(entry.action, entry.detail));
  };

  return (
    <section className={`feed-group ${isSelected ? 'is-selected' : ''}`} aria-label={`Activity for ${agentName}`}>
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
        ) : <span className="feed-group-avatar-placeholder" aria-hidden="true" />}
        <span
          className="feed-group-name"
          style={agent !== undefined ? { color: HERO_LABEL_COLOR[agent.heroColor] } : undefined}
        >{agentName}</span>
        {agent !== undefined && (
          <span className="feed-group-activity">· {agent.currentActivity}</span>
        )}
      </header>

      <div className="feed-group-body">
        {visible.map((entry) => (
          <ActivityRow
            key={`${entry.agentId}-${entry.timestamp}-${entry.action}-${entry.detail}`}
            entry={entry}
            agent={agent}
            agentName={agentName}
            inGroup
            highlighted={shouldHighlight(entry)}
            isSelected={isSelected}
            onSelectAgent={onSelectAgent}
            onFilterAgent={onFilterAgent}
          />
        ))}
        {hidden > 0 && (
          <button type="button" className="feed-group-more" onClick={() => setExpanded(true)}>
            + {hidden} more
          </button>
        )}
        {expanded && entries.length > COLLAPSED_VISIBLE && (
          <button type="button" className="feed-group-less" onClick={() => setExpanded(false)}>
            Show less
          </button>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Type check (still fails on ActivityFeed until Task 8)**

```bash
cd client && bunx tsc -b --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/AgentGroup.tsx
git commit -m "feat(client): AgentGroup propagates activeHighlights and selectedAgentId to rows"
```

---

## Task 8: ActivityFeed container — highlight mode + selection passthrough

**Files:**
- Modify: `client/src/components/ActivityFeed.tsx`

- [ ] **Step 1: Rewrite `ActivityFeed.tsx`**

Replace the entire contents with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityLogEntry, AgentState } from '../types/agent';
import { eventBridge } from '../game/EventBridge';
import { useFeedPrefs, type FoldState, type ViewMode } from '../hooks/useFeedPrefs';
import { ActivityFeedHeader } from './ActivityFeedHeader';
import { ActivityRow } from './ActivityRow';
import { AgentGroup } from './AgentGroup';
import {
  filterByAgent, groupByAgent, getAgentNameFallback, categorizeEntry, detectCategories,
  type ActionFilter,
} from './activityFeedUtils';
import './ActivityFeed.css';

interface ActivityFeedProps {
  log: ActivityLogEntry[];
  agents: AgentState[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
}

const SCROLL_PIN_THRESHOLD_PX = 8;

export function ActivityFeed({ log, agents, selectedAgentId, onSelectAgent }: ActivityFeedProps) {
  const [prefs, updatePrefs] = useFeedPrefs();
  const { foldState, viewMode, activeHighlights, agentFilter } = prefs;

  // The agent-filter chip still hides rows (explicit user filter on one agent).
  // The action highlights do NOT hide anything; they only tint matching rows.
  const filtered = useMemo(
    () => filterByAgent(log, agentFilter),
    [log, agentFilter],
  );

  const { categories: availableCategories, counts: categoryCounts } = useMemo(
    () => detectCategories(filtered),
    [filtered],
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

  // --- Auto-scroll lock + closed-state counter ---
  const listRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);
  const [newSinceUnpin, setNewSinceUnpin] = useState(0);
  const [newWhileClosed, setNewWhileClosed] = useState(0);
  const prevLogLength = useRef(log.length);
  const isFirstRun = useRef(true);

  useEffect(() => {
    const delta = log.length - prevLogLength.current;
    if (!isFirstRun.current && delta > 0) {
      if (!pinned) setNewSinceUnpin((n) => n + delta);
      if (foldState === 'closed') setNewWhileClosed((n) => n + delta);
    }
    prevLogLength.current = log.length;
    isFirstRun.current = false;

    if (pinned && listRef.current !== null) {
      listRef.current.scrollTop = 0;
    }
  }, [log, pinned, foldState]);

  useEffect(() => {
    if (foldState !== 'closed') setNewWhileClosed(0);
  }, [foldState]);

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

  const handleSelectAgent = useCallback((id: string) => {
    onSelectAgent(id);
    eventBridge.emit('camera:follow', id);
  }, [onSelectAgent]);

  const handleFilterAgent = useCallback((id: string) => {
    updatePrefs({ agentFilter: id });
  }, [updatePrefs]);

  const clearAgentFilter = useCallback(() => updatePrefs({ agentFilter: null }), [updatePrefs]);

  const onFoldChange = useCallback(
    (s: FoldState) => updatePrefs({ foldState: s }),
    [updatePrefs],
  );
  const onViewModeChange = useCallback(
    (m: ViewMode) => updatePrefs({ viewMode: m }),
    [updatePrefs],
  );
  const onHighlightsChange = useCallback(
    (h: ActionFilter[]) => updatePrefs({ activeHighlights: h }),
    [updatePrefs],
  );

  const shouldHighlight = (entry: ActivityLogEntry): boolean => {
    if (activeHighlights.length === 0) return false;
    return activeHighlights.includes(categorizeEntry(entry.action, entry.detail));
  };

  return (
    <div className={`activity-feed fold-${foldState}`} role="log" aria-live="polite" aria-relevant="additions">
      <ActivityFeedHeader
        foldState={foldState}
        viewMode={viewMode}
        activeHighlights={activeHighlights}
        availableCategories={availableCategories}
        categoryCounts={categoryCounts}
        agentFilter={agentFilter}
        agents={agents}
        newCount={newWhileClosed}
        onFoldChange={onFoldChange}
        onViewModeChange={onViewModeChange}
        onHighlightsChange={onHighlightsChange}
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
                  activeHighlights={activeHighlights}
                  selectedAgentId={selectedAgentId}
                  onSelectAgent={handleSelectAgent}
                  onFilterAgent={handleFilterAgent}
                />
              ))
            ) : (
              filtered.map((entry) => (
                <ActivityRow
                  key={`${entry.agentId}-${entry.timestamp}-${entry.action}-${entry.detail}`}
                  entry={entry}
                  agent={agentLookup.get(entry.agentId)}
                  agentName={resolveName(entry.agentId)}
                  highlighted={shouldHighlight(entry)}
                  isSelected={entry.agentId === selectedAgentId}
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

- [ ] **Step 2: Type check (now mostly clean — App.tsx still passes old props)**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: at most one error in `App.tsx` (missing `selectedAgentId` on `<ActivityFeed>` call) — fixed in Task 13.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ActivityFeed.tsx
git commit -m "feat(client): ActivityFeed uses highlight semantics and passes selectedAgentId"
```

---

## Task 9: ActivityFeed.css — append highlight + selection styles

**Files:**
- Modify: `client/src/components/ActivityFeed.css`

Note: the user has manually set `.feed-detail { font-size: 16px }` — do NOT revert. Append-only changes.

- [ ] **Step 1: Append to the end of `ActivityFeed.css`**

Add this block at the very end of the file (after the `@media (max-width: 600px)` block):

```css
/* === Highlight (pill-matched) and selection states === */
.feed-entry.is-highlighted {
  background: rgba(196, 163, 90, 0.06);
  border-left: 3px solid var(--feed-gold);
  padding-left: 11px;
}
.feed-entry.is-highlighted.hl-errors   { border-left-color: var(--feed-error-strong); background: rgba(139, 37, 0, 0.08); }
.feed-entry.is-highlighted.hl-edits    { border-left-color: var(--feed-blue);         background: rgba(123, 158, 196, 0.08); }
.feed-entry.is-highlighted.hl-bash     { border-left-color: var(--feed-gold);         background: rgba(196, 163, 90, 0.08); }
.feed-entry.is-highlighted.hl-reads    { border-left-color: #9a7ac4;                  background: rgba(154, 122, 196, 0.08); }
.feed-entry.is-highlighted.hl-messages { border-left-color: #e08a3f;                  background: rgba(224, 138, 63, 0.08); }
.feed-entry.is-highlighted.hl-agent    { border-left-color: #7ac49a;                  background: rgba(122, 196, 154, 0.08); }
.feed-entry.is-highlighted.hl-other    { border-left-color: #888;                     background: rgba(136, 136, 136, 0.06); }

.feed-entry.is-selected {
  box-shadow: inset 4px 0 0 var(--feed-gold), 0 0 8px rgba(196, 163, 90, 0.25);
  background: rgba(196, 163, 90, 0.08);
}
.feed-entry.is-selected.is-highlighted {
  box-shadow: inset 4px 0 0 var(--feed-gold), 0 0 10px rgba(196, 163, 90, 0.35);
}

.feed-group.is-selected > .feed-group-header {
  background: rgba(196, 163, 90, 0.14);
  box-shadow: inset 4px 0 0 var(--feed-gold);
}

/* Category pill styling for agent/other/reads (messages already styled; errors/edits/bash reuse existing) */
.feed-pill.agent    { background: rgba(122, 196, 154, 0.15); color: #9eddbb; border-color: rgba(122, 196, 154, 0.4); }
.feed-pill.agent.on { background: rgba(122, 196, 154, 0.35); color: #fff;    border-color: #7ac49a; }
.feed-pill.other    { background: rgba(136, 136, 136, 0.15); color: #bbb;    border-color: rgba(136, 136, 136, 0.4); }
.feed-pill.other.on { background: rgba(136, 136, 136, 0.35); color: #fff;    border-color: #aaa; }
.feed-pill.reads    { background: rgba(154, 122, 196, 0.15); color: #bda5dc; border-color: rgba(154, 122, 196, 0.4); }
.feed-pill.reads.on { background: rgba(154, 122, 196, 0.35); color: #fff;    border-color: #9a7ac4; }
```

If `.feed-pill.messages` / `.feed-pill.messages.on` are NOT already defined in the file, also add:

```css
.feed-pill.messages    { background: rgba(224, 138, 63, 0.15); color: #f0c99a; border-color: rgba(224, 138, 63, 0.4); }
.feed-pill.messages.on { background: rgba(224, 138, 63, 0.35); color: #fff;    border-color: #e08a3f; }
```

Check first with `grep -n "feed-pill.messages" client/src/components/ActivityFeed.css`.

- [ ] **Step 2: Commit**

```bash
git add client/src/components/ActivityFeed.css
git commit -m "style(client): feed highlight border/background per category and selection glow"
```

---

## Task 10: PartyBar.tsx — full rewrite

**Files:**
- Modify: `client/src/components/PartyBar.tsx`

- [ ] **Step 1: Replace the entire file**

Replace the contents of `client/src/components/PartyBar.tsx` with:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { HeroAvatar } from './HeroAvatar';
import { usePartyPrefs } from '../hooks/usePartyPrefs';
import { eventBridge } from '../game/EventBridge';
import type { AgentState } from '../types/agent';
import './PartyBar.css';

interface PartyBarProps {
  agents: AgentState[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
}

const AVATAR_SIZE = 40;
const FLASH_DURATION_MS = 400;

const STATUS_ORDER: Record<AgentState['status'], number> = {
  active: 0,
  waiting: 1,
  idle: 2,
  error: 3,
  completed: 4,
};

interface PartyRowProps {
  agent: AgentState;
  mode: 'full' | 'icons';
  isSelected: boolean;
  onClick: () => void;
}

function PartyRow({ agent, mode, isSelected, onClick }: PartyRowProps) {
  const [flashing, setFlashing] = useState(false);
  const prevSelected = useRef(isSelected);

  useEffect(() => {
    if (!prevSelected.current && isSelected) {
      setFlashing(true);
      const id = setTimeout(() => setFlashing(false), FLASH_DURATION_MS);
      prevSelected.current = isSelected;
      return () => clearTimeout(id);
    }
    prevSelected.current = isSelected;
  }, [isSelected]);

  const classes = [
    'partybar-agent',
    `mode-${mode}`,
    isSelected ? 'selected' : '',
    flashing ? 'flashing' : '',
  ].filter(Boolean).join(' ');

  const title = mode === 'icons'
    ? `${agent.name} · ${agent.currentActivity}`
    : undefined;

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      aria-label={`Select ${agent.name}, ${agent.currentActivity}`}
      aria-current={isSelected ? 'true' : undefined}
      title={title}
    >
      <span className="partybar-avatar-wrap">
        <HeroAvatar agent={agent} size={AVATAR_SIZE} />
        <span className={`partybar-status-overlay ${agent.status}`} aria-hidden="true" />
      </span>
      {mode === 'full' && (
        <span className="partybar-row-body">
          <span className="partybar-row-top">
            <span className="partybar-agent-name">{agent.name}</span>
            <span className={`partybar-dot ${agent.status}`} aria-hidden="true" />
          </span>
          <span className="partybar-activity">{agent.currentActivity}</span>
        </span>
      )}
    </button>
  );
}

export function PartyBar({ agents, selectedAgentId, onSelectAgent }: PartyBarProps) {
  const [prefs, updatePrefs] = usePartyPrefs();
  const mode: 'full' | 'icons' = prefs.foldState;

  const visible = agents.filter((a) => a.status === 'active' || a.status === 'idle');
  const sorted = [...visible].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const activeCount = visible.filter((a) => a.status === 'active').length;
  const idleCount = visible.filter((a) => a.status === 'idle').length;

  const toggleFold = useCallback(() => {
    updatePrefs({ foldState: mode === 'full' ? 'icons' : 'full' });
  }, [mode, updatePrefs]);

  const handleClick = useCallback((id: string) => {
    onSelectAgent(id);
    eventBridge.emit('camera:follow', id);
  }, [onSelectAgent]);

  return (
    <div className={`partybar mode-${mode}`} role="list" aria-label="Party">
      <div className="partybar-header">
        {mode === 'full' ? (
          <span className="partybar-title">Party ({activeCount} active, {idleCount} idle)</span>
        ) : (
          <span className="partybar-title-compact">{activeCount + idleCount}</span>
        )}
        <button
          type="button"
          className="partybar-fold-btn"
          aria-label={mode === 'full' ? 'Collapse to icons' : 'Expand party'}
          aria-pressed={mode === 'icons'}
          onClick={toggleFold}
        >{mode === 'full' ? '◀' : '▶'}</button>
      </div>

      <div className="partybar-list">
        {sorted.map((agent) => (
          <PartyRow
            key={agent.id}
            agent={agent}
            mode={mode}
            isSelected={agent.id === selectedAgentId}
            onClick={() => handleClick(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type check**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: clean for PartyBar. `App.tsx` errors (if any) fixed in Task 13.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/PartyBar.tsx
git commit -m "feat(client): rewrite PartyBar with fold states, 40px avatars, selection flash"
```

---

## Task 11: PartyBar.css — full restyle

**Files:**
- Modify: `client/src/components/PartyBar.css`

- [ ] **Step 1: Overwrite the CSS file**

Replace the entire contents of `client/src/components/PartyBar.css` with:

```css
.partybar {
  position: absolute;
  top: 76px;
  left: 8px;
  max-height: calc(100% - 208px);
  background: rgba(26, 26, 46, 0.85);
  border: 1px solid rgba(196, 163, 90, 0.4);
  border-radius: 4px;
  overflow: hidden;
  z-index: 25;
  font-family: 'Fira Code', ui-monospace, monospace;
  display: flex;
  flex-direction: column;
  transition: width 0.18s ease;
}
.partybar.mode-full  { width: 220px; }
.partybar.mode-icons { width: 60px;  }

/* === Header === */
.partybar-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 4px;
  border-bottom: 1px solid rgba(196, 163, 90, 0.2);
  flex-shrink: 0;
}
.partybar-title {
  font-family: 'Cinzel', serif;
  color: #C4A35A;
  font-size: 13px;
  font-weight: 700;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.partybar-title-compact {
  color: #C4A35A;
  font-family: 'Cinzel', serif;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
  flex: 1;
  background: rgba(196, 163, 90, 0.2);
  border-radius: 10px;
  padding: 0 6px;
}
.partybar-fold-btn {
  width: 22px; height: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(196, 163, 90, 0.12);
  border: 1px solid rgba(196, 163, 90, 0.25);
  border-radius: 3px;
  color: #F5E6C8;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
}
.partybar-fold-btn:hover { background: rgba(196, 163, 90, 0.25); }
.partybar-fold-btn:focus-visible {
  outline: 2px solid #C4A35A;
  outline-offset: 1px;
}

/* === List === */
.partybar-list {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(196, 163, 90, 0.4) transparent;
}
.partybar-list::-webkit-scrollbar { width: 6px; }
.partybar-list::-webkit-scrollbar-thumb { background: rgba(196, 163, 90, 0.4); border-radius: 3px; }
.partybar-list::-webkit-scrollbar-track { background: transparent; }

/* === Row === */
.partybar-agent {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  cursor: pointer;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  color: inherit;
  font-family: inherit;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  transition: background 0.15s, box-shadow 0.15s;
  position: relative;
}
.partybar-agent:hover { background: rgba(196, 163, 90, 0.1); }
.partybar-agent.selected {
  background: rgba(196, 163, 90, 0.3);
  border-left: 3px solid #C4A35A;
  padding-left: 7px;
  box-shadow: 0 0 12px rgba(196, 163, 90, 0.4);
}
.partybar-agent.flashing {
  animation: party-select-flash 0.4s ease-out;
}
@keyframes party-select-flash {
  0%   { box-shadow: 0 0 20px rgba(196, 163, 90, 0.9); background: rgba(196, 163, 90, 0.5); }
  100% { box-shadow: 0 0 12px rgba(196, 163, 90, 0.4); background: rgba(196, 163, 90, 0.3); }
}
@media (prefers-reduced-motion: reduce) {
  .partybar-agent.flashing { animation: none; }
}

.partybar.mode-icons .partybar-agent {
  justify-content: center;
  padding: 6px 0;
}

/* === Avatar + status overlay === */
.partybar-avatar-wrap {
  position: relative;
  display: inline-block;
  line-height: 0;
}
.partybar-status-overlay {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid #1a1a2e;
  box-sizing: content-box;
}
.partybar-status-overlay.active    { background: #2E8B57; }
.partybar-status-overlay.idle      { background: #C4A35A; }
.partybar-status-overlay.completed { background: #555;    }
.partybar-status-overlay.error     { background: #8B2500; }
.partybar-status-overlay.waiting   { background: #FFD700; }

/* === Row body (Full only) === */
.partybar-row-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.partybar-row-top {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.partybar-agent-name {
  font-family: 'Fira Code', monospace;
  font-size: 14px;
  font-weight: 700;
  color: #F5E6C8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 130px;
  flex: 1;
}
.partybar-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
.partybar-dot.active    { background: #2E8B57; }
.partybar-dot.idle      { background: #C4A35A; }
.partybar-dot.completed { background: #555;    }
.partybar-dot.error     { background: #8B2500; }
.partybar-dot.waiting   { background: #FFD700; }
.partybar-activity {
  font-size: 12px;
  color: #F5E6C8;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* === Responsive === */
@media (max-width: 600px) {
  .partybar.mode-full { width: 180px; }
  .partybar-agent-name { max-width: 90px; font-size: 13px; }
  .partybar-activity { font-size: 11px; }
}

@media (max-width: 400px) {
  .partybar.mode-full { width: 60px; }
  .partybar.mode-full .partybar-row-body,
  .partybar.mode-full .partybar-title { display: none; }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/PartyBar.css
git commit -m "style(client): full restyle of PartyBar for fold states and selection flash"
```

---

## Task 12: HeroSprite + VillageScene — hero click + selection outline

**Files:**
- Modify: `client/src/game/entities/HeroSprite.ts`
- Modify: `client/src/game/scenes/VillageScene.ts`

- [ ] **Step 1: Add public methods to `HeroSprite`**

In `client/src/game/entities/HeroSprite.ts`, add two public methods to the class (place them near other public methods like `setActivity`):

```ts
  /** Make the sprite respond to pointerdown with the supplied callback. */
  setInteractiveForSelection(onClick: () => void): void {
    if (!this.sprite.input || !this.sprite.input.enabled) {
      this.sprite.setInteractive({ useHandCursor: true });
    }
    this.sprite.on('pointerdown', onClick);
  }

  /** Apply or clear a selection visual (warm gold tint). */
  setSelected(selected: boolean): void {
    if (selected) {
      this.sprite.setTint(0xffdd88);
    } else {
      this.sprite.clearTint();
    }
  }
```

- [ ] **Step 2: Add class field in `VillageScene`**

In `client/src/game/scenes/VillageScene.ts`, near the existing `private onCameraFollow` field (added in the previous pass), add:

```ts
  private onSelectionChanged: ((agentId: unknown) => void) | null = null;
```

- [ ] **Step 3: Hook up hero click when heroes are created**

Find the code in `VillageScene.ts` where a new `HeroSprite` is created and stored in `this.heroes`. This typically happens in `handleAgentUpdate` or a helper method. Immediately after `this.heroes.set(agentId, hero);`, add:

```ts
hero.setInteractiveForSelection(() => {
  eventBridge.emit('hero:clicked', agentId);
});
```

If there are multiple spawn sites, add it to each.

- [ ] **Step 4: Subscribe to `selection:changed` in `create()`**

In `create()`, after the existing `eventBridge.on('camera:follow', this.onCameraFollow)` block, add:

```ts
// Apply outline/tint to the selected hero whenever selection changes.
this.onSelectionChanged = (agentId: unknown) => {
  const selectedId = typeof agentId === 'string' ? agentId : null;
  for (const [id, hero] of this.heroes) {
    hero.setSelected(id === selectedId);
  }
};
eventBridge.on('selection:changed', this.onSelectionChanged);
```

- [ ] **Step 5: Clean up in the existing `cleanup` function**

In the `cleanup` function of `create()`, after the `onCameraFollow` cleanup, add:

```ts
if (this.onSelectionChanged !== null) {
  eventBridge.off('selection:changed', this.onSelectionChanged);
  this.onSelectionChanged = null;
}
```

- [ ] **Step 6: Type check**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add client/src/game/entities/HeroSprite.ts client/src/game/scenes/VillageScene.ts
git commit -m "feat(client): hero sprites are clickable and respond to selection:changed"
```

---

## Task 13: App.tsx — selection plumbing

**Files:**
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Add `hero:clicked` listener**

Open `client/src/App.tsx`. Below the existing `building:clicked` effect (around line 44), add:

```tsx
useEffect(() => {
  const onHeroClicked = (id: unknown) => {
    if (typeof id !== 'string') return;
    handleSelectAgent(id);
  };
  eventBridge.on('hero:clicked', onHeroClicked);
  return () => {
    eventBridge.off('hero:clicked', onHeroClicked);
  };
}, [handleSelectAgent]);
```

- [ ] **Step 2: Emit `selection:changed` on every selection change**

After the existing `agents:updated` emit effect (around line 77), add:

```tsx
useEffect(() => {
  eventBridge.emit('selection:changed', selectedAgentId);
}, [selectedAgentId]);
```

- [ ] **Step 3: Pass `selectedAgentId` to `<ActivityFeed>`**

Find the `<ActivityFeed>` JSX (around line 111) and update:

```tsx
<ActivityFeed
  log={activityLog}
  agents={agents}
  selectedAgentId={selectedAgentId}
  onSelectAgent={handleSelectAgent}
/>
```

- [ ] **Step 4: Type check**

```bash
cd client && bunx tsc -b --noEmit
```

Expected: fully clean across the whole project.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(client): App routes hero:clicked, emits selection:changed, passes selectedAgentId"
```

---

## Task 14: Final pass — acceptance + cleanup

**Files:** none new.

- [ ] **Step 1: Full test + type check**

```bash
cd client && bunx tsc -b --noEmit && bun test
```

Expected:
- TS clean.
- Tests: previous 54 + Task 2 (7 categorize + 3 detect = 10) + Task 4 (6 partyprefs) + Task 3 (1 backwards-compat) = **~71 tests, 0 failures**.

- [ ] **Step 2: Walk the acceptance criteria in the browser**

Ask the user to run `bun start` and load `http://localhost:4445`. Walk the AC list in the spec:

1. Hero sprite renders correctly at any size (14/24/40/60).
2. Click hero in Phaser → toggle selection.
3. PartyBar shows 40px avatars with status dot overlay. Name 14px, activity 12px.
4. PartyBar fold toggle works. Preference persists across reload.
5. PartyBar row click → select + camera pan.
6. Selected row: permanent glow + 400ms flash on selection change.
7. Phaser hero gains warm gold tint when selected.
8. Feed rows matching the selected agent have `is-selected` styling.
9. Pills auto-derive: only categories with at least one entry appear (all 7: messages/errors/edits/bash/reads/agent/other).
10. Pill click toggles highlight (not filter). Rows never hidden.
11. Pills show counters (e.g., `Messages (3)`).
12. Existing `activeFilters` in localStorage reads as `activeHighlights`.
13. PartyBar <600px → 180px; <400px → CSS collapses to icons.
14. Tests pass, TS clean.

Report failures.

- [ ] **Step 3: Review commit history**

```bash
cd /Users/Fulvio/Documents/AppDev/Agent\ Quest && git log --oneline 267ec2b..HEAD
```

Expected: one commit per task (plus any fix commits from reviewer iteration).

- [ ] **Step 4: Clean working tree**

```bash
cd /Users/Fulvio/Documents/AppDev/Agent\ Quest && git status
```

Expected: clean.

- [ ] **Step 5: No final commit unless cleanup is needed**

If Steps 1-4 surface any issue, fix and commit. Otherwise Task 14 produces no new commits.

---

## Self-Review

**Spec coverage:**
- AC 1 (avatar at any size) → Task 1.
- AC 2 (hero click toggle) → Tasks 12, 13.
- AC 3 (40px avatars + status overlay) → Tasks 10, 11.
- AC 4 (fold toggle + persist) → Tasks 4, 10, 11.
- AC 5 (row click → select + camera) → Task 10.
- AC 6 (glow + flash) → Tasks 10, 11.
- AC 7 (Phaser tint) → Task 12.
- AC 8 (feed rows highlighted for selected) → Tasks 6, 7, 8, 9.
- AC 9 (auto-derived pills, 7 categories) → Tasks 2, 5, 8.
- AC 10 (highlight not hide) → Tasks 6, 7, 8, 9.
- AC 11 (pill counters) → Tasks 2, 5.
- AC 12 (localStorage migration) → Task 3.
- AC 13 (responsive) → Task 11.
- AC 14 (tests + TS) → Task 14.

**Placeholder scan:** none found.

**Type consistency:**
- `ActionFilter` — 7 values (`errors|edits|bash|reads|messages|agent|other`) consistent across Tasks 2, 3, 5, 6, 7, 8.
- `FoldState`/`ViewMode`/`FeedPrefs` consistent across Tasks 3, 5, 8.
- `PartyFoldState`/`PartyPrefs` consistent across Tasks 4, 10.
- `HeroPreview.sheetRows` — defined Task 1, used Task 1.
- Events `hero:clicked`, `selection:changed`, `camera:follow` — emitters in Tasks 10, 12, 13; listeners in Tasks 12, 13.
- `selectedAgentId` prop flow: `App` (13) → `ActivityFeed` (8) → `AgentGroup` (7) → `ActivityRow` (6, `isSelected`).
- `activeHighlights` flow: `useFeedPrefs` (3) → `ActivityFeed` (8) → `ActivityFeedHeader` (5) and `AgentGroup` (7) → row `highlighted` (6).
- `HeroSprite.setInteractiveForSelection` / `setSelected` — defined and used only in Task 12.
- `categorizeEntry` — defined Task 2, used Tasks 6, 7, 8.
- `detectCategories` — defined Task 2, used Task 8.
- `MESSAGE_ACTIONS` constant — pre-existing, used by `categorizeEntry` in Task 2.
- `is-message` / `is-reply` / `is-prompt` classes — pre-existing in `ActivityRow`, preserved in Task 6, no CSS change required (already styled by the user).

No issues found.
