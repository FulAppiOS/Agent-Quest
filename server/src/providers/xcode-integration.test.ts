import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeProvider } from './claude-provider';
import { CodexProvider } from './codex-provider';
import { defaultCodexRoots, discoverClaudeDirs, existingConfigDirs } from './config-dirs';
import type { ProviderHandlers, SessionEventsPayload, SessionProvider } from './types';
import { AgentStateManager } from '../state/agent-state-manager';
import { WebSocketServer, type WsClient } from '../ws/websocket-server';
import { FileWatcher } from '../watchers/file-watcher';

let home: string;
let providers: SessionProvider[];
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'agent-quest-xcode-'));
  providers = [];
});
afterEach(async () => {
  for (const provider of providers) provider.stop();
  await rm(home, { recursive: true, force: true });
});

const line = (obj: unknown) => JSON.stringify(obj) + '\n';
const xcodeRoot = (name: string) => join(home, 'Library', 'Developer', 'Xcode', 'CodingAssistant', name);
const discovery = () => ({ home, platform: 'darwin' as const });
const codexEvent = (payload: unknown, type = 'event_msg') => line({ timestamp: new Date().toISOString(), type, payload });
const codexMeta = (id: string, originator = 'Xcode') => codexEvent({ id, cwd: '/Synthetic/App', originator }, 'session_meta');
const claudeEvent = (id: string, type: string, content: unknown) => line({ sessionId: id, type,
  timestamp: new Date().toISOString(), cwd: '/Synthetic/App', message: { role: type, content } });

async function scan(provider: SessionProvider): Promise<void> {
  if (provider instanceof CodexProvider) {
    await (provider as unknown as { scan(): Promise<void> }).scan();
  } else {
    await (provider as unknown as { watcher: FileWatcher }).watcher.scan();
  }
}

function dashboard() {
  // A live terminal session must not hide unrelated Xcode sessions.
  const state = new AgentStateManager({ livenessOracle: { hasAnyLive: () => true, isLive: (id) => id === 'terminal-claude' } });
  const deliveries: SessionEventsPayload[] = [];
  const consume = (payload: SessionEventsPayload) => {
    deliveries.push(payload);
    for (const event of payload.events) state.processEvent({ ...event, sessionId: payload.sessionId }, payload);
  };
  const handlers: ProviderHandlers = { onSessionStart: consume, onSessionEvents: consume };
  const snapshot = (dirs: readonly string[]) => {
    const sent: string[] = [];
    const ws = new WebSocketServer();
    ws.sendSnapshot({ send: (text: string) => sent.push(text) } as unknown as WsClient, state.getAll(), dirs);
    return JSON.parse(sent[0]!);
  };
  return { state, handlers, deliveries, snapshot };
}

