import { describe, test, expect } from 'bun:test';
import { inventoryChanged } from './skill-inventory';

describe('inventoryChanged', () => {
  test('is true when a provider count or token figure differs, false when identical', () => {
    expect(inventoryChanged({ claude: { count: 3, tokens: 100 } }, { claude: { count: 3, tokens: 100 } })).toBe(false);
    expect(inventoryChanged({ claude: { count: 3, tokens: 100 } }, { claude: { count: 4, tokens: 100 } })).toBe(true);
    expect(inventoryChanged({ claude: { count: 3, tokens: 100 } }, { claude: { count: 3, tokens: 100 }, codex: { count: 1, tokens: 5 } })).toBe(true);
    expect(inventoryChanged({}, {})).toBe(false);
  });
});
