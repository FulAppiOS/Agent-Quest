import { networkInterfaces } from 'node:os';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AgentStateManager } from './state/agent-state-manager';
import { SessionRegistry } from './session-registry';
import { WebSocketServer } from './ws/websocket-server';
import type { WsClient } from './ws/websocket-server';
import { MapStorage } from './map/storage';
import { registerMapRoutes } from './map/routes';
import { ClaudeProvider } from './providers/claude-provider';
import { CodexProvider } from './providers/codex-provider';
import type { ProviderHandlers, SessionStartPayload, SessionEventsPayload } from './providers/types';
import type { ParsedEvent } from './parsers/session-parser';

/** Return IPv4 addresses bound to non-internal, non-link-local interfaces. */
function listLanAddresses(): string[] {
  const ifaces = networkInterfaces();
  const out: string[] = [];
  for (const entries of Object.values(ifaces)) {
    if (entries === undefined) continue;
    for (const e of entries) {
      if (e.family !== 'IPv4') continue;
      if (e.internal) continue;
      if (e.address.startsWith('169.254.')) continue; // link-local, skip
      out.push(e.address);
    }
  }
  return out;
}

const PORT = Number(process.env.PORT) || 4444;
const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:4445';
const LAN_ENABLED = /^(1|true|yes|on)$/i.test(process.env.AGENT_QUEST_LAN ?? '');
const IDLE_THRESHOLD_MS = 5 * 60_000;       // 5 minutes without events → idle
const COMPLETED_THRESHOLD_MS = 30 * 60_000; // 30 minutes idle → completed
const STALE_THRESHOLD_MS = 2 * 60 * 60_000; // 2 hours completed → remove (keep min 5)
const SESSION_MAX_AGE_MS = 3 * 60 * 60_000; // skip JSONL files older than 3h on startup
const MIN_VISIBLE_AGENTS = 5;               // always keep at least 5 agents visible
// Subagents have no pidfile, so we lean on the `busy` flag (set by JSONL tool
// events, cleared by turn-end) to decide between "still working" and "finished".
// Busy subagents stay active up to the crash timeout; non-busy ones get a
// tight idle/completed sweep so the dashboard doesn't accumulate ghosts.
const SUBAGENT_IDLE_THRESHOLD_MS = 120_000;                // 2 min silent, post turn-end → idle
const SUBAGENT_COMPLETED_THRESHOLD_MS = 5 * 60_000;        // 5 min idle → completed
const SUBAGENT_BUSY_COMPLETED_THRESHOLD_MS = 15 * 60_000;  // 15 min busy silent → presumed crashed

const app = new Hono();
const sessionRegistry = new SessionRegistry({ configDirs: [] });
const stateManager = new AgentStateManager({
  idleThresholdMs: IDLE_THRESHOLD_MS,
  completedThresholdMs: COMPLETED_THRESHOLD_MS,
  subagentIdleThresholdMs: SUBAGENT_IDLE_THRESHOLD_MS,
  subagentCompletedThresholdMs: SUBAGENT_COMPLETED_THRESHOLD_MS,
  subagentBusyCompletedThresholdMs: SUBAGENT_BUSY_COMPLETED_THRESHOLD_MS,
  livenessOracle: sessionRegistry,
});
const wsServer = new WebSocketServer();
const mapStorage = new MapStorage();

// --- CORS for client on :4445 ---
// In LAN mode we reflect any origin (the client is served from the host's
// LAN IP which we can't know in advance). Otherwise we stick to the
// configured CLIENT_URL for a tight localhost-only default.
console.log('[Server] CORS config', {
  LAN_ENABLED,
  AGENT_QUEST_LAN_env: process.env.AGENT_QUEST_LAN ?? '(unset)',
  CLIENT_URL,
});
app.use('*', cors({
  origin: LAN_ENABLED ? (origin) => origin ?? CLIENT_URL : CLIENT_URL,
}));

// --- HTTP endpoints ---
app.get('/api/health', (c) => c.json({ status: 'ok', agents: stateManager.getAll().length, clients: wsServer.clientCount }));

app.get('/api/agents', (c) => c.json(stateManager.getAll()));

registerMapRoutes(app, mapStorage);

// --- Provider handlers: shared logic that every SessionProvider feeds into ---
function broadcastAgentEventSideEffects(event: ParsedEvent): void {
  // Broadcast activity log for tool calls
  for (const tc of event.toolCalls) {
    const detail = event.file ?? event.command ?? '';
    wsServer.broadcastActivityLog(event.sessionId, tc.name, detail, tc.timestamp);
  }

  // User prompts: feed shows the message that kicked off the turn.
  // Skip resume hints (historical last-prompt dumps) and subagents (their
  // "prompt" is the parent's tool_use input, already visible as a Task row).
  if (
    event.kind === 'task' &&
    event.currentTask !== undefined &&
    event.isResumeHint !== true &&
    !event.sessionId.startsWith('agent-')
  ) {
    const detail = event.currentTask.length > 500
      ? `${event.currentTask.slice(0, 500)}…`
      : event.currentTask;
    wsServer.broadcastActivityLog(event.sessionId, 'Prompt', detail, event.timestamp);
  }

  // Claude's text reply at turn-end — lastMessage is already capped at 300
  // chars by the parser.
  if (event.isTurnEnd === true && event.lastMessage !== undefined) {
    wsServer.broadcastActivityLog(event.sessionId, 'Reply', event.lastMessage, event.timestamp);
  }
}

