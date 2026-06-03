import type { Hono } from 'hono';
import type { AgentStateManager } from '../state/agent-state-manager';
import type { WebSocketServer } from '../ws/websocket-server';
import { installHook, uninstallHook, hookStatus } from './claude-hooks';

export interface HookRouteDeps {
  stateManager: AgentStateManager;
  wsServer: WebSocketServer;
  /** Resolved lazily — the Claude config dirs are discovered at startup. */
  getClaudeConfigDirs: () => string[];
  /** The URL we register in settings.json and receive events on. */
  hookUrl: string;
}

/**
 * Routes for the optional Claude Code lifecycle-hook integration:
 *   - POST /api/hooks/claude      receives `Stop` events → authoritative turn-end
 *   - GET  /api/hooks/status      reports whether our hook is installed per dir
 *   - POST /api/hooks/install     writes our `Stop` hook into each settings.json
 *   - POST /api/hooks/uninstall   removes it again
 *
 * The integration is entirely opt-in: with no hook installed the app keeps
 * working off file-watching, so existing installs are unaffected.
 */
export function registerHookRoutes(app: Hono, deps: HookRouteDeps): void {
  const { stateManager, wsServer, getClaudeConfigDirs, hookUrl } = deps;

  app.post('/api/hooks/claude', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false }, 400);
    }
    if (body === null || typeof body !== 'object') return c.json({ ok: false }, 400);
    const b = body as Record<string, unknown>;
    const event = typeof b.hook_event_name === 'string' ? b.hook_event_name : '';
    const sessionId = typeof b.session_id === 'string' ? b.session_id : '';

    // Only the main-agent `Stop` event drives state. SubagentStop (and anything
    // else) is accepted with 200 but ignored: subagents never notify, and the
    // file watcher already manages their lifecycle.
    if (event === 'Stop' && sessionId.length > 0) {
      const changed = stateManager.markTurnEnd(sessionId);
      if (changed) {
        const agent = stateManager.getAgent(sessionId);
        if (agent !== undefined) wsServer.broadcastAgentUpdate(agent);
      }
    }
    return c.json({ ok: true });
  });

  app.get('/api/hooks/status', async (c) => {
    const configDirs = getClaudeConfigDirs();
    const entries = await hookStatus(configDirs);
    return c.json({
      hookUrl,
      configDirs,
      entries,
      // "Installed" only when every Claude dir has it; "partial" when some do.
      installed: entries.length > 0 && entries.every((e) => e.installed),
      anyInstalled: entries.some((e) => e.installed),
    });
  });

  app.post('/api/hooks/install', async (c) => {
    const results = await installHook(getClaudeConfigDirs(), hookUrl);
    return c.json({ ok: results.every((r) => r.error === undefined), results });
  });

  app.post('/api/hooks/uninstall', async (c) => {
    const results = await uninstallHook(getClaudeConfigDirs());
    return c.json({ ok: results.every((r) => r.error === undefined), results });
  });
}
