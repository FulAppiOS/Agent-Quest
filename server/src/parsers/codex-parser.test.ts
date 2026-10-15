// server/src/parsers/codex-parser.test.ts
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCodexLine, parseCodexFile, parseCodexSessionMeta } from './codex-parser';

const FIXTURE = readFileSync(join(__dirname, '__fixtures__/codex-rollout-sample.jsonl'), 'utf8');

test('parseCodexLine returns null for session_meta', () => {
  const lines = FIXTURE.split('\n').filter((l) => l.length > 0);
  const meta = lines[0]; // first line is session_meta in our fixture
  expect(parseCodexLine(meta, 'sess-1', '/cwd')).toBeNull();
});

test('parseCodexLine maps user_message to thinking+task', () => {
  const raw = JSON.stringify({
    timestamp: '2026-04-23T18:00:00Z',
    type: 'event_msg',
    payload: { type: 'user_message', message: 'implement X' },
  });
  const ev = parseCodexLine(raw, 'sess-1', '/cwd');
  expect(ev).not.toBeNull();
  expect(ev!.activity).toBe('thinking');
  expect(ev!.kind).toBe('task');
  expect(ev!.currentTask).toBe('implement X');
  expect(ev!.sessionId).toBe('sess-1');
});

test('parseCodexLine maps exec_command_end with read parsed_cmd to reading', () => {
  const raw = JSON.stringify({
    timestamp: '2026-04-23T18:00:00Z',
    type: 'event_msg',
    payload: {
      type: 'exec_command_end',
      command: ['/bin/zsh', '-lc', 'cat file.md'],
      parsed_cmd: [{ type: 'read', cmd: 'cat file.md' }],
      cwd: '/cwd',
    },
  });
  const ev = parseCodexLine(raw, 'sess-1', '/cwd');
  expect(ev).not.toBeNull();
  expect(ev!.activity).toBe('reading');
  expect(ev!.command).toBe('cat file.md');
});

test('parseCodexLine maps exec_command_end with git commit to git activity', () => {
  const raw = JSON.stringify({
    timestamp: '2026-04-23T18:00:00Z',
    type: 'event_msg',
    payload: {
      type: 'exec_command_end',
      command: ['/bin/zsh', '-lc', 'git commit -m "x"'],
      parsed_cmd: [{ type: 'unknown', cmd: 'git commit -m "x"' }],
      cwd: '/cwd',
    },
  });
  const ev = parseCodexLine(raw, 'sess-1', '/cwd');
  expect(ev!.activity).toBe('git');
});

test('parseCodexLine maps exec_command_end generic to bash', () => {
  const raw = JSON.stringify({
    timestamp: '2026-04-23T18:00:00Z',
    type: 'event_msg',
    payload: {
      type: 'exec_command_end',
      command: ['/bin/zsh', '-lc', 'npm test'],
      parsed_cmd: [{ type: 'unknown', cmd: 'npm test' }],
      cwd: '/cwd',
    },
  });
  const ev = parseCodexLine(raw, 'sess-1', '/cwd');
  expect(ev!.activity).toBe('bash');
  expect(ev!.command).toBe('npm test');
});

test('parseCodexLine maps task_complete to isTurnEnd with lastMessage', () => {
  const raw = JSON.stringify({
    timestamp: '2026-04-23T18:00:00Z',
    type: 'event_msg',
    payload: {
      type: 'task_complete',
      last_agent_message: 'Done. Ran tests, all green.',
      completed_at: 1776967462,
      duration_ms: 169623,
    },
  });
  const ev = parseCodexLine(raw, 'sess-1', '/cwd');
  expect(ev).not.toBeNull();
  expect(ev!.isTurnEnd).toBe(true);
  expect(ev!.lastMessage).toBe('Done. Ran tests, all green.');
});

test('parseCodexLine maps turn_aborted to isTurnEnd without lastMessage', () => {
  const raw = JSON.stringify({
    timestamp: '2026-04-23T18:00:00Z',
    type: 'event_msg',
    payload: { type: 'turn_aborted', reason: 'user_cancel' },
  });
  const ev = parseCodexLine(raw, 'sess-1', '/cwd');
  expect(ev!.isTurnEnd).toBe(true);
  expect(ev!.lastMessage).toBeUndefined();
});

test('parseCodexLine returns null for token_count / turn_context / response_item', () => {
  for (const t of ['token_count', 'turn_context', 'response_item']) {
    const raw = JSON.stringify({ timestamp: '2026-04-23T18:00:00Z', type: t, payload: {} });
    expect(parseCodexLine(raw, 'sess-1', '/cwd')).toBeNull();
  }
});

