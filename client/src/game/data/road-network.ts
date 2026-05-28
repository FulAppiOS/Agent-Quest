export interface Point {
  x: number;
  y: number;
}

/**
 * Road network aligned with the handle-issue workflow order so heroes travel
 * in a coherent direction rather than zigzagging across the village.
 *
 * Spine: Gate(0) → south-junction(1) → center(3) → north-junction(5)
 * Spurs to each building's access node:
 *   • Library:   1 → 6        (reading — first stop after spawn)
 *   • Tavern:    2 ↔ 3        (idle — western plaza)
 *   • Forge:     3 → 11       (editing)
 *   • Arena:     4 → 12       (bash)
 *   • Debug triangle: 11 ↔ 12, 11 ↔ 8, 12 ↔ 8   (edit/bash/debug cluster)
 *   • Castle:    5 → 7        (thinking)
 *   • Chapel:    5 → 9        (git)
 *   • Watchtower: 9 → 10      (reviewing)
 */
const DEFAULT_WAYPOINTS: Point[] = [
  { x: 1400, y: 1130 }, // 0  gate
  { x: 1380, y: 960 },  // 1  south-junction (gateway to library and center)
  { x: 1250, y: 780 },  // 2  plaza / tavern hub (west)
  { x: 1400, y: 780 },  // 3  center-junction
  { x: 1540, y: 780 },  // 4  east-junction
  { x: 1400, y: 600 },  // 5  north-junction (thinking / git branch)
  { x: 1150, y: 900 },  // 6  library-access (reading)
  { x: 1300, y: 700 },  // 7  castle-access (thinking)
  { x: 1470, y: 700 },  // 8  alchemist-access (debugging)
  { x: 1720, y: 560 },  // 9  chapel-access (git)
  { x: 1600, y: 450 },  // 10 watchtower-access (reviewing)
  { x: 1380, y: 880 },  // 11 forge-access (editing) — matches BUILDING_DEFS
  { x: 1560, y: 880 },  // 12 arena-access (bash)   — matches BUILDING_DEFS
];

const DEFAULT_EDGES: [number, number][] = [
  // N-S main spine
  [0, 1], [1, 3], [3, 5],
  // Library spur (reading — first stop after gate)
  [1, 6],
  // E-W through center to east
  [2, 3], [3, 4],
  // Editing and bash access from their junctions
  [3, 11], [4, 12],
  // Editing ↔ Bash ↔ Debug tight triangle (most frequent mutual transitions)
  [11, 12], [11, 8], [12, 8],
  // Thinking spur
  [5, 7],
  // Debug from north (test-fail loop)
  [5, 8],
  // Git / review branch
  [5, 9], [9, 10],
];

// ---------------------------------------------------------------------------
// Mutable active graph — swapped when a MapConfig is loaded
// ---------------------------------------------------------------------------

function buildAdjacency(waypoints: Point[], edges: [number, number][]): Map<number, number[]> {
  const adj: Map<number, number[]> = new Map();
  for (let i = 0; i < waypoints.length; i++) adj.set(i, []);
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  return adj;
}

let activeWaypoints: Point[] = DEFAULT_WAYPOINTS;
let activeEdges: [number, number][] = DEFAULT_EDGES;
let activeAdjacency: Map<number, number[]> = buildAdjacency(DEFAULT_WAYPOINTS, DEFAULT_EDGES);

function setRoadNetwork(waypoints: Point[], edges: [number, number][]): void {
  activeWaypoints = waypoints;
  activeEdges = edges;
  activeAdjacency = buildAdjacency(waypoints, edges);
}

/** Restore the default hardcoded road network (procedural terrain). */
export function resetRoadNetwork(): void {
  setRoadNetwork(DEFAULT_WAYPOINTS, DEFAULT_EDGES);
}

// ---------------------------------------------------------------------------
// Build a dynamic road network from editor paths + building positions
// ---------------------------------------------------------------------------

