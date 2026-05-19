/**
 * Pure helpers for placing sub-agent sprites relative to their parent hero.
 *
 * Kept Phaser-free so unit tests can pin the visual contract without a scene.
 * VillageScene calls these to decide where each attached sub-agent should
 * render frame to frame.
 */

/** Horizontal offset (in tile widths) for the *first* attached sub-agent. */
export const FIRST_CHILD_TILE_OFFSET = 0.7;

/** Incremental tile-width gap between successive sub-agents of the same parent. */
export const CHILD_STAGGER_TILE_OFFSET = 0.7;

export interface Point {
  x: number;
  y: number;
}

/**
 * Compute the screen position for an attached sub-agent given the parent
 * hero's current position, the sub-agent's index among siblings (0-based,
 * stable sort by sessionId), and the tile width in pixels.
 *
 * Layout: sub-agents fan out to the parent's right at evenly spaced
 * intervals. Index 0 sits one offset to the right, index 1 two offsets,
 * etc. Y matches the parent so feet stay on the same ground line.
 *
 * Deterministic — same inputs always yield the same position, so update
 * cycles don't jitter the layout.
 */
export function computeChildOffset(
  parentPos: Point,
  childIndex: number,
  tileWidth: number,
): Point {
  const horizontalGap =
    FIRST_CHILD_TILE_OFFSET + childIndex * CHILD_STAGGER_TILE_OFFSET;
  return {
    x: parentPos.x + horizontalGap * tileWidth,
    y: parentPos.y,
  };
}

/**
 * Determine the stable child index of `childSessionId` among a parent's
 * sub-agents. Siblings are sorted lexicographically by session id so that
 * adding or removing a sibling re-uses existing slots predictably.
 *
 * Returns -1 if `childSessionId` is not present in `siblingSessionIds`.
 */
export function childIndexOf(
  childSessionId: string,
  siblingSessionIds: readonly string[],
): number {
  const sorted = [...siblingSessionIds].sort();
  return sorted.indexOf(childSessionId);
}
