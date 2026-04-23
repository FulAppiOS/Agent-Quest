import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexProvider } from './codex-provider';

function makeSessionMeta(id: string, cwd: string): string {
  return JSON.stringify({
    timestamp: '2026-04-23T18:00:00Z',
    type: 'session_meta',
    payload: { id, timestamp: '2026-04-23T18:00:00Z', cwd, originator: 'Codex', cli_version: '0.x', source: 'vscode', model_provider: 'openai' },
  });
}

function makeUserMessage(text: string): string {
  return JSON.stringify({
    timestamp: '2026-04-23T18:00:01Z',
    type: 'event_msg',
    payload: { type: 'user_message', message: text },
  });
}

function makeTaskComplete(): string {
  return JSON.stringify({
    timestamp: '2026-04-23T18:00:02Z',
    type: 'event_msg',
    payload: { type: 'task_complete', last_agent_message: 'done' },
  });
}

test('CodexProvider identifies as codex', () => {
  const p = new CodexProvider();
  expect(p.source).toBe('codex');
});

test('CodexProvider discovers rollout files, emits session start + events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-test-'));
  const day = join(root, 'sessions', '2026', '04', '23');
  mkdirSync(day, { recursive: true });
  const file = join(day, 'rollout-2026-04-23T18-00-00-thread-abc.jsonl');
  writeFileSync(
    file,
    makeSessionMeta('thread-abc', '/proj') + '\n' + makeUserMessage('hello') + '\n',
  );

  const starts: unknown[] = [];
  const updates: unknown[] = [];
  const p = new CodexProvider({
    codexRoot: root,
    scanIntervalMs: 60_000, // no auto-poll during test — we call scan() manually
  });

  await p.start({
    onSessionStart: (payload) => { starts.push(payload); },
    onSessionEvents: (payload) => { updates.push(payload); },
  });

  // First scan happens inside start(); give it a tick to complete.
  // If your implementation makes start() await the first scan, no timeout is needed.
  expect(starts.length).toBe(1);
  const first = starts[0] as { sessionId: string; events: unknown[] };
  expect(first.sessionId).toBe('thread-abc');
  expect(first.events.length).toBe(1); // one user_message

  // Append more events
  appendFileSync(file, makeTaskComplete() + '\n');

  // Trigger another scan
  await (p as unknown as { scan: () => Promise<void> }).scan();
  expect(updates.length).toBe(1);
  const upd = updates[0] as { sessionId: string; events: unknown[] };
  expect(upd.sessionId).toBe('thread-abc');
  expect(upd.events.length).toBe(1);

  p.stop();
});

test('CodexProvider skips files older than maxAgeMs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-test-'));
  const day = join(root, 'sessions', '2026', '04', '23');
  mkdirSync(day, { recursive: true });
  const file = join(day, 'rollout-old.jsonl');
  writeFileSync(file, makeSessionMeta('old-thread', '/proj') + '\n');

  // Backdate the file
  const { utimesSync } = await import('node:fs');
  const old = new Date(Date.now() - 5 * 3600_000);
  utimesSync(file, old, old);

  const starts: unknown[] = [];
  const p = new CodexProvider({
    codexRoot: root,
    scanIntervalMs: 60_000,
    maxAgeMs: 3 * 3600_000,
  });

  await p.start({
    onSessionStart: (payload) => starts.push(payload),
    onSessionEvents: () => {},
  });

  expect(starts.length).toBe(0);
  p.stop();
});
