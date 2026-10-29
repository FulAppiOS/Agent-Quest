import { describe, expect, test } from 'bun:test';
import { xcodeToolActivity, xcodeToolFile } from './xcode-tools';
import { parseJsonlLine } from './session-parser';
import { parseCodexLine } from './codex-parser';

const timestamp = '2026-10-28T10:00:00.000Z';
const codex = (payload: unknown, type = 'response_item') => parseCodexLine(JSON.stringify({ timestamp, type, payload }), 'test', '/Synthetic');

describe('Xcode activity', () => {
  test('Claude text-block prompts create tasks, excluding metadata and tool results', () => {
    const prompt = { type: 'user', sessionId: 'test', timestamp, message: { role: 'user', content: [{ type: 'text', text: 'Inspect the view' }] } };
    expect(parseJsonlLine(JSON.stringify(prompt))?.currentTask).toBe('Inspect the view');
    expect(parseJsonlLine(JSON.stringify({ ...prompt, isMeta: true }))).toBeNull();
    expect(parseJsonlLine(JSON.stringify({ ...prompt, message: { ...prompt.message, content: [{ type: 'text', text: '<command-name>/help</command-name>' }] } }))).toBeNull();
    const result = { ...prompt, message: { ...prompt.message, content: [{ type: 'tool_result', tool_use_id: 'x1', content: 'done' }, { type: 'text', text: 'injected context' }] } };
    expect(parseJsonlLine(JSON.stringify(result))?.kind).toBe('telemetry');
  });
  test('maps exact Xcode tool names in each observed spelling', () => {
    for (const prefix of ['', 'mcp__xcode-tools__', 'mcp__xcode__', 'xcode-tools.', 'xcode.']) {
      for (const [tool, activity] of Object.entries({ XcodeRead: 'reading', XcodeGrep: 'reading', XcodeGlob: 'reading',
        XcodeUpdate: 'editing', XcodeWrite: 'editing', BuildProject: 'bash', RunAllTests: 'bash', RunSomeTests: 'bash',
        XcodeRefreshCodeIssuesInFile: 'debugging', XcodeListNavigatorIssues: 'debugging' } as const)) {
        expect(xcodeToolActivity(prefix + tool)).toBe(activity);
      }
    }
    expect(xcodeToolActivity('mcp__unrelated__XcodeRead')).toBeUndefined();
    expect(xcodeToolActivity('SomethingRead')).toBeUndefined();
    expect(xcodeToolActivity('constructor')).toBeUndefined();
  });
  test('preserves Xcode tool name and filePath from Claude', () => {
    const event = parseJsonlLine(JSON.stringify({ type: 'assistant', sessionId: 'test', timestamp,
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'mcp__xcode-tools__XcodeUpdate', input: { filePath: 'App/Model.swift' } }] } }));
    expect(event?.activity).toBe('editing');
    expect(event?.file).toBe('App/Model.swift');
    expect(event?.toolCalls[0]?.name).toBe('mcp__xcode-tools__XcodeUpdate');
    expect(xcodeToolFile('XcodeRead', { filePath: 123 })).toBeUndefined();
  });
  test('reads legacy Codex response invocations and keeps completions as telemetry', () => {
    const event = codex({ type: 'function_call', call_id: 'x1', name: 'XcodeRead', arguments: JSON.stringify({ filePath: 'App/View.swift' }) });
    expect(event?.activity).toBe('reading');
    expect(event?.file).toBe('App/View.swift');
    const end = codex({ type: 'mcp_tool_call_end', call_id: 'x1', invocation: { server: 'xcode-tools', tool: 'XcodeRead' }, result: { Ok: { content: [{ type: 'text', text: 'abcd' }] } } }, 'event_msg');
    expect(end?.kind).toBe('telemetry');
    expect(end?.toolCalls).toEqual([]);
    expect(end?.toolResults).toEqual([{ toolUseId: 'x1', chars: 4 }]);
    expect(codex({ type: 'function_call', call_id: 'x2', name: 'unrelated', arguments: '{}' })).toBeNull();
    expect(codex({ type: 'function_call', name: 'XcodeRead' })).toBeNull();
  });
  test('uses Xcode semantics for current MCP items without changing unrelated servers', () => {
    const event = codex({ type: 'item_completed', item: { type: 'McpToolCall', id: 'x2', server: 'xcode-tools', tool: 'XcodeWrite', arguments: { filePath: 'App/New.swift' } } }, 'event_msg');
    expect(event?.activity).toBe('editing');
    expect(event?.file).toBe('App/New.swift');
    expect(codex({ type: 'item_completed', item: { type: 'McpToolCall', id: 'other', server: 'other', tool: 'XcodeWrite' } }, 'event_msg')?.activity).toBe('bash');
  });
});
