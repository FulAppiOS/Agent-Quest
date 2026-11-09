import { describe, expect, test } from 'bun:test';
import { flatten, mergeTrees } from './messages';

describe('mergeTrees', () => {
  test('deep-merges namespaces and lets the source win on conflicts', () => {
    const merged = mergeTrees(
      { topbar: { status: 'Status', total: 'Total' }, meta: { name: 'English' } },
      { topbar: { status: 'State' }, settings: { title: 'Settings' } },
    );
    expect(merged).toEqual({
      topbar: { status: 'State', total: 'Total' },
      meta: { name: 'English' },
      settings: { title: 'Settings' },
    });
  });

  test('does not mutate its inputs', () => {
    const target = { a: { b: 'x' } };
    mergeTrees(target, { a: { c: 'y' } });
    expect(target).toEqual({ a: { b: 'x' } });
  });
});

describe('flatten', () => {
  test('produces dotted keys and skips non-string leaves', () => {
    const flat = flatten({ a: { b: 'x', c: { d: 'y' } }, e: 'z', f: 42 as unknown as string });
    expect(flat).toEqual({ 'a.b': 'x', 'a.c.d': 'y', e: 'z' });
  });

  test('accepts already-dotted keys', () => {
    expect(flatten({ 'topbar.status': 'Status' })).toEqual({ 'topbar.status': 'Status' });
  });
});
