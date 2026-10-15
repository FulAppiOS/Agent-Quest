import { describe, it, expect } from 'bun:test';
import { skillInventoryFromEvent } from './wsEvents';

describe('skillInventoryFromEvent', () => {
  it('returns the inventory carried by snapshot and inventory:update events, undefined otherwise', () => {
    expect(skillInventoryFromEvent({ type: 'snapshot', agents: [], configDirs: [], skillInventory: { codex: { count: 2, tokens: 50 } } }))
      .toEqual({ codex: { count: 2, tokens: 50 } });
    expect(skillInventoryFromEvent({ type: 'snapshot', agents: [], configDirs: [] })).toEqual({});
    expect(skillInventoryFromEvent({ type: 'inventory:update', skillInventory: { claude: { count: 9, tokens: 900 } } }))
      .toEqual({ claude: { count: 9, tokens: 900 } });
    expect(skillInventoryFromEvent({ type: 'agent:complete', id: 'x' })).toBeUndefined();
  });
});
