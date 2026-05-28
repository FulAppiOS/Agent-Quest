import { describe, it, expect } from 'bun:test';
import { classifyCloseEvent } from './useAgentState';

// We compare WebSocket references by identity inside the helper, so the test
// can fake them as opaque objects — none of the WebSocket API is exercised.
function fakeWs(): WebSocket {
  return {} as WebSocket;
}

describe('classifyCloseEvent', () => {
  it('returns "reconnect" when the firing socket is the current one and reconnect is enabled', () => {
    const ws = fakeWs();
    expect(classifyCloseEvent(ws, ws, true)).toBe('reconnect');
  });

  it('returns "cleanup" when refs match but the effect has flipped shouldReconnect to false', () => {
    const ws = fakeWs();
    expect(classifyCloseEvent(ws, ws, false)).toBe('cleanup');
  });

  it('returns "stale" when the firing socket is not the one held by the hook (StrictMode race)', () => {
    const newWs = fakeWs();
    const oldWs = fakeWs();
    // shouldReconnect re-flipped to true by mount B, but ws_A is firing — the
    // identity check must override and skip reconnect.
    expect(classifyCloseEvent(newWs, oldWs, true)).toBe('stale');
  });

  it('returns "stale" when the hook has nulled out its ref (cleanup before unmount finishes)', () => {
    const oldWs = fakeWs();
    expect(classifyCloseEvent(null, oldWs, true)).toBe('stale');
  });

  it('"stale" takes precedence over "cleanup" — identity check runs first', () => {
    const newWs = fakeWs();
    const oldWs = fakeWs();
    // Even if shouldReconnect is false (would otherwise be "cleanup"), the
    // stale ws still gets the stale verdict because identity check is first.
    expect(classifyCloseEvent(newWs, oldWs, false)).toBe('stale');
  });
});