const providerHandlers: ProviderHandlers = {
  onSessionStart: async (payload: SessionStartPayload) => {
    console.log(`[Server] new session: ${payload.sessionId} (${payload.source}, ${payload.configDir})`);
    for (const event of payload.events) {
      // Subagent JSONL lines carry the PARENT's sessionId — rekey on the
      // filename-derived id so each subagent becomes its own hero instead
      // of being folded into the parent agent.
      event.sessionId = payload.sessionId;
      const result = stateManager.processEvent(event, payload.configDir, payload.source, payload.nameOverride);
      if (result !== null && result.isNew) {
        wsServer.broadcastNewAgent(result.agent);
      }
    }
    // Broadcast final state after processing all events
    const agent = stateManager.getAgent(payload.sessionId);
    if (agent !== undefined) wsServer.broadcastAgentUpdate(agent);
  },

  onSessionEvents: (payload: SessionEventsPayload) => {
    for (const event of payload.events) {
      // See note in onSessionStart: rekey to filename-derived id for subagents.
      event.sessionId = payload.sessionId;
      const result = stateManager.processEvent(event, payload.configDir, payload.source);
      if (result === null) continue; // resume-hint dump, no state change

      if (result.isNew) {
        wsServer.broadcastNewAgent(result.agent);
      } else {
        wsServer.broadcastAgentUpdate(result.agent);
      }

      broadcastAgentEventSideEffects(event);
    }
  },
};

const claudeProvider = new ClaudeProvider({ maxAgeMs: SESSION_MAX_AGE_MS });
const codexProvider = new CodexProvider({ maxAgeMs: SESSION_MAX_AGE_MS });

function allConfigDirs(): string[] {
  return [...claudeProvider.getConfigDirs(), ...codexProvider.getConfigDirs()];
}

// --- Lifecycle: active → idle (5m) → completed (30m) → removed (2h, keep min 5) ---
setInterval(() => {
  // Phase 1: active → idle (5 min without events)
  const idled = stateManager.checkIdleAgents(IDLE_THRESHOLD_MS);
  for (const sessionId of idled) {
    const agent = stateManager.getAgent(sessionId);
    if (agent !== undefined) {
      wsServer.broadcastAgentUpdate(agent);
    }
  }

  // Phase 2: idle → completed (30 min without events)
  const completed = stateManager.checkCompletedAgents(COMPLETED_THRESHOLD_MS);
  for (const sessionId of completed) {
    const agent = stateManager.getAgent(sessionId);
    if (agent !== undefined) {
      wsServer.broadcastAgentUpdate(agent);
    }
  }

  // Phase 3: remove completed agents older than 2h (always keep at least 5)
  const removed = stateManager.cleanupStaleAgents(STALE_THRESHOLD_MS, MIN_VISIBLE_AGENTS);
  for (const sessionId of removed) {
    wsServer.broadcastAgentComplete(sessionId);
  }

  if (removed.length > 0) {
    console.log(`[Server] cleaned up ${removed.length} stale agent(s)`);
  }
}, 30_000);

// Start file watcher before the HTTP server so the very first client
// connection's snapshot already carries the discovered configDirs (instead
// of racing the async auto-discovery and incorrectly reporting "no Claude
// install").
await claudeProvider.start(providerHandlers);
await codexProvider.start(providerHandlers);

// Seed the liveness registry with the same config dirs the watcher just
// auto-discovered, then prime it synchronously so the first WS snapshot can
// already filter out phantom sessions. Registry stays Claude-only — the
// pidfile oracle is a Claude-specific signal.
sessionRegistry.setConfigDirs(claudeProvider.getConfigDirs());
await sessionRegistry.start(10_000);
console.log(`[SessionRegistry] live session ids: ${sessionRegistry.snapshot().length}`);

// Every time the registry refreshes, re-derive every agent's status so that
// sessions that just died get demoted to `completed`, and resumed pids come
// back into view without waiting for the next JSONL event.
setInterval(() => {
  const changed = stateManager.refreshAll();
  for (const sessionId of changed) {
    const agent = stateManager.getAgent(sessionId);
    if (agent !== undefined) wsServer.broadcastAgentUpdate(agent);
  }
}, 10_000);

// --- Start ---
const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    // WebSocket upgrade
    if (new URL(req.url).pathname === '/ws') {
      const id = crypto.randomUUID();
      const upgraded = server.upgrade(req, { data: { id } });
      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // Hono handles HTTP
    return app.fetch(req);
  },
  websocket: {
    open(ws: WsClient) {
      wsServer.handleOpen(ws);
      wsServer.sendSnapshot(ws, stateManager.getAll(), allConfigDirs());
    },
    close(ws: WsClient) {
      wsServer.handleClose(ws);
    },
    message() {
      // Client-to-server messages not needed in Phase 1
    },
  },
});

console.log(`[Server] Agent Quest server running on http://localhost:${PORT}`);
console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/ws`);
console.log(`[Server] Health check: http://localhost:${PORT}/api/health`);

if (LAN_ENABLED) {
  const lanIps = listLanAddresses();
  if (lanIps.length === 0) {
    console.log(`[Server] LAN mode enabled but no non-internal IPv4 interfaces found.`);
  } else {
    console.log(`[Server] LAN mode enabled — reachable from other devices at:`);
    for (const ip of lanIps) {
      console.log(`[Server]   http://${ip}:${PORT} (API)  |  http://${ip}:4445 (UI)`);
    }
    console.log(`[Server] If this is the first time, macOS will prompt to allow incoming connections — click Allow.`);
  }
}
