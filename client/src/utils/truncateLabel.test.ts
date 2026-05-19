import { describe, test, expect } from 'bun:test';

import { truncateLabel } from './truncateLabel';

describe('truncateLabel', () => {
  test('returns the input untouched when shorter than the limit', () => {
    expect(truncateLabel('short', 40)).toBe('short');
  });

  test('returns the input untouched when exactly the limit', () => {
    const exact = 'x'.repeat(40);
    expect(truncateLabel(exact, 40)).toBe(exact);
  });

  test('clips with an ellipsis when longer than the limit', () => {
    const long = 'x'.repeat(50);
    const out = truncateLabel(long, 10);
    expect(out).toBe('xxxxxxxxx…');
    expect([...out].length).toBe(10);
  });

  test('collapses whitespace runs to single spaces', () => {
    expect(truncateLabel('feat:\n  fix\t\tcrash', 40)).toBe('feat: fix crash');
  });

  test('trims leading and trailing whitespace before measuring length', () => {
    // Without trim, the input has 8 chars and would not be truncated at 7;
    // after trim it's 5 chars and stays intact.
    expect(truncateLabel('   foo   ', 7)).toBe('foo');
  });

  test('does not slice an emoji in half (code-point safe)', () => {
    // Each rocket is one user-perceived character but two UTF-16 code units.
    // A naive `slice` would cut the second rocket mid-surrogate-pair and the
    // canvas would render the U+FFFD replacement glyph.
    const input = '🚀🚀🚀🚀🚀';
    const out = truncateLabel(input, 3);
    expect(out).toBe('🚀🚀…');
    // The ellipsis is one code point — total three "characters".
    expect([...out].length).toBe(3);
  });

  test('handles empty input', () => {
    expect(truncateLabel('', 40)).toBe('');
    expect(truncateLabel('   ', 40)).toBe('');
  });

  test('handles a max of 1 (degenerate but legal)', () => {
    // After trim the single remaining char fits; ellipsis only kicks in past the cap.
    expect(truncateLabel('a', 1)).toBe('a');
    expect(truncateLabel('ab', 1)).toBe('…');
  });
});
