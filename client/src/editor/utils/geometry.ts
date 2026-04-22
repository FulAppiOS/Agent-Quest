import { TILE_SIZE } from '../types/map';

export function worldToCell(x: number, y: number): { col: number; row: number } {
  return { col: Math.floor(x / TILE_SIZE), row: Math.floor(y / TILE_SIZE) };
}

export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function parseCellKey(key: string): { col: number; row: number } | null {
  const parts = key.split(',');
  if (parts.length !== 2) return null;
  const a = parts[0];
  const b = parts[1];
  if (a === undefined || b === undefined) return null;
  const col = parseInt(a, 10);
  const row = parseInt(b, 10);
  if (Number.isNaN(col) || Number.isNaN(row)) return null;
  return { col, row };
}

/** Squared distance from a point to a line segment. */
export function distSqPointSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = px - x1;
    const ey = py - y1;
    return ex * ex + ey * ey;
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/** Minimum distance from point to a polyline (array of {x,y}). */
export function distPointToPolyline(
  px: number,
  py: number,
  points: Array<{ x: number; y: number }>,
): number {
  if (points.length === 0) return Infinity;
  const first = points[0];
  if (first === undefined) return Infinity;
  if (points.length === 1) {
    const dx = px - first.x;
    const dy = py - first.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    const d2 = distSqPointSegment(px, py, a.x, a.y, b.x, b.y);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}
