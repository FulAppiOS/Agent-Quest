# Activity Feed Redesign — Design Spec

**Date**: 2026-04-23
**Status**: Approved for implementation planning
**Component**: `client/src/components/ActivityFeed.tsx` + `.css`

## Goal

Replace the current Activity Feed (62-line stateless component, 10px font, fixed widths, no interaction) with a richer panel that uses real hero sprites, supports two view modes, three fold states, action-typed filters, and direct interaction with each entry. Persist user preferences across sessions.

The current feed is read-only and visually cramped. With 5+ concurrent agents it becomes illegible and offers no way to focus on what matters.

## Out of scope

- Virtualization (200-entry cap is sufficient for current scale).
- Full-text search across detail.
- Browser-side transcript viewer (separate future spec).
- Spawning external terminals from the server.

## Architecture

```
useAgentState (existing) ──► ActivityFeed (new)
       │                          │
       │                          ├── ActivityFeedHeader
       │                          │     ├── Tabs (All / By Agent)
       │                          │     ├── FoldButtons (Full / Compact / Closed)
       │                          │     └── FilterPills (Full state only)
       │                          │
       │                          ├── ActivityFeedList
       │                          │     ├── ActivityRow (memoized)
       │                          │     │     ├── HeroAvatar (24px sprite)
       │                          │     │     ├── AgentName
       │                          │     │     ├── ActionPill
       │                          │     │     ├── Timestamp
       │                          │     │     └── PathDetail (clickable)
       │                          │     │
       │                          │     └── AgentGroup (in By Agent mode)
       │                          │           ├── GroupHeader
       │                          │           └── ActivityRow[] (no avatar/name)
       │                          │
       │                          └── ContextMenu (right-click)
       │
useFeedPrefs (new hook)  ◄──► localStorage('agentquest:activityFeed:prefs')
```

`ActivityFeed` reads agents/log via existing `useAgentState`, owns local state for derived data (filtered/grouped), and reads/writes preferences via `useFeedPrefs`. Selection (click on sprite/group header) reuses the existing `useSelectedAgent` hook and the `eventBridge` for camera follow.

## Components

### ActivityFeed (container)

Top-level component. Owns:
- Filter pipeline (raw log → filtered by action type → filtered by agent chip → grouped if `byAgent`).
- Fold state class on root element.
- Auto-scroll lock state (boolean: user-pinned to top vs scrolled).

Memoizes the derived list with `useMemo` keyed on `[log, activeFilters, agentFilter, viewMode]`.

### ActivityFeedHeader

Two rows, second row hidden in Compact and Closed:

**Row 1**: Title `Activity Feed` · Tabs `[All | By Agent]` · spacer · `[▭ ▬ ▼]` fold buttons. In **Closed**, the title shows a `N new` badge that pulses when entries arrive while folded.

**Row 2** (Full only): Filter pills `[All] [Errors] [Edits] [Bash] [Reads]` (multiselect — `All` is mutually exclusive). Pills filter on action type derived from `entry.action`:
- `Errors` — bash entries with non-zero exit detected in detail (heuristic: detail contains `→ exit ` or `error:` prefix; refine after first dataset review).
- `Edits` — `Edit`, `Write`, `NotebookEdit`.
- `Bash` — `Bash`.
- `Reads` — `Read`, `Grep`, `Glob`.
- Anything else (Agent, etc.) is hidden when any pill except `All` is active.

If an `agentFilter` is active, a chip appears in Row 2 with `× to clear`: e.g. `[ 🛡️ explorer × ]`.

### ActivityRow

Two-line layout, 14px font, `display: grid` with `grid-template-columns: 24px minmax(0, 1fr)`:

```
[sprite] [agent_name] [ACTION] [time]
         [path or detail in #9ec4f5 / #F5E6C8]
```

- Sprite: `<HeroAvatar agent={agent} size={24} />` — uses `getActiveTheme().getHeroPreview(heroColor, heroClass)`, same API the PartyBar already uses (`tiny-swords-cc0.ts:168`). Background-image with `background-position: 0 0` for the idle frame.
- Agent name: 12px, bold, color `#C4A35A`. Truncated with ellipsis on overflow, full name in `title` attribute.
- Action: pill with bg `rgba(123,158,196,0.2)`, color `#7B9EC4`, uppercase, 10px.
- Timestamp: 11px, `#888`, `font-variant-numeric: tabular-nums`.
- Detail: 14px, color `#9ec4f5` if it looks like a path (contains `/` and a file extension or starts with `.`/`/`), else `#F5E6C8`. Truncated, full text in `title`.
- Error rows (`isError` heuristic above): row background `rgba(139,37,0,0.12)`, ACTION pill colored red.
- Wrapped in `React.memo` keyed on entry timestamp + agentId + a `prefs` slot to skip re-renders when only unrelated state changes.

### AgentGroup (By Agent mode)

