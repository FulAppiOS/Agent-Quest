# PartyBar Redesign + Cross-Component UI Polish — Design Spec

**Date**: 2026-04-23
**Status**: Approved for implementation planning
**Branch**: `ui-refinements` (continuing from the Activity Feed redesign merged on the same branch).
**Scope**: `client/src/components/PartyBar.tsx`, `HeroAvatar.tsx`, `ActivityFeed.tsx` (+ header, row), `activityFeedUtils.ts`, `useFeedPrefs.ts`, `App.tsx`, `VillageScene.ts`. New `usePartyPrefs` hook.

## Goal

A second pass of UI refinements that (1) redesigns the PartyBar sidebar in the same spirit as the Activity Feed redesign (readable font, fold states, camera follow, persistent prefs), (2) fixes two cross-component bugs — avatar sprites rendering as squashed collages and the Activity Feed filter pills hiding legitimate actions — and (3) adds a unified selection + highlight model across the Phaser scene, the PartyBar, and the Activity Feed.

The current PartyBar (49-line TSX + 73-line CSS after Task 1 of the previous pass) uses 10/9/8px fonts, caps the visible list at 15 with no overflow access, and displays one-dot status with no camera integration. The current feed filter pills hide every action outside the four hardcoded categories (Errors/Edits/Bash/Reads), causing blind spots during subagent bootstrap and other tool calls. The current `HeroAvatar` squashes multi-row spritesheets into one 24px square, producing unreadable pixel salad.

## Out of scope

- HP / progress bar on the PartyBar rows (session duration, token budget).
- Token/cost display.
- Sort toggle on the PartyBar (status-based ordering stays).
- Status filter pills inside the PartyBar (completed/error visibility moves to the feed).
- Right-click context menu on PartyBar rows.
- Portrait-asset replacement of spritesheet-frame avatars (CSS fix is sufficient for now).

## Architecture

Three independent subsystems that share one state axis (`selectedAgentId`):

```
┌────────────────────────────── App.tsx ─────────────────────────────┐
│ useSelectedAgent() ──────── selectedAgentId ─────┐                 │
│                                                   │                 │
│   handleSelectAgent(id)  ←── hero:clicked event   │                 │
│                          ←── PartyBar row click  │                 │
│                          ←── ActivityRow avatar click              │
│                                                   │                 │
│                               emits ──> camera:follow              │
│                               emits ──> selection:changed          │
│                                                   │                 │
└───────────────────────────────────────┬───────────┴─────────────────┘
                                        │
                ┌───────────────────────┼───────────────────────┐
                ▼                       ▼                       ▼
         VillageScene             PartyBar                ActivityFeed
         (Phaser)                 (sidebar)               (bottom bar)
         listens to:              renders                 renders
         - camera:follow          selected row            selected entries
         - selection:changed      with glow + flash       with subtle glow
         emits:                   (no flash)
         - hero:clicked
```

`HeroAvatar` is a pure leaf used by PartyBar, ActivityRow, AgentGroup, and the agent-filter chip in the feed header. It gains one prop in its backing `HeroPreview` type (`sheetRows`) and correctly renders just the first idle frame at any size.

`ActivityFeed` shifts from a filter model to a highlight model for the action pills: all log entries remain visible, pills only tint matching rows.

## Components

### HeroAvatar — fix

`client/src/game/themes/types.ts`:
```ts
export interface HeroPreview {
  url: string;
  sheetColumns: number;
  sheetRows: number;          // NEW — total rows in the spritesheet
  frameWidth?: number;
  frameHeight?: number;
}
```

`client/src/game/themes/tiny-swords-cc0.ts` (`getHeroPreview`, line 168 area): populate `sheetRows` for each hero class. Values come from the existing `cc0-pack-metadata` (idle/walk/attack/hurt/death = 5 rows for some, fewer for others — consult per-class).

`client/src/components/HeroAvatar.tsx` (`line 15` area): change backgroundSize to use rows:
```tsx
const bgWidth  = preview.sheetColumns * size;
const bgHeight = preview.sheetRows    * size;
// style: backgroundSize: `${bgWidth}px ${bgHeight}px`
// backgroundPosition stays '0 0' (first frame of first row = idle).
```