test('parseCodexLine returns null for agent_message and reasoning', () => {
  // These events fire INTERLEAVED with tool events mid-turn. Emitting them as
  // `activity: thinking` would make the hero ping-pong between buildings.
  const agentMsg = JSON.stringify({
    timestamp: '2026-04-23T18:00:00Z',
    type: 'event_msg',
    payload: { type: 'agent_message', message: 'reasoning chunk' },
  });
  expect(parseCodexLine(agentMsg, 'sess-1', '/cwd')).toBeNull();

  const reasoning = JSON.stringify({
    timestamp: '2026-04-23T18:00:00Z',
    type: 'event_msg',
    payload: { type: 'reasoning', text: 'thinking about it' },
  });
  expect(parseCodexLine(reasoning, 'sess-1', '/cwd')).toBeNull();
});

test('parseCodexLine maps patch_apply_end to editing with file toolCall', () => {
  // Two possible shapes — the parser must be tolerant. Test both.
  const withChanges = JSON.stringify({
    timestamp: '2026-04-23T18:00:00Z',
    type: 'event_msg',
    payload: {
      type: 'patch_apply_end',
      success: true,
      changes: { '/abs/path/file.ts': { type: 'update' } },
    },
  });
  const ev1 = parseCodexLine(withChanges, 'sess-1', '/cwd');
  expect(ev1!.activity).toBe('editing');
  expect(ev1!.toolCalls.length).toBeGreaterThanOrEqual(1);
  expect(ev1!.file).toBe('/abs/path/file.ts');
});

test('parseCodexLine returns null for malformed JSON', () => {
  expect(parseCodexLine('{not json', 'sess-1', '/cwd')).toBeNull();
});

test('parseCodexLine returns null when timestamp is missing or malformed', () => {
  const missing = JSON.stringify({
    type: 'event_msg',
    payload: { type: 'user_message', message: 'hi' },
  });
  expect(parseCodexLine(missing, 'sess-1', '/cwd')).toBeNull();

  const garbage = JSON.stringify({
    timestamp: 'not a date',
    type: 'event_msg',
    payload: { type: 'user_message', message: 'hi' },
  });
  expect(parseCodexLine(garbage, 'sess-1', '/cwd')).toBeNull();
});

test('parseCodexFile processes every fixture line without throwing', () => {
  const events = parseCodexFile(FIXTURE, 'sess-1', '/cwd');
  // At least one event should be emitted from the 30-event fixture.
  expect(events.length).toBeGreaterThan(0);
  // No returned event should have sessionId other than 'sess-1'.
  for (const e of events) expect(e.sessionId).toBe('sess-1');
});

// --- Codex ≥ 0.160 format: item_completed events, token_count telemetry, turn_context model ---

function itemLine(item: Record<string, unknown>, ts = '2026-10-15T09:00:00.000Z'): string {
  return JSON.stringify({
    timestamp: ts,
    type: 'event_msg',
    payload: { type: 'item_completed', thread_id: 't1', turn_id: 'turn-1', item },
  });
}

test('item_completed UserMessage becomes a task event with the joined text', () => {
  const ev = parseCodexLine(itemLine({
    type: 'UserMessage', id: 'um-1',
    content: [{ type: 'text', text: 'Prepare the release' }, { type: 'text', text: 'and tag it' }],
  }), 'sess-1', '/cwd');
  expect(ev).not.toBeNull();
  expect(ev!.kind).toBe('task');
  expect(ev!.activity).toBe('thinking');
  expect(ev!.currentTask).toBe('Prepare the release\nand tag it');
});

test('item_completed CommandExecution maps to bash/reading/git like the legacy exec event', () => {
  const bash = parseCodexLine(itemLine({
    type: 'CommandExecution', id: 'exec-1', command: ['/bin/zsh', '-lc', 'bun test'],
    cwd: 'file:///Users/dev/My%20App', parsed_cmd: [{ type: 'unknown', cmd: 'bun test' }], status: 'completed', aggregated_output: 'ok', exit_code: 0,
  }), 'sess-1', '/cwd')!;
  expect(bash.activity).toBe('bash');
  expect(bash.command).toBe('bun test');
  expect(bash.cwd).toBe('/Users/dev/My App');
  expect(bash.toolCalls[0]!.name).toBe('Bash');
  expect(bash.toolCalls[0]!.id).toBe('exec-1');

  const read = parseCodexLine(itemLine({
    type: 'CommandExecution', id: 'exec-2', command: ['/bin/zsh', '-lc', 'cat README.md'],
    parsed_cmd: [{ type: 'read', cmd: 'cat README.md', name: 'README.md' }], status: 'completed',
  }), 'sess-1', '/cwd')!;
  expect(read.activity).toBe('reading');

  const git = parseCodexLine(itemLine({
    type: 'CommandExecution', id: 'exec-3', command: ['/bin/zsh', '-lc', 'git commit -m x'], status: 'completed',
  }), 'sess-1', '/cwd')!;
  expect(git.activity).toBe('git');
});

