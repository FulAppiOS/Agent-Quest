import type { AgentSource, SkillInventory, WsEvent } from '../types/agent';

/**
 * The installed-skill inventory carried by a WebSocket event: the initial
 * snapshot (possibly without it, from older servers → `{}`) and the
 * `inventory:update` push the server sends after a rescan finds changes.
 * Undefined for every other event.
 */
export function skillInventoryFromEvent(event: WsEvent): Partial<Record<AgentSource, SkillInventory>> | undefined {
  switch (event.type) {
    case 'snapshot': return event.skillInventory ?? {};
    case 'inventory:update': return event.skillInventory;
    default: return undefined;
  }
}
