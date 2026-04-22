import type { ServerWebSocket } from 'bun';
import type { WsEvent, AgentState } from '../types';

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

  sendSnapshot(ws: WsClient, agents: AgentState[], configDirs: readonly string[]): void {
    const event: WsEvent = { type: 'snapshot', agents, configDirs: [...configDirs] };
    ws.send(JSON.stringify(event));
  }

  broadcastAgentUpdate(agent: AgentState): void {
    this.broadcast({ type: 'agent:update', agent });
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