When `viewMode === 'byAgent'`:
- Group entries by `agentId`.
- Order groups by most recent activity timestamp (descending).
- Each group has a header row: `[24px sprite] agent_name · current_activity` styled as Row 1 of an entry but bolder, with a dashed bottom border.
- Inside each group, entries render without the avatar column (indent 32px) and without the agent name. Show ACTION + detail + timestamp only.
- Groups collapse implicitly to last 3 entries with a `+ N more` link to expand inline.

### Click behaviors

| Target | Action |
|---|---|
| Sprite avatar (or group header sprite) | `selectAgent(agent.id)` + `eventBridge.emit('camera:follow', agent.id)` |
| Agent name | `setAgentFilter(agent.id)` — feed filters to that agent, chip appears |
| Path detail (when `isPath`) | Anchor with `href="vscode://file/{absolutePath}"` (see "Path resolution" below) |
| Rest of row | No-op |
| Right-click on row | Context menu: `Copy path` · `Copy detail` · `Filter to this agent` |
| Hover sprite | Tooltip after 400ms: agent name (full), class, cwd basename, status, session duration |

`camera:follow` is a new event on `eventBridge`. The Phaser `VillageScene` subscribes to it and tweens its camera to the hero's tile. If the hero is offscreen due to fold/scroll, it pans there; if already centered, it pulses a highlight.

### Path resolution

The `detail` field arrives as the raw `event.file ?? event.command ?? ''` from the server. For Read/Edit/Write tool calls it's typically already absolute, but not guaranteed.

