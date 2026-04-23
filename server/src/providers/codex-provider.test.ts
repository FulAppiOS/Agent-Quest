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

test('CodexProvider.getConfigDirs returns [] when codex root does not exist', async () => {
  const p = new CodexProvider({
    codexRoot: '/tmp/definitely-not-a-real-path-codex-xyz-9999',
    scanIntervalMs: 60_000,
  });

  await p.start({ onSessionStart: () => {}, onSessionEvents: () => {} });

  // Missing install must NOT be advertised as a configured dir, or the UI's
  // "no install" banner gets suppressed on a machine that has nothing running.
  expect(p.getConfigDirs()).toEqual([]);

  p.stop();
});

test('CodexProvider picks up a stale-on-first-sight file that resumes writing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-test-'));
  const day = join(root, 'sessions', '2026', '04', '23');
  mkdirSync(day, { recursive: true });
  const file = join(day, 'rollout-resumed.jsonl');
  writeFileSync(file, makeSessionMeta('resumed-thread', '/proj') + '\n');

  // Backdate the file so first-sight classifies it as stale.
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

  // First scan ignores the stale file.
  expect(starts.length).toBe(0);

  // The thread wakes up and writes a user message. Append also bumps mtime
  // back to "now", but the sentinel stored on first sight must not lock the
  // file out — the provider should treat the growth as a resumed session.
  appendFileSync(file, makeUserMessage('resumed') + '\n');

  await (p as unknown as { scan: () => Promise<void> }).scan();

  expect(starts.length).toBe(1);
  const first = starts[0] as { sessionId: string; events: unknown[] };
  expect(first.sessionId).toBe('resumed-thread');
  // Full file is re-parsed → both the session_meta (dropped as noise) and the
  // user_message land.
  expect(first.events.length).toBe(1);

  p.stop();
});

test('CodexProvider.scan is re-entrancy-safe under overlapping invocations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-test-'));
  const day = join(root, 'sessions', '2026', '04', '23');
  mkdirSync(day, { recursive: true });
  const file = join(day, 'rollout-race.jsonl');
  writeFileSync(
    file,
    makeSessionMeta('race-thread', '/proj') + '\n' + makeUserMessage('hi') + '\n',
  );

  const starts: unknown[] = [];
  const p = new CodexProvider({
    codexRoot: root,
    scanIntervalMs: 60_000,
  });

  await p.start({
    onSessionStart: (payload) => { starts.push(payload); },
    onSessionEvents: () => {},
  });

  // Re-entrant call: start() already ran one scan; fire two more in parallel.
  // Without the guard the second would re-enter the first-sight path for the
  // same file (tracked still undefined from the in-flight parse) and emit a
  // duplicate onSessionStart. With the guard, only one of the parallel calls
  // actually runs, the other is a no-op, and we stay at one session start.
  const scan = (p as unknown as { scan: () => Promise<void> }).scan.bind(p);
  await Promise.all([scan(), scan()]);

  expect(starts.length).toBe(1);
  p.stop();
});

test('CodexProvider holds back partial trailing line until it is completed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-test-'));
  const day = join(root, 'sessions', '2026', '04', '23');
  mkdirSync(day, { recursive: true });
  const file = join(day, 'rollout-partial.jsonl');
  writeFileSync(
    file,
    makeSessionMeta('partial-thread', '/proj') + '\n' + makeUserMessage('first') + '\n',
  );

  const updates: unknown[] = [];
  const p = new CodexProvider({
    codexRoot: root,
    scanIntervalMs: 60_000,
  });

  await p.start({
    onSessionStart: () => {},
    onSessionEvents: (payload) => updates.push(payload),
  });

  // Poll #1: write a COMPLETE event then a partial trailing fragment (no final '\n').
  const fullEvent = makeTaskComplete();
  const partial = '{"timestamp":"2026-04-23T18:00:05Z","type":"event_msg","payload":{"type":"user_message","message":"par'; // no closing brace, no newline
  appendFileSync(file, fullEvent + '\n' + partial);

  await (p as unknown as { scan: () => Promise<void> }).scan();

  // The complete event should have been emitted; the partial one must NOT
  // have been dropped as malformed (which would advance size past it and
  // permanently lose it).
  expect(updates.length).toBe(1);
  expect((updates[0] as { events: unknown[] }).events.length).toBe(1);

  // Poll #2: complete the partial line by appending its tail and a newline.
  const tail = 'tial"}}\n';
  appendFileSync(file, tail);

  await (p as unknown as { scan: () => Promise<void> }).scan();

  // Now the previously partial event must have been picked up.
  expect(updates.length).toBe(2);
  expect((updates[1] as { events: unknown[] }).events.length).toBe(1);

  p.stop();
});