const MERGE_DIST = 15;
/** How close a path endpoint must be to another path's segment to auto-connect. Euclidean px. */
const STITCH_DIST = 40;
/** Polyline legs longer than this get subdivided so heroes walk in small steps
 *  instead of teleporting across the whole segment in a single tween. */
const SUBDIVIDE_ABOVE = 40;
/** Target spacing between interpolated waypoints along a long leg. */
const SUBDIVIDE_STEP = 25;

function distEuclidean(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Perpendicular distance from point p to segment [a,b], and the clamped
 * parameter t ∈ [0,1] of the projection along the segment.
 */
function projectOntoSegment(p: Point, a: Point, b: Point): { dist: number; t: number } {
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const lenSq = ax * ax + ay * ay;
  if (lenSq < 1e-6) return { dist: distEuclidean(p, a), t: 0 };
  let t = ((p.x - a.x) * ax + (p.y - a.y) * ay) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * ax;
  const projY = a.y + t * ay;
  const dx = p.x - projX;
  const dy = p.y - projY;
  return { dist: Math.sqrt(dx * dx + dy * dy), t };
}

/**
 * Return the points to append after `a` to reach `b`, subdividing the segment
 * into evenly-spaced waypoints when it exceeds SUBDIVIDE_ABOVE. Always ends
 * with `b` itself so the original vertex is preserved.
 */
function interpolateSegment(a: Point, b: Point): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len <= SUBDIVIDE_ABOVE) return [{ x: b.x, y: b.y }];
  const steps = Math.max(2, Math.round(len / SUBDIVIDE_STEP));
  const out: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    out.push({ x: a.x + t * dx, y: a.y + t * dy });
  }
  return out;
}

/**
 * Construct a road-network graph from the editor's drawn paths and the
 * (possibly repositioned) building positions.  Each path polyline vertex
 * becomes a waypoint, consecutive vertices become edges, and each building
 * door is connected to the nearest path waypoint.
 *
 * Also auto-stitches path endpoints that are close to another path's segment
 * but don't share a vertex with it — keeps the routing graph connected when
 * users draw paths that visually meet but don't exactly touch.
 */
export function buildRoadNetworkFromPaths(
  paths: Array<{ points: Array<{ x: number; y: number }> }>,
  buildings: Array<{ id: string; x: number; y: number }>,
): void {
  const waypoints: Point[] = [];
  const edges: [number, number][] = [];

  function addWaypoint(p: Point): number {
    for (let i = 0; i < waypoints.length; i++) {
      if (dist(waypoints[i]!, p) <= MERGE_DIST) return i;
    }
    waypoints.push(p);
    return waypoints.length - 1;
  }

  // 1. Path polyline vertices → waypoints, consecutive pairs → edges.
  //    Track which waypoints belong to each path so we can stitch endpoints later.
  const pathWaypointIndices: number[][] = [];
  for (const path of paths) {
    const indices: number[] = [];
    let prevIdx = -1;
    for (const pt of path.points) {
      const idx = addWaypoint({ x: pt.x, y: pt.y });
      if (prevIdx !== -1 && prevIdx !== idx) {
        edges.push([prevIdx, idx]);
      }
      indices.push(idx);
      prevIdx = idx;
    }
    pathWaypointIndices.push(indices);
  }

  // 2. Stitch path endpoints (first / last vertex) to the nearest segment of any
  //    OTHER path if their perpendicular distance is under STITCH_DIST.
  //    Connect to the nearer of the two segment endpoints.
  for (let pi = 0; pi < pathWaypointIndices.length; pi++) {
    const indices = pathWaypointIndices[pi]!;
    if (indices.length < 1) continue;
    const endpointIdxs: number[] = [];
    endpointIdxs.push(indices[0]!);
    const last = indices[indices.length - 1]!;
    if (last !== indices[0]) endpointIdxs.push(last);

    for (const endIdx of endpointIdxs) {
      const endP = waypoints[endIdx]!;
      let best: { dist: number; nearestWp: number } | null = null;
      for (let pj = 0; pj < pathWaypointIndices.length; pj++) {
        if (pj === pi) continue;
        const other = pathWaypointIndices[pj]!;
        for (let k = 0; k < other.length - 1; k++) {
          const aIdx = other[k]!;
          const bIdx = other[k + 1]!;
          if (aIdx === endIdx || bIdx === endIdx) continue;
          const proj = projectOntoSegment(endP, waypoints[aIdx]!, waypoints[bIdx]!);
          if (proj.dist < STITCH_DIST && (best === null || proj.dist < best.dist)) {
            best = { dist: proj.dist, nearestWp: proj.t < 0.5 ? aIdx : bIdx };
          }
        }
      }
      if (best !== null && best.nearestWp !== endIdx) {
        edges.push([endIdx, best.nearestWp]);
      }
    }
  }

  // 3. Building doors → waypoints, each connected to nearest path waypoint
  const pathWaypointCount = waypoints.length;
  for (const b of buildings) {
    const doorPoint: Point = { x: b.x, y: b.y + 5 };
    const doorIdx = addWaypoint(doorPoint);
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < pathWaypointCount; i++) {
      const d = dist(waypoints[i]!, doorPoint);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx !== -1) {
      edges.push([doorIdx, bestIdx]);
    }
  }

  // If no paths at all, fall back to defaults so heroes can still move
  if (waypoints.length === 0) {
    resetRoadNetwork();
    return;
  }

  setRoadNetwork(waypoints, edges);
}