Resolution rule for the `href` on a path:
- If detail starts with `/` → use as-is.
- Else if detail starts with `~` → expand to user home (skip — `vscode://` doesn't accept `~`; treat as not-a-path).
- Else (relative) → resolve against `agent.cwd` from the corresponding `AgentState`. If the agent isn't in the current `agents` array (rare race), render the path with no link.

`isPath` heuristic stays simple (slashes + extension) — wrong on edge cases but harmless because the link either opens the right file or VS Code shows a "file not found" toast.

### Auto-scroll lock

Standard Discord/Slack pattern:
- Default: feed is pinned to top (newest first), new entries push down.
- If user scrolls down (older entries), `pinned = false`. New entries still arrive but don't scroll the view.
- A floating button `↑ Jump to latest (N new)` appears at the top-left of the list.
- Scrolling all the way back to top restores `pinned = true`.

### Fold states

| State | Height | Header rows | Visible content |
|---|---|---|---|
| Full | 180px | 2 (title+tabs+fold, filter pills) | ~6 rows |
| Compact | 80px | 1 (title+tabs+fold) | ~2 rows |
| Closed | 28px | 1 (title only, with `N new` badge) | none |

Buttons in header: `▭` Full · `▬` Compact · `▼` Closed. Active state highlighted.

### Empty state

When `log.length === 0`:
- Centered text: `Waiting for agent activity...`
- Subtitle: `Launch Claude Code in any project — it'll appear here.`
- Color `#666`, 12px subtitle, no animation.

## State management

### useFeedPrefs hook

```ts
interface FeedPrefs {
  foldState: 'full' | 'compact' | 'closed';
  viewMode: 'all' | 'byAgent';
  activeFilters: ('errors' | 'edits' | 'bash' | 'reads')[];  // empty = all
  agentFilter: string | null;
}
```

- Stored in `localStorage` under key `agentquest:activityFeed:prefs`.
- Hook returns `[prefs, updatePrefs]`. `updatePrefs` accepts a partial and merges.
- Reads on mount with defensive parse (try/catch + default fallback).
- Writes debounced 200ms.

### Derived data

Inside `ActivityFeed`:
```ts
const filtered = useMemo(() =>
  filterByAgent(filterByAction(log, activeFilters), agentFilter),
  [log, activeFilters, agentFilter]
);

const grouped = useMemo(() =>
  viewMode === 'byAgent' ? groupByAgent(filtered) : null,
  [filtered, viewMode]
);
```

`filterByAction` and `groupByAgent` are pure helpers in a sibling `activityFeedUtils.ts`.

## Visual style

Inherits the existing palette and font stack:
- Background: `rgba(26, 26, 46, 0.9)`
- Border-top: `1px solid rgba(196, 163, 90, 0.4)`
- Title font: `'Cinzel', serif`, color `#C4A35A`
- Body font: `'Fira Code', ui-monospace, monospace`, 14px
- Path color: `#9ec4f5`
- Pergamena color (regular detail): `#F5E6C8`
- Action pill: `rgba(123, 158, 196, 0.2)` bg, `#7B9EC4` text
- Error tint: `rgba(139, 37, 0, 0.12)` bg

## Responsive

Breakpoint at 600px viewport width:

**Above 600px** (default): two-row header in Full state, full action pills, full agent names.

**Below 600px** (tablet portrait):
- Header collapses to single row even in Full: title + tabs + fold buttons. Filter pills move to a horizontal scrollable strip below the row.
- Agent name column max-width 100px (was 130px).
- Action pill stays.
- Detail row takes remaining width.
- Timestamp moves into the detail row (right-aligned) to save vertical space.
- Right-click context menu becomes a long-press menu on touch devices.

Layout uses `display: grid` everywhere — no fixed `width` on cells. CSS variables (`--feed-row-min-height`, `--feed-avatar-size`) parameterize sizes for easy theming.

## Accessibility

- Root element: `role="log"` `aria-live="polite"` `aria-relevant="additions"`.
- Each row: `role="listitem"` inside `role="list"`.
- Sprite avatar: `role="button"` `aria-label="Select agent {name}"`, focusable with Tab.
- Path: rendered as `<a href="vscode://...">` (when resolvable to an absolute path) to be naturally focusable and keyboard-activatable. When unresolvable, rendered as plain text with no link.
- Filter pills and fold buttons: real `<button>` elements with `aria-pressed`.
- Tabs `All / By Agent`: `role="tablist"` + `role="tab"` + `aria-selected`.
- Color contrast: 14px body on dark bg passes WCAG AA (current 10px did not).
- Reduced motion: `prefers-reduced-motion` disables fade-in animation.

## Race condition note

The current `getAgentName` regex fallback in `ActivityFeed.tsx:24-36` covers a race that, per analysis, cannot occur on a single TCP WebSocket: server emits `agent:new` before `activity:log` for the same line (`server/src/index.ts:117-127`). The fallback stays as a safety net (innocuous, ~5 lines), moved into `activityFeedUtils.ts` for cleanliness. No behavioral change. If we observe `agent-...` strings in the wild, that's a real bug worth a separate investigation.

## Performance

Risk: feed re-renders on every WebSocket event because `agents` is a new array reference each time `setAgents` runs.

Mitigations:
1. `ActivityRow` wrapped in `React.memo` with shallow prop check (timestamp + agentId + isError + agentName + paths are primitives).
2. `useMemo` on the filtered/grouped lists.
3. `useFeedPrefs` writes debounced to localStorage so rapid clicks (e.g., toggling filters) don't thrash storage.

Stress test target: 15 concurrent agents, 10 events/sec total, 60fps maintained on the React side. Verified manually before merge.

## File structure

```
client/src/components/
├── ActivityFeed.tsx          (container, ~120 lines)
├── ActivityFeed.css          (~180 lines)
├── ActivityFeedHeader.tsx    (~60 lines)
├── ActivityRow.tsx           (~70 lines, memoized)
├── AgentGroup.tsx            (~50 lines, By Agent mode)
├── HeroAvatar.tsx            (~30 lines, reused from PartyBar pattern)
└── activityFeedUtils.ts      (~80 lines: filtering, grouping, isPath, isError)

client/src/hooks/
└── useFeedPrefs.ts           (~50 lines)
```

`HeroAvatar` is extracted as a shared component since both `PartyBar` and `ActivityFeed` need it. PartyBar gets refactored to use it (small win, no behavior change).

## Acceptance criteria

1. Font is 14px throughout the feed; rows are legible from a normal seating distance.
2. Three fold states cycle correctly via the three header buttons; state persists across reload.
3. Toggling `All / By Agent` rearranges entries instantly; selection persists across reload.
4. Filter pills (multiselect) reduce the visible set; chip-based agent filter coexists with action filters.
5. Clicking a sprite in any row selects that agent in the Party + the Phaser camera tweens to its hero.
6. Clicking an agent name adds it as the current `agentFilter` chip.
7. Clicking a blue path opens it in VS Code (when `vscode://` is registered) — verifiable by clicking on a known-good `*.ts` path while VS Code is installed.
8. Right-click on a row opens a context menu with `Copy path`, `Copy detail`, `Filter to this agent`. Each action works.
9. Auto-scroll lock engages on user scroll, releases on scroll-to-top. `Jump to latest` button appears when locked + new entries arrive.
10. Empty state shows when no events received.
11. Below 600px viewport, header collapses to single row, agent name column shrinks, no horizontal page scroll.
12. `aria-live="polite"` announces new entries to screen readers; sprite buttons are keyboard-focusable.
13. With 15 agents emitting 10 events/sec for 60s, React DevTools profiler shows no row re-render when its props haven't changed; main thread stays under 16ms per frame.

## Risks and trade-offs

- **VS Code URL handler not registered**: clicking a path silently fails. Acceptable: user discovers they need VS Code (or some editor that handles `vscode://`). Could add a one-time toast on first failure in a follow-up.
- **`isPath` heuristic mistakes**: regex on detail string can mis-classify (e.g., a Bash command that contains a path-like fragment). Erring on the side of "color it blue, click does nothing useful" is mild. Refine after dataset review.
- **`isError` heuristic**: bash-only, string-based. False negatives likely. Real fix is server-side (parse exit codes from JSONL), but out of scope here. The pill stays subtle (red tint, not alarm).
- **By Agent collapse `+ N more`**: adds inline expansion state per group. Slight complexity, but groups with 50+ events become unusable otherwise.
- **HeroAvatar extraction**: refactoring PartyBar at the same time slightly widens the change. Acceptable — both consumers should share one source of truth.