test('item_completed CommandExecution reading a SKILL.md records the skill invocation and its body size', () => {
  const body = '# Skill\n'.repeat(50);
  const ev = parseCodexLine(itemLine({
    type: 'CommandExecution', id: 'exec-4',
    command: ['/bin/zsh', '-lc', 'cat /Users/dev/.codex/skills/github-readonly-repo-analysis/SKILL.md'],
    parsed_cmd: [{ type: 'read', cmd: 'cat …', name: 'SKILL.md' }], status: 'completed', aggregated_output: body,
  }), 'sess-1', '/cwd')!;
  expect(ev.skillInvocations).toEqual(['github-readonly-repo-analysis']);
  expect(ev.skillLoad).toEqual({ name: 'github-readonly-repo-analysis', chars: body.length });
});

test('item_completed FileChange maps to editing with one Edit tool call per path', () => {
  const ev = parseCodexLine(itemLine({
    type: 'FileChange', id: 'fc-1', status: 'completed',
    changes: { '/repo/a.ts': { type: 'update' }, '/repo/b.ts': { type: 'add' } },
  }), 'sess-1', '/cwd')!;
  expect(ev.activity).toBe('editing');
  expect(ev.toolCalls.map((t) => t.input['file_path'])).toEqual(['/repo/a.ts', '/repo/b.ts']);
  expect(ev.file).toBe('/repo/a.ts');
});

test('item_completed WebSearch and web.search Extension map to reading', () => {
  const ws = parseCodexLine(itemLine({ type: 'WebSearch', id: 'ws-1', query: 'bun test runner' }), 'sess-1', '/cwd')!;
  expect(ws.activity).toBe('reading');
  expect(ws.command).toBe('bun test runner');
  const ext = parseCodexLine(itemLine({ type: 'Extension', kind: 'web.search', id: 'ext-1', query: 'phaser 4 graphics' }), 'sess-1', '/cwd')!;
  expect(ext.activity).toBe('reading');
  expect(ext.command).toBe('phaser 4 graphics');
});

test('item_completed McpToolCall records the plugin call with its result size', () => {
  const ev = parseCodexLine(itemLine({
    type: 'McpToolCall', id: 'mcp-1', server: 'cua_repl', tool: 'js', pluginId: 'unified-computer-use@openai-bundled',
    readOnlyHint: true, status: 'completed', arguments: { code: '1+1' },
    result: { content: [{ type: 'text', text: 'abcdefghij' }, { type: 'text', text: 'klm' }] },
  }), 'sess-1', '/cwd')!;
  expect(ev.activity).toBe('reading');
  expect(ev.toolCalls[0]!.name).toBe('cua_repl.js');
  expect(ev.pluginCalls).toEqual([{ name: 'unified-computer-use', kind: 'plugin', toolUseId: 'mcp-1', resultChars: 13 }]);

  const mcp = parseCodexLine(itemLine({
    type: 'McpToolCall', id: 'mcp-2', server: 'posthog', tool: 'exec', readOnlyHint: false, status: 'completed',
    result: { content: [{ type: 'text', text: 'xy' }] },
  }), 'sess-1', '/cwd')!;
  expect(mcp.activity).toBe('bash');
  expect(mcp.pluginCalls).toEqual([{ name: 'posthog', kind: 'mcp', toolUseId: 'mcp-2', resultChars: 2 }]);
});

test('item_completed SubAgentActivity(started) sends the hero to the Watchtower', () => {
  const ev = parseCodexLine(itemLine({
    type: 'SubAgentActivity', id: 'call-1', kind: 'started', agent_thread_id: 'child-1', agent_path: '/root/audit',
  }), 'sess-1', '/cwd')!;
  expect(ev.activity).toBe('reviewing');
  expect(ev.toolCalls[0]!.name).toBe('Agent');
  expect(parseCodexLine(itemLine({ type: 'SubAgentActivity', id: 'call-2', kind: 'completed', agent_thread_id: 'child-1' }), 'sess-1', '/cwd')).toBeNull();
});

test('item_completed ContextCompaction and top-level compacted lines are compaction telemetry', () => {
  const item = parseCodexLine(itemLine({ type: 'ContextCompaction', id: 'cc-1' }), 'sess-1', '/cwd')!;
  expect(item.kind).toBe('telemetry');
  expect(item.isCompaction).toBe(true);
  const top = parseCodexLine(JSON.stringify({ timestamp: '2026-10-15T09:00:01.000Z', type: 'compacted', payload: { message: '', replacement_history: [] } }), 'sess-1', '/cwd')!;
  expect(top.kind).toBe('telemetry');
  expect(top.isCompaction).toBe(true);
});

