import type { ServerWebSocket } from 'bun';
import type { WsEvent, AgentState, AgentSource, SkillInventory } from '../types';

export type WsClient = ServerWebSocket<{ id: string }>;

export class WebSocketServer {
  private clients = new Set<WsClient>();

  handleOpen(ws: WsClient): void {
    this.clients.add(ws);
    console.log(`[WS] client connected (total: ${this.clients.size})`);
  }

  handleClose(ws: WsClient): void {
    this.clients.delete(ws);
    console.log(`[WS] client disconnected (total: ${this.clients.size})`);
  }

  sendSnapshot(
    ws: WsClient,
    agents: AgentState[],
    configDirs: readonly string[],
    skillInventory?: Partial<Record<AgentSource, SkillInventory>>,
  ): void {
    const event: WsEvent = { type: 'snapshot', agents, configDirs: [...configDirs], skillInventory };
    ws.send(JSON.stringify(event));
  }

  broadcastAgentUpdate(agent: AgentState): void {
    this.broadcast({ type: 'agent:update', agent });
  }

  /** A provider discovered storage created after the dashboard connected. */
  broadcastSnapshot(agents: AgentState[], configDirs: readonly string[], skillInventory?: Partial<Record<AgentSource, SkillInventory>>): void {
    this.broadcast({ type: 'snapshot', agents, configDirs: [...configDirs], skillInventory });
  }

  broadcastNewAgent(agent: AgentState): void {
    this.broadcast({ type: 'agent:new', agent });
  }

  broadcastAgentComplete(id: string): void {
    this.broadcast({ type: 'agent:complete', id });
  }

  broadcastActivityLog(agentId: string, action: string, detail: string, timestamp: number): void {
    this.broadcast({ type: 'activity:log', agentId, action, detail, timestamp });
  }

  /** Installed-skill inventory changed on disk — every open dashboard updates its "N skills installed" line. */
  broadcastSkillInventory(skillInventory: Partial<Record<AgentSource, SkillInventory>>): void {
    this.broadcast({ type: 'inventory:update', skillInventory });
  }

  get clientCount(): number {
    return this.clients.size;
  }

  private broadcast(event: WsEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      client.send(data);
    }
  }
}
