import { describe, test, expect } from 'bun:test';
import { WebSocketServer } from './websocket-server';
import type { WsClient } from './websocket-server';

function fakeClient(sent: string[]): WsClient {
  return { send: (data: string) => { sent.push(data); return data.length; } } as unknown as WsClient;
}

describe('WebSocketServer skill inventory', () => {
  test('refreshes an open dashboard when a new source is discovered', () => {
    const server = new WebSocketServer();
    const sent: string[] = [];
    server.handleOpen(fakeClient(sent));
    const dirs = ['/Synthetic/Library/Developer/Xcode/CodingAssistant/codex'];
    server.broadcastSnapshot([], dirs, {});
    expect(JSON.parse(sent[0]!)).toEqual({ type: 'snapshot', agents: [], configDirs: dirs, skillInventory: {} });
  });
  test('broadcasts the inventory to every connected client', () => {
    const server = new WebSocketServer();
    const a: string[] = [];
    const b: string[] = [];
    server.handleOpen(fakeClient(a));
    server.handleOpen(fakeClient(b));
    server.broadcastSkillInventory({ claude: { count: 3, tokens: 1200 } });
    expect(JSON.parse(a[0]!)).toEqual({ type: 'inventory:update', skillInventory: { claude: { count: 3, tokens: 1200 } } });
    expect(b).toHaveLength(1);
  });
});