test('item_completed Reasoning, AgentMessage and ImageView-less noise return null', () => {
  expect(parseCodexLine(itemLine({ type: 'Reasoning', id: 'r-1', summary_text: [] }), 'sess-1', '/cwd')).toBeNull();
  expect(parseCodexLine(itemLine({ type: 'AgentMessage', id: 'am-1', content: [{ type: 'Text', text: 'hi' }] }), 'sess-1', '/cwd')).toBeNull();
  expect(parseCodexLine(itemLine({ type: 'CollabAgentToolCall', id: 'c-1', tool: 'wait' }), 'sess-1', '/cwd')).toBeNull();
});

test('token_count carries a context sample with the model window; null info is ignored', () => {
  const ev = parseCodexLine(JSON.stringify({
    timestamp: '2026-10-15T09:00:02.000Z', type: 'event_msg',
    payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 500000, output_tokens: 9000, total_tokens: 509000 },
      last_token_usage: { input_tokens: 214398, cached_input_tokens: 214016, output_tokens: 105, reasoning_output_tokens: 0, total_tokens: 214503 },
      model_context_window: 258400,
    }, rate_limits: {} },
  }), 'sess-1', '/cwd')!;
  expect(ev.kind).toBe('telemetry');
  expect(ev.contextSample).toEqual({ used: 214503, window: 258400 });

  const nul = parseCodexLine(JSON.stringify({
    timestamp: '2026-10-15T09:00:03.000Z', type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: {} },
  }), 'sess-1', '/cwd');
  expect(nul).toBeNull();
});

test('task_started exposes the model window as a context sample without usage', () => {
  const ev = parseCodexLine(JSON.stringify({
    timestamp: '2026-10-15T09:00:04.000Z', type: 'event_msg',
    payload: { type: 'task_started', turn_id: 'turn-1', model_context_window: 258400 },
  }), 'sess-1', '/cwd')!;
  expect(ev.kind).toBe('telemetry');
  expect(ev.contextSample).toEqual({ window: 258400 });
});

test('turn_context reports the model as telemetry', () => {
  const ev = parseCodexLine(JSON.stringify({
    timestamp: '2026-10-15T09:00:05.000Z', type: 'turn_context',
    payload: { turn_id: 'turn-1', cwd: '/cwd', model: 'gpt-6-astra' },
  }), 'sess-1', '/cwd')!;
  expect(ev.kind).toBe('telemetry');
  expect(ev.model).toBe('gpt-6-astra');
});

test('parseCodexSessionMeta exposes subagent linkage from session_meta', () => {
  const sub = parseCodexSessionMeta(JSON.stringify({
    timestamp: '2026-10-15T09:00:00.000Z', type: 'session_meta',
    payload: {
      id: 'child-1', timestamp: '2026-10-15T09:00:00.000Z', cwd: '/repo', parent_thread_id: 'parent-1',
      thread_source: 'subagent', agent_nickname: 'Copernicus', agent_path: '/root/audit_project_docs',
      source: { subagent: { thread_spawn: { parent_thread_id: 'parent-1', depth: 1, agent_path: '/root/audit_project_docs' } } },
    },
  }))!;
  expect(sub.isSubagent).toBe(true);
  expect(sub.parentThreadId).toBe('parent-1');
  expect(sub.agentNickname).toBe('Copernicus');
  expect(sub.agentPath).toBe('/root/audit_project_docs');

  const main = parseCodexSessionMeta(JSON.stringify({
    timestamp: '2026-10-15T09:00:00.000Z', type: 'session_meta',
    payload: { id: 'main-1', timestamp: '2026-10-15T09:00:00.000Z', cwd: '/repo', thread_source: 'user', source: 'vscode' },
  }))!;
  expect(main.isSubagent).toBe(false);
  expect(main.parentThreadId).toBeUndefined();
});

test('token_count with an all-zero last usage (right after a compaction) carries only the window', () => {
  const ev = parseCodexLine(JSON.stringify({
    timestamp: '2026-10-15T09:00:06.000Z', type: 'event_msg',
    payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 500000, output_tokens: 9000, total_tokens: 509000 },
      last_token_usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 },
      model_context_window: 258400,
    } },
  }), 'sess-1', '/cwd')!;
  expect(ev.kind).toBe('telemetry');
  expect(ev.contextSample).toEqual({ window: 258400 });
});
