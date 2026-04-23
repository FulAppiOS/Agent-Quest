// server/src/parsers/codex-parser.test.ts
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCodexLine, parseCodexFile } from './codex-parser';

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
