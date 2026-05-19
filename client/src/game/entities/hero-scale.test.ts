import { describe, test, expect } from 'bun:test';
import { computeSpriteScale, SUBAGENT_SCALE_FACTOR } from './hero-scale';

describe('computeSpriteScale', () => {
  test('main session keeps base scale', () => {
    expect(computeSpriteScale(1.0, false)).toBe(1.0);
    expect(computeSpriteScale(2.0, false)).toBe(2.0);
  });

  test('sub-agent shrinks to SUBAGENT_SCALE_FACTOR × base', () => {
    expect(computeSpriteScale(1.0, true)).toBeCloseTo(SUBAGENT_SCALE_FACTOR);
    expect(computeSpriteScale(2.0, true)).toBeCloseTo(2.0 * SUBAGENT_SCALE_FACTOR);
  });

  test('SUBAGENT_SCALE_FACTOR is between 0 and 1 (companion, not invisible)', () => {
    expect(SUBAGENT_SCALE_FACTOR).toBeGreaterThan(0);
    expect(SUBAGENT_SCALE_FACTOR).toBeLessThan(1);
  });

  test('scale composes — runtime resize via setHeroScale preserves factor', () => {
    const isSubagent = true;
    const baseScales = [0.5, 1.0, 1.5, 3.0];
    for (const base of baseScales) {
      const effective = computeSpriteScale(base, isSubagent);
      expect(effective).toBeCloseTo(base * SUBAGENT_SCALE_FACTOR);
    }
  });
});