No other consumer of `HeroAvatar` changes its call site. Existing `size={14}` / `size={24}` / new `size={40}` all work.

### PartyBar — redesign

Two states:

| State | Width | Row layout | Row height |
|---|---|---|---|
| **Full** | 220px | `[avatar 40]` • `name + dot` / `currentActivity` (two internal text lines) | ~52px |
| **Icons-only** | 60px | Just `[avatar 40]` with status dot overlayed bottom-right as an 8px circle | ~48px |

Fold transitions width (`transition: width 0.18s ease`). State persisted in `localStorage` via `usePartyPrefs`.

**Header (Full)**:
```
Party (3 active, 2 idle)                       ◀
```
Single fold toggle button (`◀` → Icons, `▶` → Full).

**Header (Icons-only)**:
```
┌─ 5 ┐   ▶
```
Counter collapses to a single badge showing `active + idle`. Toggle button stays.

**Row content (Full)**:
- `[HeroAvatar size={40}]`
- Vertical stack to the right:
  - Top line: agent name (14px, bold, gold `#C4A35A`, ellipsis on overflow, `max-width: 130px`) + status dot (6px circle).
  - Bottom line: `currentActivity` (12px, pergamena with 70% opacity).
- Whole row is a `<button>` for accessibility. Click = `handleSelectAgent(agent.id)` (toggle via `useSelectedAgent`) + emits `camera:follow`.

**Row content (Icons-only)**:
- `[HeroAvatar size={40}]` absolutely positioned, with a `.party-status-overlay` dot (8px circle, status-colored) in the bottom-right corner.
- Hover → native `title` tooltip showing `"{name} · {currentActivity}"`.
- Same click handler.

**Visibility filter**: stays `status === 'active' || 'idle'` (no completed/error in the party).

**Sorting**: status-based order as today (`active → waiting → idle → error → completed`).

**Cap 15 removed**: the party becomes internally scrollable when the content exceeds the allotted height (`max-height: calc(100% - 208px)` — same clamp as today).

**Selection highlight** (both modes):
- Selected row: background `rgba(196,163,90,0.3)`, `border-left: 3px solid #C4A35A`, `box-shadow: 0 0 12px rgba(196,163,90,0.4)` (permanent glow while selected).
- Flash animation on selection change: when `selectedAgentId` transitions to this row's id (from any source), a 400ms CSS keyframe animation `party-select-flash` runs — keyframes pulse `box-shadow` intensity from strong → normal. Implemented via a `useEffect` in the row component that watches `isSelected`; when it flips `false → true`, it adds a CSS class `.flashing` for 400ms (cleared by a `setTimeout` + cleanup) and removes it. The permanent `box-shadow` stays regardless. Respects `prefers-reduced-motion` (keyframe disabled).

### VillageScene — selection wiring

Two additions:

1. **Hero click interaction**: each `HeroSprite` in the scene becomes clickable. On pointerdown, emit `eventBridge.emit('hero:clicked', agentId)`. No other side effects — selection is handled in App.tsx.

2. **Selection outline listener**: subscribe to a new event `selection:changed` carrying `selectedAgentId: string | null`. The listener updates each hero's visual state: selected hero gets a subtle outline (tint or stroke via `setTint` / filter), others have no outline. Cleanup on scene shutdown.

The existing `camera:follow` listener (from the previous pass) remains unchanged.

### App.tsx — selection plumbing

- New `useEffect`: listen for `hero:clicked` and call `handleSelectAgent(agentId)` (same handler used by PartyBar and feed).
- New `useEffect`: whenever `selectedAgentId` changes, emit `eventBridge.emit('selection:changed', selectedAgentId)`.
- Restore `selectedAgentId` prop on `<ActivityFeed>` (removed in the previous pass) — the feed now uses it to highlight matching rows.

### ActivityFeed container — highlight mode

Filter pills no longer hide rows. Instead:

- Container uses `useMemo` to compute `availableCategories: Set<ActionFilter>` from the current log — only categories with at least one matching entry are shown as pills in the header.
- Prefs field renamed: `activeFilters` → `activeHighlights` in `FeedPrefs`. `parsePrefs` reads both keys (backwards-compat for users with existing local storage).
- `ActivityRow` receives a new prop `highlighted: boolean` (true when `activeHighlights.length > 0 AND categorizeEntry(entry) ∈ activeHighlights`) and another `isSelected: boolean` (when `entry.agentId === selectedAgentId`).
- Highlighted rows get a colored left border (red for errors, blue for edits, gold for bash, purple for reads, cyan for agent, grey for other) plus a subtle background tint. Non-highlighted rows render as today.
- Selected-agent rows get a permanent but less intense glow (no flash — feed turnover is too high).

`filterByAction` stays in `activityFeedUtils.ts` (other consumers might want real filtering later) but is no longer called by the container.

### ActivityFeedHeader — auto-detected pills

- Accepts a new prop `availableCategories: Set<ActionFilter>` from the container.
- Renders only pills for categories present in that set.
- Each pill shows a counter: `Errors (3)`, `Edits (12)`, `Bash (4)`, `Reads (27)`, `Agent (1)`, `Other (5)`.
- Renamed prop for clarity: `activeFilters` → `activeHighlights`, `onFiltersChange` → `onHighlightsChange`.
- New filter ids `agent` and `other` join the existing four.

### activityFeedUtils — classification expansion

- `ActionFilter` type expands: `'errors' | 'edits' | 'bash' | 'reads' | 'agent' | 'other'`.
- New helper:
  ```ts
  export function categorizeEntry(action: string, detail: string): ActionFilter {
    if (isError(action, detail)) return 'errors';
    if (EDIT_ACTIONS.has(action)) return 'edits';
    if (action === 'Bash') return 'bash';
    if (READ_ACTIONS.has(action)) return 'reads';
    if (action === 'Agent') return 'agent';
    return 'other';
  }
  ```
- New helper:
  ```ts
  export function detectCategories(log: ActivityLogEntry[]): { categories: Set<ActionFilter>; counts: Record<ActionFilter, number> } {
    const counts: Record<ActionFilter, number> = { errors: 0, edits: 0, bash: 0, reads: 0, agent: 0, other: 0 };
    for (const e of log) counts[categorizeEntry(e.action, e.detail)]++;
    const categories = new Set<ActionFilter>(
      (Object.keys(counts) as ActionFilter[]).filter((k) => counts[k] > 0)
    );
    return { categories, counts };
  }
  ```
- Existing `filterByAction` stays (now internally uses `categorizeEntry`).

### usePartyPrefs — new hook

Mirror of `useFeedPrefs`, different key and payload:
- Storage key: `agentquest:partyBar:prefs`
- Payload:
  ```ts
  interface PartyPrefs {
    foldState: 'full' | 'icons';
  }
  ```
- Same architecture: defensive `parsePrefs` (per-field validation), `mergePrefs`, `useState` functional init with SSR guard, 200ms debounced write, flush-on-unmount.

If the hook ever needs to persist more than one field, the architecture is already shaped for it.

## Data flow

**Selection** (three sources, one sink):
```
hero:clicked  ──────┐
PartyBar click ─────┼─> handleSelectAgent(id) ─> useSelectedAgent.selectAgent(id)
feed avatar click ──┘                                      │
                                                           ▼
                                                   selectedAgentId state
                                                           │
                       ┌───────────────────────────────────┤
                       ▼                                   ▼
                selection:changed                  props to children
                (via eventBridge)                (PartyBar, ActivityFeed)
                       │
                       ▼
               VillageScene applies
               outline/tint to hero
```

**Camera follow** unchanged — still emitted alongside selection.

**Highlighting** (feed pills):
```
log ─> detectCategories(log) ─> availableCategories + counts
                                          │
                                          ▼
                                 ActivityFeedHeader pills
                                          │
                                  click pill → toggle in activeHighlights
                                          │
                                          ▼
                                  updatePrefs({activeHighlights})
                                          │
                                          ▼
                     ActivityRow receives highlighted=true/false
```

## Visual style

