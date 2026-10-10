// server/src/providers/cursor-provider.test.ts
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CursorProvider } from './cursor-provider';

function makeUserMessage(text: string): string {
  return JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text }] } });
}

function makeToolUse(): string {
  return JSON.stringify({
    role: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read', input: { path: '/proj/a.ts' } }] },
  });
}

function makeTurnEnded(status = 'success'): string {
  return JSON.stringify({ type: 'turn_ended', status });
}

test('CursorProvider identifies as cursor', () => {
  const p = new CursorProvider();
  expect(p.source).toBe('cursor');
});

test('CursorProvider discovers transcripts, emits session start + events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-test-'));
  const projDir = join(root, 'projects', 'Users-test-MyProj');
  const transcriptsDir = join(projDir, 'agent-transcripts', 'aaa-111');
  mkdirSync(transcriptsDir, { recursive: true });
  const file = join(transcriptsDir, 'aaa-111.jsonl');
  writeFileSync(file, makeUserMessage('hello') + '\n');

  const starts: unknown[] = [];
  const updates: unknown[] = [];
  const p = new CursorProvider({ cursorRoot: root, scanIntervalMs: 60_000 });

  await p.start({
    onSessionStart: (payload) => { starts.push(payload); },
    onSessionEvents: (payload) => { updates.push(payload); },
  });

  expect(starts.length).toBe(1);
  const first = starts[0] as { sessionId: string; events: unknown[] };
  expect(first.sessionId).toBe('aaa-111');
  expect(first.events.length).toBe(1); // one task event

  appendFileSync(file, makeToolUse() + '\n');
  await (p as unknown as { scan: () => Promise<void> }).scan();
  expect(updates.length).toBe(1);
  expect((updates[0] as { events: unknown[] }).events.length).toBe(1);

  p.stop();
});

test('CursorProvider stamps first-ingest events with file mtime, not now', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-test-'));
  const transcriptsDir = join(root, 'projects', 'Users-test-MyProj', 'agent-transcripts', 'mtime-333');
  mkdirSync(transcriptsDir, { recursive: true });
  const file = join(transcriptsDir, 'mtime-333.jsonl');
  writeFileSync(file, makeUserMessage('hello') + '\n');

  const { utimesSync } = await import('node:fs');
  const stamped = Date.now() - 10 * 60_000;
  utimesSync(file, new Date(stamped), new Date(stamped));

  const starts: Array<{ events: Array<{ timestamp: number }> }> = [];
  const p = new CursorProvider({ cursorRoot: root, scanIntervalMs: 60_000 });
  await p.start({
    onSessionStart: (payload) => { starts.push(payload as { events: Array<{ timestamp: number }> }); },
    onSessionEvents: () => {},
  });

  expect(starts.length).toBe(1);
  const ts = starts[0]!.events[0]!.timestamp;
  expect(Math.abs(ts - stamped)).toBeLessThan(2000);
  expect(Date.now() - ts).toBeGreaterThan(8 * 60_000);

  p.stop();
});

test('CursorProvider skips turn-ended chats older than endedQuietMs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-test-'));
  const transcriptsDir = join(root, 'projects', 'Users-test-MyProj', 'agent-transcripts', 'ended-444');
  mkdirSync(transcriptsDir, { recursive: true });
  const file = join(transcriptsDir, 'ended-444.jsonl');
  writeFileSync(file, makeUserMessage('done') + '\n' + makeTurnEnded() + '\n');

  const { utimesSync } = await import('node:fs');
  const old = new Date(Date.now() - 20 * 60_000);
  utimesSync(file, old, old);

  const starts: unknown[] = [];
  const p = new CursorProvider({
    cursorRoot: root,
    scanIntervalMs: 60_000,
    endedQuietMs: 15 * 60_000,
  });
  await p.start({ onSessionStart: (payload) => { starts.push(payload); }, onSessionEvents: () => {} });

  expect(starts.length).toBe(0);
  p.stop();
});

test('CursorProvider still spawns a recently ended chat', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-test-'));
  const transcriptsDir = join(root, 'projects', 'Users-test-MyProj', 'agent-transcripts', 'ended-555');
  mkdirSync(transcriptsDir, { recursive: true });
  const file = join(transcriptsDir, 'ended-555.jsonl');
  writeFileSync(file, makeUserMessage('just done') + '\n' + makeTurnEnded() + '\n');

  const starts: unknown[] = [];
  const p = new CursorProvider({
    cursorRoot: root,
    scanIntervalMs: 60_000,
    endedQuietMs: 15 * 60_000,
  });
  await p.start({ onSessionStart: (payload) => { starts.push(payload); }, onSessionEvents: () => {} });

  expect(starts.length).toBe(1);
  p.stop();
});

test('CursorProvider still spawns a cold chat that has not ended', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-test-'));
  const transcriptsDir = join(root, 'projects', 'Users-test-MyProj', 'agent-transcripts', 'open-666');
  mkdirSync(transcriptsDir, { recursive: true });
  const file = join(transcriptsDir, 'open-666.jsonl');
  writeFileSync(file, makeUserMessage('still going') + '\n');

  const { utimesSync } = await import('node:fs');
  const old = new Date(Date.now() - 20 * 60_000);
  utimesSync(file, old, old);

  const starts: unknown[] = [];
  const p = new CursorProvider({
    cursorRoot: root,
    scanIntervalMs: 60_000,
    endedQuietMs: 15 * 60_000,
  });
  await p.start({ onSessionStart: (payload) => { starts.push(payload); }, onSessionEvents: () => {} });

  expect(starts.length).toBe(1);
  p.stop();
});

test('CursorProvider skips files older than maxAgeMs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-test-'));
  const transcriptsDir = join(root, 'projects', 'Users-test-MyProj', 'agent-transcripts', 'old-222');
  mkdirSync(transcriptsDir, { recursive: true });
  const file = join(transcriptsDir, 'old-222.jsonl');
  writeFileSync(file, makeUserMessage('old') + '\n');

  const { utimesSync } = await import('node:fs');
  const old = new Date(Date.now() - 5 * 3600_000);
  utimesSync(file, old, old);

  const starts: unknown[] = [];
  const p = new CursorProvider({ cursorRoot: root, scanIntervalMs: 60_000, maxAgeMs: 3 * 3600_000 });

  await p.start({ onSessionStart: (payload) => { starts.push(payload); }, onSessionEvents: () => {} });

  expect(starts.length).toBe(0);
  p.stop();
});

test('CursorProvider.getConfigDirs returns [] when root missing', async () => {
  const p = new CursorProvider({ cursorRoot: '/tmp/definitely-not-real-cursor-xyz-9999', scanIntervalMs: 60_000 });
  await p.start({ onSessionStart: () => {}, onSessionEvents: () => {} });
  expect(p.getConfigDirs()).toEqual([]);
  p.stop();
});

test('CursorProvider reports cursorRoot once start() confirms it exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cursor-test-'));
  mkdirSync(join(root, 'projects'));
  const p = new CursorProvider({ cursorRoot: root, scanIntervalMs: 60_000 });
  await p.start({ onSessionStart: () => {}, onSessionEvents: () => {} });
  expect(p.getConfigDirs()).toEqual([root]);
  p.stop();
});