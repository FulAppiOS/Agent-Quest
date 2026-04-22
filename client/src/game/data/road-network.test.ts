import { describe, test, expect, beforeEach } from 'bun:test';
import {
  buildRoadNetworkFromPaths,
  findRoadPath,
  resetRoadNetwork,
  getRoadSegments,
} from './road-network';

beforeEach(() => {
  resetRoadNetwork();
});

describe('findRoadPath — output interpolation', () => {
  test('long straight leg produces many interpolated output points', () => {
    buildRoadNetworkFromPaths(
      [{ points: [{ x: 0, y: 0 }, { x: 500, y: 0 }] }],
      [],
    );
    const path = findRoadPath({ x: 0, y: 0 }, { x: 500, y: 0 });
    // 500px leg at ~25px steps → ~20 output points (plus the start).
    expect(path.length).toBeGreaterThanOrEqual(15);
  });

  test('short leg produces minimal output points', () => {
    buildRoadNetworkFromPaths(
      [{ points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] }],
      [],
    );
    const path = findRoadPath({ x: 0, y: 0 }, { x: 20, y: 0 });
    // No subdivision for sub-threshold legs — just start and end.
    expect(path.length).toBeLessThanOrEqual(3);
  });

  test('interpolated points lie on the straight line between vertices', () => {
    buildRoadNetworkFromPaths(
      [{ points: [{ x: 0, y: 0 }, { x: 400, y: 0 }] }],
      [],
    );
    const path = findRoadPath({ x: 0, y: 0 }, { x: 400, y: 0 });
    for (const p of path) {
      expect(Math.abs(p.y)).toBeLessThan(0.5); // all points on y=0
      expect(p.x).toBeGreaterThanOrEqual(-0.5);
      expect(p.x).toBeLessThanOrEqual(400.5);
    }
  });

  test('multi-vertex polyline interpolates each long leg', () => {
    buildRoadNetworkFromPaths(
      [{ points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }] }],
      [],
    );
    const path = findRoadPath({ x: 0, y: 0 }, { x: 200, y: 200 });
    // Each 200px leg → ~8 steps; total ≥ 14 points.
    expect(path.length).toBeGreaterThanOrEqual(14);
  });
});

describe('buildRoadNetworkFromPaths — graph structure stays coarse', () => {
  test('graph keeps one edge per drawn leg (rendering-friendly)', () => {
    buildRoadNetworkFromPaths(
      [{ points: [{ x: 0, y: 0 }, { x: 500, y: 0 }] }],
      [],
    );
    // Only the original 2 vertices live in the graph so TerrainRenderer still
    // paints one long road, not 20 short ones.
    expect(getRoadSegments().length).toBe(1);
  });
});
