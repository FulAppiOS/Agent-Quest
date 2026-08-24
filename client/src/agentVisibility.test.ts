import { describe, it, expect } from 'bun:test';
import { PARK_AFTER_MS, isParkedAgent, isLiveRosterAgent, isVillageVisibleAgent } from './agentVisibility';

const now = 1_000_000_000;

function agent(over: { status: 'active' | 'waiting' | 'idle' | 'completed' | 'error'; lastEvent: number }) {
  return over;
}

describe('agentVisibility', () => {
  it('parks waiting and idle after PARK_AFTER_MS, never parks active', () => {
    expect(isParkedAgent(agent({ status: 'waiting', lastEvent: now - PARK_AFTER_MS - 1 }), now)).toBe(true);
    expect(isParkedAgent(agent({ status: 'idle', lastEvent: now - PARK_AFTER_MS - 1 }), now)).toBe(true);
    expect(isParkedAgent(agent({ status: 'waiting', lastEvent: now - 60_000 }), now)).toBe(false);
    expect(isParkedAgent(agent({ status: 'active', lastEvent: now - PARK_AFTER_MS * 2 }), now)).toBe(false);
    expect(isParkedAgent(agent({ status: 'completed', lastEvent: now - PARK_AFTER_MS * 2 }), now)).toBe(false);
  });

  it('keeps recent waiting/idle on the live roster', () => {
    expect(isLiveRosterAgent(agent({ status: 'active', lastEvent: now }), now)).toBe(true);
    expect(isLiveRosterAgent(agent({ status: 'waiting', lastEvent: now - 60_000 }), now)).toBe(true);
    expect(isLiveRosterAgent(agent({ status: 'idle', lastEvent: now - 60_000 }), now)).toBe(true);
    expect(isLiveRosterAgent(agent({ status: 'waiting', lastEvent: now - PARK_AFTER_MS - 1 }), now)).toBe(false);
    expect(isLiveRosterAgent(agent({ status: 'completed', lastEvent: now }), now)).toBe(false);
    expect(isLiveRosterAgent(agent({ status: 'error', lastEvent: now }), now)).toBe(false);
  });

  it('hides parked waiting/idle from the village along with completed/error', () => {
    expect(isVillageVisibleAgent(agent({ status: 'waiting', lastEvent: now - 60_000 }), now)).toBe(true);
    expect(isVillageVisibleAgent(agent({ status: 'waiting', lastEvent: now - PARK_AFTER_MS - 1 }), now)).toBe(false);
    expect(isVillageVisibleAgent(agent({ status: 'idle', lastEvent: now - PARK_AFTER_MS - 1 }), now)).toBe(false);
    expect(isVillageVisibleAgent(agent({ status: 'completed', lastEvent: now }), now)).toBe(false);
    expect(isVillageVisibleAgent(agent({ status: 'error', lastEvent: now }), now)).toBe(false);
  });
});
