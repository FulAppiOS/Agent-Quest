# Agent Positioning & Idle Visibility Design

**Date**: 2026-04-16
**Status**: Approved

## Problem

1. Multiple heroes at the same building stack on the exact same (doorX, doorY) coordinate
2. Idle agents accumulate at the Tavern with no distinction between recent and stale sessions
3. No visual separation between active work and long-dormant sessions

## Solution

### 1. Dynamic Grid Layout at Buildings

When multiple heroes target the same building, they arrange in a centered grid below the building door.

- **Columns**: `Math.ceil(Math.sqrt(n))` where n = number of heroes at the building
- **Spacing**: 40px horizontal, 35px vertical
- **Anchor**: grid centered horizontally on `doorX`, extends downward from `doorY`
- **Slot assignment**: stable ordering by arrival (tracked via `buildingSlots` map)

Example with 6 heroes (3 columns):
```
        [building]
     H1   H2   H3
     H4   H5   H6
```

### 2. Idle Agent Classification

The client classifies agents into three visual tiers based on `lastEvent` timestamp:

| State | Condition | Visual behavior |
|-------|-----------|-----------------|
| active | Has recent events | At activity building, grid layout |
| idle (recent) | 60s - 2h without events | Grid at Tavern + micro-movements |
| hidden | >2h without events | Removed from Phaser scene, stays in PartyBar |

The server continues sending all agents. The client filters >2h agents from the Phaser scene only.

### 3. Micro-movements for Idle Heroes

Idle heroes at the Tavern exhibit subtle fidget behavior:

- Every 3-6 seconds (randomized per hero), offset +-5-10px from grid position
- Movement speed: 50px/s (slower than normal walk)
- Returns to grid base position before next fidget
- Uses idle animation throughout (no run animation)

### 4. Building Slot Management

`VillageScene` maintains a `buildingSlots: Map<string, string[]>` tracking which heroes are at which building.

When a hero changes building:
1. Remove from old building's slot list
2. Add to new building's slot list
3. Recalculate grid positions for both buildings
4. Existing heroes tween to new grid positions

### 5. Grid Position Calculation

```
function calcGridPositions(doorX, doorY, count):
  cols = ceil(sqrt(count))
  rows = ceil(count / cols)
  spacingX = 40
  spacingY = 35
  offsetX = (cols - 1) * spacingX / 2

  for i in 0..count-1:
    col = i % cols
    row = floor(i / cols)
    x = doorX - offsetX + col * spacingX
    y = doorY + row * spacingY
    yield (x, y)
```

## Files to Modify

- `client/src/game/scenes/VillageScene.ts` — grid logic, slot management, idle filtering, micro-movements
- `client/src/game/entities/HeroSprite.ts` — fidget tween support
- `client/src/types/agent.ts` — add `lastEvent` to client AgentState if missing

## Files NOT Modified

- `server/` — no server changes needed; idle detection stays as-is
- `building-layout.ts` — building positions unchanged