Reuses the palette established in the previous pass:
- Gold `#C4A35A`, pergamena `#F5E6C8`, blue `#7B9EC4`, path `#9ec4f5`.
- Error red background `rgba(139,37,0,0.12)`, strong `#8B2500`.
- Category colors for highlight border (NEW):
  - Errors `#8B2500`, Edits `#7B9EC4`, Bash `#C4A35A`, Reads `#9a7ac4`, Agent `#7ac49a`, Other `#888`.

PartyBar CSS gets a full restyle to match:
- Font size 14px for name, 12px for activity, 6-8px status dot, variables from the feed's `:root` reused.

## Responsive

PartyBar below 600px viewport:
- In **Full**: reduce to 180px width, name max 90px, activity 11px.
- In **Icons-only**: stay 60px.

PartyBar below 400px (phone): force Icons-only regardless of stored pref (but don't persist the forced state).

## Accessibility

- PartyBar root: `role="list"`.
- Each row: `<button type="button" role="listitem" aria-label={`Select ${name}, ${currentActivity}`}>`.
- Fold toggle: `<button aria-label="Collapse party" aria-pressed={foldState === 'icons'}>`.
- Icons-only mode: `title` attribute on each `<button>` provides the tooltip (screen readers read it too).
- Focus-visible outlines on all buttons (reuses the gold outline from the feed).
- Selected row announces via `aria-current="true"`.

Feed pills:
- When an entry becomes highlighted, the row's `aria-label` gains a prefix `[category highlighted]` — or simpler, no change, since the visual cue is a background color and screen readers don't need announcement churn for highlights.

## Persistence

- `agentquest:activityFeed:prefs` — existing, rename `activeFilters` → `activeHighlights` with backwards-compat read.
- `agentquest:partyBar:prefs` — new, `{ foldState }`.

Migration path: `parsePrefs` in `useFeedPrefs` reads both keys (`activeFilters` as fallback, preserved for one release).

## Race condition / edge cases

- **Scene hero click before agent state is in React**: unlikely because `agents:updated` is a sticky event replayed to new subscribers, but defensive: `hero:clicked` handler in App.tsx checks the id exists in `agents` before calling `handleSelectAgent`. If not, no-op.
- **Selection of an agent that then despawns**: `selectedAgentId` may point at a gone agent. The PartyBar row simply disappears (filter excludes completed), the feed rows with that `agentId` still highlight if any. No crash. If truly bothersome, App.tsx can clear selection on `agent:complete` — deferred.
- **Empty party**: Icons-only collapses to just the fold toggle and the counter badge showing `0`. Acceptable empty state.

## Testing

- `categorizeEntry` and `detectCategories` get unit tests in `activityFeedUtils.test.ts`.
- `usePartyPrefs` gets tests for `parsePrefs`/`mergePrefs`/defaults — same harness as `useFeedPrefs`.
- React components: no unit tests (no testing-library); correctness via TypeScript strict + manual smoke test.
- Stress: same criterion as feed — no unnecessary re-renders under 10 events/sec with 15 agents.

## Performance

- `detectCategories` runs on every `log` change, O(n) where n ≤ 200. Memoize with `useMemo` on `[log]`. Cheap.
- Highlighting doesn't involve filtering the list, so the existing `filtered`/`groups` memos stay valid.
- PartyBar row count no longer capped; with 50+ agents the internal scroll kicks in — no rendering of invisible rows since CSS overflow hides them but React still mounts them. If this ever matters, future virtualization; out of scope.

## File structure

### New files
- `client/src/hooks/usePartyPrefs.ts`
- `client/src/hooks/usePartyPrefs.test.ts`

### Modified
- `client/src/game/themes/types.ts` — add `sheetRows` to `HeroPreview`.
- `client/src/game/themes/tiny-swords-cc0.ts` — populate `sheetRows` for each class.
- `client/src/components/HeroAvatar.tsx` — use `sheetRows` in `backgroundSize`.
- `client/src/components/PartyBar.tsx` — full rewrite for fold states, 40px avatars, click→camera, selection highlight, remove cap 15, use `usePartyPrefs`, `<button>` rows.
- `client/src/components/PartyBar.css` — full restyle.
- `client/src/game/scenes/VillageScene.ts` — add hero click interaction (emits `hero:clicked`) + `selection:changed` listener (applies tint/outline).
- `client/src/App.tsx` — new listeners for `hero:clicked`, new emitter for `selection:changed`, pass `selectedAgentId` to `<ActivityFeed>`.
- `client/src/components/ActivityFeed.tsx` — accept `selectedAgentId` prop, drop filter call, compute `availableCategories`, pass `highlighted`/`isSelected` to rows.
- `client/src/components/ActivityFeedHeader.tsx` — rename `activeFilters` → `activeHighlights`, render auto-detected pills with counts.
- `client/src/components/ActivityRow.tsx` — new props `highlighted`, `isSelected`, apply styling accordingly.
- `client/src/components/AgentGroup.tsx` — propagate new props down to `ActivityRow`.
- `client/src/components/activityFeedUtils.ts` — expand `ActionFilter`, add `categorizeEntry`, add `detectCategories`.
- `client/src/components/activityFeedUtils.test.ts` — add tests for new helpers.
- `client/src/components/ActivityFeed.css` — highlight styling for rows + category border colors.
- `client/src/hooks/useFeedPrefs.ts` — rename `activeFilters` → `activeHighlights` with backwards-compat parse.
- `client/src/hooks/useFeedPrefs.test.ts` — update tests accordingly.

### Estimated commits
~12-14 following the prior pass's decomposition pattern (one commit per task, occasional fix commits after review).

## Acceptance criteria

1. Hero spritesheet renders correctly at any size — the first idle frame is nitidly visible at 14, 24, 40, and 60px. No collage.
2. Clicking an hero sprite in Phaser selects that agent (toggle). Clicking the same sprite again deselects.
3. PartyBar shows 40px hero avatars with status dot overlay. Name in 14px, activity in 12px.
4. PartyBar has a fold toggle; Full (220px) and Icons-only (60px) modes both functional. Preference persists across reloads.
5. Clicking a PartyBar row toggles selection AND pans the camera to that hero.
6. Selected agent: PartyBar row shows permanent gold glow + box-shadow; a 400ms flash animation triggers whenever the selection changes to this row (from any source).
7. Selected agent: Phaser hero sprite gains an outline/tint visible against the scene.
8. Selected agent: feed rows matching that agent get a subtle permanent highlight (no flash).
9. Feed filter pills are auto-derived from the current log — only categories with entries present. `Agent` and `Other` pills appear when those actions occur.
10. Click on a pill toggles highlighting: matching rows get a colored left border + background tint. Non-matching rows stay visible (no hiding). Multiselect supported.
11. Feed pills each show a counter (e.g. `Errors (3)`).
12. `localStorage` migration: existing `activeFilters` key gracefully reads as `activeHighlights` without resetting.
13. PartyBar below 600px viewport: narrower but usable. Below 400px: forced Icons-only (not persisted).
14. `bun test` passes; `tsc --noEmit` passes.

## Risks and trade-offs

- **Spritesheet row counts**: requires knowing the actual `sheetRows` per Tiny Swords hero class. If the metadata file (`cc0-pack-metadata.ts`) doesn't expose this directly, a one-time manual count is needed. Low cost, not blocking.
- **Selection flash via CSS**: triggered via a `useEffect` that adds a class and removes it after 400ms. Needs a cleanup on unmount; easy to get wrong. The spec names the risk; the plan will include the exact timer-based implementation.
- **Feed pill counters on every render**: `detectCategories` runs on `[log]`; with log up to 200 entries this is ~microseconds. Memoized, no issue.
- **Category-colored left borders**: introduces 6 new color accents in the feed. Will it look garish? Accent is subtle (border 3px, desaturated), and only visible on highlighted rows (0 active pills = no borders). Monitor during smoke test.
- **Hero sprite click in Phaser**: depends on how `HeroSprite` is constructed (is it a single interactive object, or a container?). If the existing class has `setInteractive()` already wired for dragging or hover, pointerdown needs to coexist. Verify in VillageScene before writing the plan.
- **`selectedAgentId` prop on ActivityFeed** was removed in the previous pass as dead weight. Restoring it is a minor churn cost but necessary now that we actually highlight.
- **iOS Safari flash animation**: `prefers-reduced-motion` disables it — consistent with the existing feed reduced-motion rule.
