/**
 * Tests for sub-agent connector line visual parameters.
 *
 * Pure functions (no Phaser dependency) so tests run fast with bun:test.
 */
import { describe, test, expect } from 'bun:test';
import {
  buildConnectorSegments,
  CONNECTOR_COLOR,
  CONNECTOR_ALPHA,
  CONNECTOR_LINE_WIDTH,
  CONNECTOR_DASH_LENGTH,
  CONNECTOR_GAP_LENGTH,
} from './subagent-connector';

describe('buildConnectorSegments', () => {
  test('returns empty array when no parent-child pairs', () => {
    const result = buildConnectorSegments([]);
    expect(result).toEqual([]);
  });

  test('single pair produces two endpoints matching input positions', () => {
    const pairs = [{ parentX: 100, parentY: 200, childX: 160, childY: 200 }];
    const [segment] = buildConnectorSegments(pairs);
    expect(segment).toBeDefined();
    expect(segment!.x1).toBe(100);
    expect(segment!.y1).toBe(200);
    expect(segment!.x2).toBe(160);
    expect(segment!.y2).toBe(200);
  });

  test('multiple pairs produce one segment each', () => {
    const pairs = [
      { parentX: 50, parentY: 80, childX: 90, childY: 80 },
      { parentX: 200, parentY: 300, childX: 240, childY: 300 },
    ];
    const result = buildConnectorSegments(pairs);
    expect(result).toHaveLength(2);
  });

  test('segment length is correct Euclidean distance', () => {
    const pairs = [{ parentX: 0, parentY: 0, childX: 3, childY: 4 }];
    const [segment] = buildConnectorSegments(pairs);
    expect(segment!.length).toBeCloseTo(5);
  });

  test('zero-distance pair returns segment with length 0', () => {
    const pairs = [{ parentX: 100, parentY: 100, childX: 100, childY: 100 }];
    const [segment] = buildConnectorSegments(pairs);
    expect(segment!.length).toBeCloseTo(0);
  });

  test('deterministic — same inputs produce same output', () => {
    const pairs = [{ parentX: 10, parentY: 20, childX: 50, childY: 80 }];
    const a = buildConnectorSegments(pairs);
    const b = buildConnectorSegments(pairs);
    expect(a).toEqual(b);
  });
});

describe('CONNECTOR_COLOR constant', () => {
  test('is a positive integer (Phaser hex color)', () => {
    expect(typeof CONNECTOR_COLOR).toBe('number');
    expect(CONNECTOR_COLOR).toBeGreaterThan(0);
  });
});

describe('CONNECTOR_ALPHA constant', () => {
  test('is between 0 and 1 (visible but not fully opaque)', () => {
    expect(CONNECTOR_ALPHA).toBeGreaterThan(0);
    expect(CONNECTOR_ALPHA).toBeLessThanOrEqual(1);
    // Should not be full opacity — connector should be subtle
    expect(CONNECTOR_ALPHA).toBeLessThan(1);
  });
});

describe('CONNECTOR_LINE_WIDTH constant', () => {
  test('is a positive number (visible line)', () => {
    expect(CONNECTOR_LINE_WIDTH).toBeGreaterThan(0);
    // Should stay thin (1-3 px) to not overpower the sprites
    expect(CONNECTOR_LINE_WIDTH).toBeLessThanOrEqual(3);
  });
});

describe('CONNECTOR_DASH_LENGTH and CONNECTOR_GAP_LENGTH constants', () => {
  test('dash and gap are positive numbers', () => {
    expect(CONNECTOR_DASH_LENGTH).toBeGreaterThan(0);
    expect(CONNECTOR_GAP_LENGTH).toBeGreaterThan(0);
  });

  test('dash is at least as long as gap (dash-dominant pattern)', () => {
    expect(CONNECTOR_DASH_LENGTH).toBeGreaterThanOrEqual(CONNECTOR_GAP_LENGTH);
  });
});
