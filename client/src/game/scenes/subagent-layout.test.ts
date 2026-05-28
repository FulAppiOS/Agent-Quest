import { describe, test, expect } from 'bun:test';
import {
  CHILD_STAGGER_TILE_OFFSET,
  FIRST_CHILD_TILE_OFFSET,
  childIndexOf,
  computeChildOffset,
} from './subagent-layout';

describe('computeChildOffset', () => {
  test('first child sits one offset to the parent right, same Y', () => {
    const result = computeChildOffset({ x: 100, y: 200 }, 0, 32);
    expect(result.x).toBeCloseTo(100 + FIRST_CHILD_TILE_OFFSET * 32);
    expect(result.y).toBe(200);
  });

  test('second child stays staggered by one tile beyond the first', () => {
    const result = computeChildOffset({ x: 100, y: 200 }, 1, 32);
    const expectedGap =
      FIRST_CHILD_TILE_OFFSET + CHILD_STAGGER_TILE_OFFSET;
    expect(result.x).toBeCloseTo(100 + expectedGap * 32);
    expect(result.y).toBe(200);
  });

  test('third child continues deterministic fan-out', () => {
    const result = computeChildOffset({ x: 100, y: 200 }, 2, 32);
    const expectedGap =
      FIRST_CHILD_TILE_OFFSET + 2 * CHILD_STAGGER_TILE_OFFSET;
    expect(result.x).toBeCloseTo(100 + expectedGap * 32);
  });

  test('deterministic — same inputs yield same outputs', () => {
    const a = computeChildOffset({ x: 50, y: 75 }, 3, 16);
    const b = computeChildOffset({ x: 50, y: 75 }, 3, 16);
    expect(a).toEqual(b);
  });

  test('scales with tile width', () => {
    const small = computeChildOffset({ x: 0, y: 0 }, 0, 10);
    const large = computeChildOffset({ x: 0, y: 0 }, 0, 100);
    expect(large.x).toBeCloseTo(small.x * 10);
  });
});

describe('childIndexOf', () => {
  test('returns lexicographically sorted index', () => {
    const siblings = ['agent-c', 'agent-a', 'agent-b'];
    expect(childIndexOf('agent-a', siblings)).toBe(0);
    expect(childIndexOf('agent-b', siblings)).toBe(1);
    expect(childIndexOf('agent-c', siblings)).toBe(2);
  });

  test('stable across input order — adding a sibling keeps existing slots', () => {
    const before = ['agent-b', 'agent-d'];
    const after = ['agent-d', 'agent-b', 'agent-a'];
    expect(childIndexOf('agent-b', before)).toBe(0);
    expect(childIndexOf('agent-d', before)).toBe(1);
    // After 'agent-a' joins, 'agent-b' shifts to index 1, 'agent-d' to 2.
    // 'agent-a' takes the now-leading slot.
    expect(childIndexOf('agent-a', after)).toBe(0);
    expect(childIndexOf('agent-b', after)).toBe(1);
    expect(childIndexOf('agent-d', after)).toBe(2);
  });

  test('returns -1 when sessionId is not in the sibling list', () => {
    expect(childIndexOf('agent-z', ['agent-a', 'agent-b'])).toBe(-1);
  });

  test('input array is not mutated by sorting', () => {
    const original = ['agent-c', 'agent-a', 'agent-b'];
    const snapshot = [...original];
    childIndexOf('agent-a', original);
    expect(original).toEqual(snapshot);
  });
});
