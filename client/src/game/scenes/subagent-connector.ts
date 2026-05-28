/**
 * Pure helpers for rendering the connector line between a parent hero and its
 * attached sub-agents.
 *
 * Kept Phaser-free so unit tests can verify the geometry without a live scene.
 * VillageScene calls `buildConnectorSegments` each frame then draws the result
 * with a Phaser Graphics object.
 */

/** Phaser hex color for the connector dashed line (soft cyan-purple, fantasy feel). */
export const CONNECTOR_COLOR = 0x9b72cf;

/** Opacity of the connector line — subtle enough not to overpower sprites. */
export const CONNECTOR_ALPHA = 0.55;

/** Stroke width in pixels. Thin so it reads as a relation hint, not a UI chrome. */
export const CONNECTOR_LINE_WIDTH = 1.5;

/** Length of each drawn dash segment in pixels. */
export const CONNECTOR_DASH_LENGTH = 6;

/** Length of the gap between dash segments in pixels. */
export const CONNECTOR_GAP_LENGTH = 4;

export interface ConnectorPair {
  parentX: number;
  parentY: number;
  childX: number;
  childY: number;
}

export interface ConnectorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Euclidean distance between endpoints (pre-computed for dash iteration). */
  length: number;
}

/**
 * Convert an array of parent-child world-position pairs into connector segment
 * descriptors ready for rendering.
 *
 * The caller (VillageScene.update) collects current positions each frame and
 * passes them here. This function stays pure so it's trivially testable.
 */
export function buildConnectorSegments(
  pairs: readonly ConnectorPair[],
): ConnectorSegment[] {
  return pairs.map(({ parentX, parentY, childX, childY }) => {
    const dx = childX - parentX;
    const dy = childY - parentY;
    const length = Math.sqrt(dx * dx + dy * dy);
    return { x1: parentX, y1: parentY, x2: childX, y2: childY, length };
  });
}
