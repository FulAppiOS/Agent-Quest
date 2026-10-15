import { describe, test, expect } from 'bun:test';
import { serializeByKey } from './serialize-by-key';

describe('serializeByKey', () => {
  test('runs tasks with the same key in submission order even when an earlier one resolves later', async () => {
    const order: string[] = [];
    const run = serializeByKey();
    const slow = run('file-a', async () => { await new Promise((r) => setTimeout(r, 30)); order.push('a1'); });
    const fast = run('file-a', async () => { order.push('a2'); });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a1', 'a2']);
  });

  test('different keys do not wait for each other', async () => {
    const order: string[] = [];
    const run = serializeByKey();
    const a = run('a', async () => { await new Promise((r) => setTimeout(r, 30)); order.push('a'); });
    const b = run('b', async () => { order.push('b'); });
    await Promise.all([a, b]);
    expect(order).toEqual(['b', 'a']);
  });

  test('a failing task does not block the next one on the same key', async () => {
    const order: string[] = [];
    const run = serializeByKey();
    await run('k', async () => { throw new Error('boom'); }).catch(() => { order.push('caught'); });
    await run('k', async () => { order.push('next'); });
    expect(order).toEqual(['caught', 'next']);
  });
});