describe('Xcode session discovery and dashboard integration', () => {
  test('discovers Mac Xcode roots alongside CLI profiles, excludes them on other platforms and deduplicates aliases', async () => {
    const claude = join(home, '.claude');
    const xc = xcodeRoot('ClaudeAgentConfig');
    await mkdir(join(claude, 'projects'), { recursive: true });
    await mkdir(join(xc, 'projects'), { recursive: true });
    await mkdir(xcodeRoot('codex'), { recursive: true });
    await mkdir(join(home, '.codex'), { recursive: true });
    await symlink(claude, join(home, '.claude-alias'));
    expect(await discoverClaudeDirs(discovery())).toEqual([claude, xc]);
    expect(await existingConfigDirs(defaultCodexRoots(discovery()))).toEqual([join(home, '.codex'), xcodeRoot('codex')]);
    for (const platform of ['linux', 'win32'] as const) {
      expect(await discoverClaudeDirs({ home, platform })).toEqual([claude]);
      expect(defaultCodexRoots({ home, platform })).toEqual([join(home, '.codex')]);
    }
  });

  test('Claude created after startup reaches the map, survives CLI liveness, and follows partial appends exactly once', async () => {
    const d = dashboard();
    const p = new ClaudeProvider({ discovery: discovery(), pollIntervalMs: 60_000 });
    providers.push(p);
    await p.start(d.handlers);
    expect(p.getConfigDirs()).toEqual([]);

    const root = xcodeRoot('ClaudeAgentConfig');
    const project = join(root, 'projects', 'synthetic');
    await mkdir(project, { recursive: true });
    const file = join(project, 'xcode-claude.jsonl');
    const prompt = claudeEvent('xcode-claude', 'user', [{ type: 'text', text: 'Inspect the café view' }]);
    const read = claudeEvent('xcode-claude', 'assistant', [{ type: 'tool_use', id: 'read', name: 'mcp__xcode-tools__XcodeRead', input: { filePath: 'App/View.swift' } }]);
    await writeFile(file, prompt + read.slice(0, 50));
    await scan(p);
    expect(d.state.getAgent('xcode-claude')?.currentTask).toBe('Inspect the café view');
    expect(d.state.getAgent('xcode-claude')?.toolCalls).toHaveLength(0);
    await appendFile(file, read.slice(50));
    await scan(p);
    const agent = d.state.getAgent('xcode-claude')!;
    expect(agent.status).toBe('active');
    expect(agent.currentActivity).toBe('reading');
    expect(agent.toolCalls).toHaveLength(1);
    expect(agent.configDir).toBe(root);
    d.state.refreshAll();
    expect(agent.status).toBe('active');

    const edit = claudeEvent('xcode-claude', 'assistant', [{ type: 'tool_use', id: 'edit', name: 'mcp__xcode-tools__XcodeUpdate', input: { filePath: 'App/Café.swift' } }]);
    await appendFile(file, edit.slice(0, 60));
    await scan(p);
    expect(agent.toolCalls).toHaveLength(1);
    await appendFile(file, edit.slice(60));
    await Promise.all([scan(p), scan(p)]);
    expect(agent.toolCalls).toHaveLength(2);
    expect(agent.filesModified).toContain('App/Café.swift');
    expect(agent.currentActivity).toBe('editing');
    const snap = d.snapshot(p.getConfigDirs());
    expect(snap.configDirs).toContain(root);
    expect(snap.agents).toHaveLength(1);
    expect(snap.agents[0].status).toBe('active');
  });

  test('Codex follows both roots, opts Xcode into raw calls and keeps duplicate completion telemetry without extra tools', async () => {
    const d = dashboard();
    const p = new CodexProvider({ discovery: discovery(), scanIntervalMs: 60_000 });
    providers.push(p);
    await p.start(d.handlers);
    expect(p.getConfigDirs()).toEqual([]);
    const root = xcodeRoot('codex');
    const terminalRoot = join(home, '.codex');
    for (const dir of [root, terminalRoot]) await mkdir(join(dir, 'sessions'), { recursive: true });
    const file = join(root, 'sessions', 'rollout-xcode.jsonl');
    const edit = codexEvent({ type: 'function_call', name: 'XcodeUpdate', call_id: 'edit', arguments: JSON.stringify({ filePath: 'App/View.swift' }) }, 'response_item');
    await writeFile(file, codexMeta('xcode-codex') + codexEvent({ type: 'user_message', message: 'Edit the view' }) + edit.slice(0, 40));
    await writeFile(join(terminalRoot, 'sessions', 'rollout-cli.jsonl'), codexMeta('terminal-codex', 'Codex') + codexEvent({ type: 'user_message', message: 'Terminal task' }));
    await scan(p);
    expect(d.state.getAll()).toHaveLength(2);
    await appendFile(file, edit.slice(40));
    await scan(p);
    const agent = d.state.getAgent('xcode-codex')!;
    expect(agent.currentActivity).toBe('editing');
    expect(agent.filesModified).toContain('App/View.swift');
    expect(agent.toolCalls).toHaveLength(1);
    await appendFile(file, codexEvent({ type: 'item_completed', item: { type: 'McpToolCall', id: 'edit', server: 'xcode-tools', tool: 'XcodeUpdate', result: { content: [{ type: 'text', text: 'done' }] } } }) +
      codexEvent({ type: 'mcp_tool_call_end', call_id: 'edit', invocation: { server: 'xcode-tools', tool: 'XcodeUpdate' }, result: { Ok: { content: [{ type: 'text', text: 'done' }] } } }));
    await scan(p);
    expect(agent.toolCalls).toHaveLength(1);
    expect(agent.plugins[0]?.calls).toBe(1);
    expect(agent.plugins[0]?.resultTokens).toBe(1);

    await appendFile(file, codexEvent({ type: 'function_call', name: 'BuildProject', call_id: 'build', arguments: '{}' }, 'response_item'));
    await scan(p);
    expect(agent.currentActivity).toBe('bash');
    await appendFile(file, codexEvent({ type: 'function_call', name: 'exec_command', call_id: 'shell', arguments: JSON.stringify({ cmd: 'git status' }) }, 'response_item') +
      codexEvent({ type: 'exec_command_end', call_id: 'shell', command: ['git', 'status'] }));
    await scan(p);
    expect(agent.toolCalls).toHaveLength(3);
    await appendFile(file, codexEvent({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'patch', input: '*** Begin Patch\n*** Update File: App/Other.swift\n*** End Patch' }, 'response_item') +
      codexEvent({ type: 'patch_apply_end', call_id: 'patch', changes: { 'App/Other.swift': { type: 'update' } } }));
    await scan(p);
    expect(agent.toolCalls).toHaveLength(4);
    expect(agent.filesModified).toContain('App/Other.swift');
    await appendFile(file, codexEvent({ type: 'task_complete', last_agent_message: 'Done' }));
    await scan(p);
    await scan(p);
    expect(agent.busy).toBe(false);
    expect(agent.status).toBe('waiting');
    expect(agent.currentActivity).toBe('idle');
    expect(agent.toolCalls).toHaveLength(4);
    expect(d.snapshot(p.getConfigDirs()).agents).toHaveLength(2);
    expect(d.deliveries.filter((payload) => payload.sessionId === 'xcode-codex').every((payload) => payload.configDir === root)).toBe(true);
    expect(d.state.getAgent('terminal-codex')?.configDir).toBe(terminalRoot);
  });

  test('ordinary Codex raw shell calls remain ignored when completions supply the activity', async () => {
    const root = join(home, '.codex');
    await mkdir(join(root, 'sessions'), { recursive: true });
    await writeFile(join(root, 'sessions', 'rollout-cli.jsonl'), codexMeta('terminal-codex', 'Codex') +
      codexEvent({ type: 'user_message', message: 'Test' }) +
      codexEvent({ type: 'function_call', name: 'exec_command', call_id: 'shell', arguments: '{"cmd":"pwd"}' }, 'response_item'));
    const d = dashboard();
    const p = new CodexProvider({ codexRoots: [root, root], scanIntervalMs: 60_000 });
    providers.push(p);
    await p.start(d.handlers);
    expect(d.state.getAgent('terminal-codex')?.toolCalls).toHaveLength(0);
    expect(d.deliveries).toHaveLength(1);
  });
});
