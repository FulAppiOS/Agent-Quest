// server/src/parsers/cursor-parser.test.ts
import { test, expect } from 'bun:test';
import { parseCursorLine, parseCursorFile, decodeProjectDir } from './cursor-parser';
import type { CursorLineMeta } from './cursor-parser';

const META: CursorLineMeta = { sessionId: 'abc-123', cwd: '/proj', timestamp: 1_700_000_000_000 };

test('parseCursorLine returns null for malformed JSON', () => {
  expect(parseCursorLine('{not json', META)).toBeNull();
});

test('parseCursorLine returns null for unknown top-level shape', () => {
  expect(parseCursorLine('{"foo":"bar"}', META)).toBeNull();
});

test('parseCursorLine extracts currentTask from a user message', () => {
  const raw = JSON.stringify({
    role: 'user',
    message: { content: [{ type: 'text', text: 'hello' }] },
  });
  const ev = parseCursorLine(raw, META);
  expect(ev).not.toBeNull();
  expect(ev!.kind).toBe('task');
  expect(ev!.activity).toBe('thinking');
  expect(ev!.currentTask).toBe('hello');
});

test('parseCursorLine extracts <user_query> body when present', () => {
  const raw = JSON.stringify({
    role: 'user',
    message: { content: [{ type: 'text', text: '<cursor_commands>...</cursor_commands>\n<user_query>\nDo the thing\n</user_query>' }] },
  });
  const ev = parseCursorLine(raw, META);
  expect(ev!.currentTask).toBe('Do the thing');
});

test('parseCursorLine batches multiple tool_use blocks into one event', () => {
  const raw = JSON.stringify({
    role: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'doing work' },
        { type: 'tool_use', name: 'Read', input: { path: '/a.ts' } },
        { type: 'tool_use', name: 'Grep', input: { pattern: 'x' } },
      ],
    },
  });
  const ev = parseCursorLine(raw, META);
  expect(ev).not.toBeNull();
  expect(ev!.kind).toBe('tool');
  expect(ev!.toolCalls.length).toBe(2);
  expect(ev!.activity).toBe('reading'); // first tool
  expect(ev!.file).toBe('/a.ts');
});

test('tool mapping: Read/StrReplace/Shell/git/Task/MCP', () => {
  const line = (name: string, input: unknown) => JSON.stringify({
    role: 'assistant',
    message: { content: [{ type: 'tool_use', name, input }] },
  });
  expect(parseCursorLine(line('Read', { path: '/f' }), META)!.activity).toBe('reading');
  expect(parseCursorLine(line('StrReplace', { path: '/f' }), META)!.activity).toBe('editing');
  expect(parseCursorLine(line('Shell', { command: 'npm test' }), META)!.activity).toBe('bash');
  expect(parseCursorLine(line('Shell', { command: 'git commit -m x' }), META)!.activity).toBe('git');
  expect(parseCursorLine(line('Task', { description: 'review' }), META)!.activity).toBe('reviewing');
  expect(parseCursorLine(line('CallMcpTool', { server: 'x' }), META)!.activity).toBe('thinking');
});

test('assistant text-only line sets lastMessage', () => {
  const raw = JSON.stringify({
    role: 'assistant',
    message: { content: [{ type: 'text', text: 'partial reply' }] },
  });
  const ev = parseCursorLine(raw, META);
  expect(ev!.activity).toBe('thinking');
  expect(ev!.toolCalls.length).toBe(0);
  expect(ev!.lastMessage).toBe('partial reply');
});

test('turn_ended success → isTurnEnd true, hasError false', () => {
  const ev = parseCursorLine('{"type":"turn_ended","status":"success"}', META);
  expect(ev).not.toBeNull();
  expect(ev!.isTurnEnd).toBe(true);
  expect(ev!.hasError).toBe(false);
  expect(ev!.activity).toBe('idle');
});

test('turn_ended error → hasError true', () => {
  const ev = parseCursorLine('{"type":"turn_ended","status":"error","error":"User aborted request"}', META);
  expect(ev!.isTurnEnd).toBe(true);
  expect(ev!.hasError).toBe(true);
});

test('parseCursorFile skips blank lines and noise', () => {
  const raw = [
    '',
    JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'hi' }] } }),
    '{"foo":"bar"}',
    JSON.stringify({ type: 'turn_ended', status: 'success' }),
  ].join('\n');
  const events = parseCursorFile(raw, META);
  expect(events.length).toBe(2);
});

test('decodeProjectDir greedily resolves existing path segments', () => {
  const existing = new Set([
    '/Volumes',
    '/Volumes/ExtremeSSD',
    '/Volumes/ExtremeSSD/projects',
    '/Volumes/ExtremeSSD/projects/Agent-Quest',
  ]);
  const fake = (p: string) => existing.has(p);
  expect(decodeProjectDir('Volumes-ExtremeSSD-projects-Agent-Quest', fake))
    .toBe('/Volumes/ExtremeSSD/projects/Agent-Quest');
});

test('decodeProjectDir falls back to joined tail when nothing exists', () => {
  const fake = () => false;
  expect(decodeProjectDir('Volumes-ExtremeSSD-projects-Agent-Quest', fake))
    .toBe('/Volumes-ExtremeSSD-projects-Agent-Quest');
});