// ---------------------------------------------------------------------------
// Pathfinding (reads from active graph)
// ---------------------------------------------------------------------------

function dist(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function nearestWaypoint(p: Point): number {
  let best = 0;
  let bestDist = dist(p, activeWaypoints[0]!);
  for (let i = 1; i < activeWaypoints.length; i++) {
    const d = dist(p, activeWaypoints[i]!);
    if (d < bestDist) { best = i; bestDist = d; }
  }
  return best;
}

function bfs(startIdx: number, endIdx: number): number[] {
  if (startIdx === endIdx) return [startIdx];
  const visited = new Set<number>([startIdx]);
  const queue: number[][] = [[startIdx]];
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1]!;
    for (const neighbor of activeAdjacency.get(current) ?? []) {
      if (neighbor === endIdx) return [...path, neighbor];
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }
  return [startIdx, endIdx];
}

export function findRoadPath(from: Point, to: Point): Point[] {
  const startIdx = nearestWaypoint(from);
  const endIdx = nearestWaypoint(to);
  const waypointPath = bfs(startIdx, endIdx);
  const coarse: Point[] = [from];
  for (const idx of waypointPath) {
    const wp = activeWaypoints[idx]!;
    const lastPoint = coarse[coarse.length - 1]!;
    if (dist(lastPoint, wp) > 10) coarse.push(wp);
  }
  const lastCoarse = coarse[coarse.length - 1]!;
  if (dist(lastCoarse, to) > 10) coarse.push(to);

  // Interpolate long legs into short steps so moveAlongPath emits many short
  // tweens instead of one long glide across the whole segment. Graph itself
  // stays coarse — only the path returned to the hero is denser.
  const out: Point[] = [coarse[0]!];
  for (let i = 1; i < coarse.length; i++) {
    for (const step of interpolateSegment(coarse[i - 1]!, coarse[i]!)) {
      out.push(step);
    }
  }
  return out;
}

/** Exposed so TerrainRenderer can paint roads along the same network. */
export function getRoadSegments(): Array<{ a: Readonly<Point>; b: Readonly<Point>; main: boolean }> {
  // Main spine: gate(0)→south-junction(1)→center(3)→north-junction(5)
  const mainEdges = new Set(['0-1', '1-3', '3-5']);
  const result: Array<{ a: Readonly<Point>; b: Readonly<Point>; main: boolean }> = [];
  for (const [a, b] of activeEdges) {
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    result.push({ a: activeWaypoints[a]!, b: activeWaypoints[b]!, main: mainEdges.has(key) });
  }
  return result;
}
