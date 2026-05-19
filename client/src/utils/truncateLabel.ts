/**
 * Collapse whitespace and clip to `max` chars — every head-stack label sits on
 * a single line, so wrapped multi-line strings would push neighbouring badges
 * out of frame. The ellipsis preserves intent ("there was more") without
 * leaking formatting noise (newlines, tabs) into the canvas. Spread iterates
 * code points (not UTF-16 code units), so emoji and other supplementary-plane
 * characters don't get sliced mid-surrogate-pair and render as replacement
 * glyphs above the hero.
 */
export function truncateLabel(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  const chars = [...single];
  if (chars.length <= max) return single;
  return chars.slice(0, max - 1).join('') + '…';
}
