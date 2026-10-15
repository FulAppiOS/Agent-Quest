import { describe, test, expect } from 'bun:test';
import { parseJsonlLine, toolNameToActivity, extractFileFromToolUse, parseUsage, parseTaskNotification, SKILL_BODY_PREFIX } from './session-parser';

describe('parseUsage', () => {
  test('keeps cache read and cache write (creation) in separate buckets', () => {
    expect(parseUsage({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 }))
      .toEqual({ input: 100, output: 50, cacheRead: 20, cacheWrite: 5 });
  });
  test('returns undefined for missing/empty/garbage usage', () => {
    expect(parseUsage(undefined)).toBeUndefined();
    expect(parseUsage(null)).toBeUndefined();
    expect(parseUsage({})).toBeUndefined();
    expect(parseUsage({ input_tokens: 0, output_tokens: 0 })).toBeUndefined();
    expect(parseUsage('nope')).toBeUndefined();
  });
  test('counts a cache-write-only message (no read, no input/output)', () => {
    expect(parseUsage({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 7 }))
      .toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 7 });
  });
  test('ignores negative/NaN values', () => {
    expect(parseUsage({ input_tokens: -5, output_tokens: 10 })).toEqual({ input: 0, output: 10, cacheRead: 0, cacheWrite: 0 });
  });
});

describe('toolNameToActivity', () => {
  test('Read/Grep/Glob map to reading', () => {
    expect(toolNameToActivity('Read')).toBe('reading');
    expect(toolNameToActivity('Grep')).toBe('reading');
    expect(toolNameToActivity('Glob')).toBe('reading');
  });

  test('Edit/Write map to editing', () => {
    expect(toolNameToActivity('Edit')).toBe('editing');
    expect(toolNameToActivity('Write')).toBe('editing');
  });

  test('Bash maps to bash', () => {
    expect(toolNameToActivity('Bash')).toBe('bash');
  });

  test('unknown tool maps to thinking', () => {
    expect(toolNameToActivity('SomeUnknownTool')).toBe('thinking');
  });

  test('Agent maps to reviewing', () => {
    expect(toolNameToActivity('Agent')).toBe('reviewing');
  });
});

describe('extractFileFromToolUse', () => {
  test('extracts file_path from Read input', () => {
    expect(extractFileFromToolUse('Read', { file_path: '/src/foo.ts' })).toBe('/src/foo.ts');
  });

  test('extracts command from Bash input', () => {
    expect(extractFileFromToolUse('Bash', { command: 'npm test', description: 'run tests' })).toBe('npm test');
  });

  test('extracts file_path from Edit input', () => {
    expect(extractFileFromToolUse('Edit', { file_path: '/src/bar.ts', old_string: 'a', new_string: 'b' })).toBe('/src/bar.ts');
  });

  test('returns undefined for unknown input', () => {
    expect(extractFileFromToolUse('Skill', { skill: 'foo' })).toBeUndefined();
  });
});

describe('parseJsonlLine', () => {
  test('extracts tool_use from assistant message', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'abc-123',
      parentUuid: null,
      timestamp: '2026-04-15T17:25:51.132Z',
      sessionId: 'sess-1',
      cwd: '/project',
      slug: 'bubbly-waddling-cat',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/src/foo.ts' } },
        ],
      },
    });

    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.toolCalls).toHaveLength(1);
    expect(result!.toolCalls[0]!.name).toBe('Read');
    expect(result!.activity).toBe('reading');
    expect(result!.slug).toBe('bubbly-waddling-cat');
    expect(result!.file).toBe('/src/foo.ts');
  });

  test('detects git activity from Bash command', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'abc-456',
      parentUuid: null,
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      slug: 'bubbly-waddling-cat',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-2', name: 'Bash', input: { command: 'git commit -m "feat: something"' } },
        ],
      },
    });

    const result = parseJsonlLine(line);
    expect(result!.activity).toBe('git');
  });

  test('detects git activity when git command is chained after add', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'git-chained',
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'git add . && git commit -m "x"' } },
        ],
      },
    });
    expect(parseJsonlLine(line)!.activity).toBe('git');
  });

  test('detects git activity when command is prefixed with cd', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'git-cd',
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'cd /tmp/repo && git push origin main' } },
        ],
      },
    });
    expect(parseJsonlLine(line)!.activity).toBe('git');
  });

  test('read-only git commands stay as bash, not git', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'git-status',
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't', name: 'Bash', input: { command: 'git status && git log --oneline' } },
        ],
      },
    });
    expect(parseJsonlLine(line)!.activity).toBe('bash');
  });

  test('Agent tool_use maps to reviewing activity', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'agent-tool',
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't', name: 'Agent', input: { description: 'review the code', subagent_type: 'code-reviewer' } },
        ],
      },
    });
    expect(parseJsonlLine(line)!.activity).toBe('reviewing');
  });

  test('parses user-role string prompt as a task event', () => {
    const line = JSON.stringify({
      type: 'user',
      uuid: 'u-prompt',
      parentUuid: null,
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      cwd: '/proj',
      slug: 'bubbly-waddling-cat',
      message: { role: 'user', content: 'please refactor this module' },
    });

    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('task');
    expect(result!.currentTask).toBe('please refactor this module');
    expect(result!.activity).toBe('thinking');
    expect(result!.sessionId).toBe('sess-1');
    expect(result!.cwd).toBe('/proj');
    expect(result!.timestamp).toBe(new Date('2026-04-15T17:30:00.000Z').getTime());
  });

  test('user-role string with isMeta=true returns null', () => {
    const line = JSON.stringify({
      type: 'user',
      uuid: 'u-meta',
      parentUuid: null,
      isMeta: true,
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      message: { role: 'user', content: 'some system-generated note' },
    });
    expect(parseJsonlLine(line)).toBeNull();
  });

  test('user-role string with slash-command artefact returns null', () => {
    const commandName = JSON.stringify({
      type: 'user',
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      message: { role: 'user', content: '<command-name>/effort</command-name>\n<command-args>max</command-args>' },
    });
    const stdout = JSON.stringify({
      type: 'user',
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      message: { role: 'user', content: '<local-command-stdout>ok</local-command-stdout>' },
    });
    const caveat = JSON.stringify({
      type: 'user',
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      message: { role: 'user', content: '<local-command-caveat>Caveat…</local-command-caveat>' },
    });

    expect(parseJsonlLine(commandName)).toBeNull();
    expect(parseJsonlLine(stdout)).toBeNull();
    expect(parseJsonlLine(caveat)).toBeNull();
  });

  test('user-role string with empty content returns null', () => {
    const line = JSON.stringify({
      type: 'user',
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      message: { role: 'user', content: '' },
    });
    expect(parseJsonlLine(line)).toBeNull();
  });

  test('returns null for system-type lines', () => {
    const line = JSON.stringify({
      type: 'system',
      uuid: 'sys-1',
      timestamp: '2026-04-15T17:25:00.000Z',
      sessionId: 'sess-1',
      message: { role: 'system', content: 'system notice' },
    });
    expect(parseJsonlLine(line)).toBeNull();
  });

  test('detects thinking from text-only assistant messages', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'abc-text',
      parentUuid: null,
      timestamp: '2026-04-15T17:25:00.000Z',
      sessionId: 'sess-1',
      slug: 'bubbly-waddling-cat',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Let me analyze this carefully...' }],
      },
    });

    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.activity).toBe('thinking');
    expect(result!.toolCalls).toHaveLength(0);
  });

  test('handles malformed JSON gracefully', () => {
    const result = parseJsonlLine('not valid json {{{');
    expect(result).toBeNull();
  });

  test('marks isTurnEnd when assistant message has only text (no tool_use)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'turn-end',
      parentUuid: null,
      timestamp: '2026-04-15T17:25:00.000Z',
      sessionId: 'sess-1',
      slug: 'bubbly-waddling-cat',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Done. Anything else?' }],
      },
    });

    const result = parseJsonlLine(line);
    expect(result!.isTurnEnd).toBe(true);
  });

  test('extracts model from assistant message.model', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'model-1',
      parentUuid: null,
      timestamp: '2026-04-15T17:25:00.000Z',
      sessionId: 'sess-1',
      slug: 'bubbly-waddling-cat',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-6',
        content: [{ type: 'text', text: 'hi' }],
      },
    });

    const result = parseJsonlLine(line);
    expect(result!.model).toBe('claude-opus-4-6');
  });

  test('leaves model undefined when message.model is missing', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'model-2',
      parentUuid: null,
      timestamp: '2026-04-15T17:25:00.000Z',
      sessionId: 'sess-1',
      slug: 'bubbly-waddling-cat',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
      },
    });

    const result = parseJsonlLine(line);
    expect(result!.model).toBeUndefined();
  });

  test('does NOT mark isTurnEnd when assistant message includes tool_use', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'mixed',
      parentUuid: null,
      timestamp: '2026-04-15T17:25:00.000Z',
      sessionId: 'sess-1',
      slug: 'bubbly-waddling-cat',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading file...' },
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/x.ts' } },
        ],
      },
    });

    const result = parseJsonlLine(line);
    expect(result!.isTurnEnd).toBe(false);
  });

  test('parses user-role tool_result with is_error:true into hasError event', () => {
    const line = JSON.stringify({
      type: 'user',
      uuid: 'err-1',
      parentUuid: null,
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu-1', is_error: true, content: 'ENOENT' },
        ],
      },
    });

    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.hasError).toBe(true);
    expect(result!.kind).toBe('tool');
  });

  test('user-role tool_result without errors is telemetry only (no activity, no error flag)', () => {
    const line = JSON.stringify({
      type: 'user',
      uuid: 'ok-1',
      parentUuid: null,
      timestamp: '2026-04-15T17:30:00.000Z',
      sessionId: 'sess-1',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }],
      },
    });

    const ev = parseJsonlLine(line);
    expect(ev).not.toBeNull();
    expect(ev!.kind).toBe('telemetry');
    expect(ev!.hasError).toBeUndefined();
    expect(ev!.toolCalls).toEqual([]);
  });

  test('last-prompt line is flagged as resume hint with sentinel timestamp', () => {
    const line = JSON.stringify({
      type: 'last-prompt',
      lastPrompt: 'procedi',
      sessionId: 'sess-resume',
    });
    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.isResumeHint).toBe(true);
    expect(result!.timestamp).toBe(0);
    expect(result!.currentTask).toBe('procedi');
    expect(result!.kind).toBe('task');
  });

  test('last-prompt with empty lastPrompt returns null', () => {
    const line = JSON.stringify({
      type: 'last-prompt',
      lastPrompt: '',
      sessionId: 'sess-resume',
    });
    expect(parseJsonlLine(line)).toBeNull();
  });

  test('extracts lastMessage from assistant text blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'abc-msg',
      parentUuid: null,
      timestamp: '2026-04-15T17:25:00.000Z',
      sessionId: 'sess-1',
      slug: 'bubbly-waddling-cat',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I have completed the implementation. All tests pass.' },
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'bun test' } },
        ],
      },
    });

    const result = parseJsonlLine(line);
    expect(result!.lastMessage).toBe('I have completed the implementation. All tests pass.');
  });
});

describe('parseJsonlLine telemetry', () => {
  const base = { uuid: 'u1', parentUuid: null, timestamp: '2026-10-15T07:14:36.687Z', sessionId: 'sess-1', cwd: '/project' };

  test('carries skill/plugin attribution, skill invocations and plugin calls from an assistant line', () => {
    const line = JSON.stringify({
      ...base, type: 'assistant', attributionSkill: 'superpowers:brainstorming', attributionPlugin: 'superpowers',
      message: {
        role: 'assistant', id: 'msg-1',
        content: [
          { type: 'tool_use', id: 'tu-skill', name: 'Skill', input: { skill: 'superpowers:brainstorming' } },
          { type: 'tool_use', id: 'tu-mcp', name: 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot', input: {} },
        ],
      },
    });
    const ev = parseJsonlLine(line)!;
    expect(ev.kind).toBe('tool');
    expect(ev.attribution).toEqual({ skill: 'superpowers:brainstorming', plugin: 'superpowers' });
    expect(ev.skillInvocations).toEqual(['superpowers:brainstorming']);
    expect(ev.pluginCalls).toEqual([{ name: 'chrome-devtools-mcp', kind: 'plugin', toolUseId: 'tu-mcp' }]);
  });

  test('assistant lines without attribution or plugins leave the fields undefined', () => {
    const line = JSON.stringify({
      ...base, type: 'assistant',
      message: { role: 'assistant', id: 'msg-2', content: [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/a.ts' } }] },
    });
    const ev = parseJsonlLine(line)!;
    expect(ev.attribution).toBeUndefined();
    expect(ev.skillInvocations).toBeUndefined();
    expect(ev.pluginCalls).toBeUndefined();
  });

  test('successful tool_result lines become telemetry events carrying result sizes (text blocks only)', () => {
    const line = JSON.stringify({
      ...base, type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu-1', content: 'abcdefgh' },
          { type: 'tool_result', tool_use_id: 'tu-2', content: [{ type: 'text', text: 'abcd' }, { type: 'image', source: {} }, { type: 'text', text: 'ef' }] },
        ],
      },
    });
    const ev = parseJsonlLine(line)!;
    expect(ev.kind).toBe('telemetry');
    expect(ev.toolResults).toEqual([{ toolUseId: 'tu-1', chars: 8 }, { toolUseId: 'tu-2', chars: 6 }]);
    expect(ev.toolCalls).toEqual([]);
    expect(ev.hasError).toBeUndefined();
  });

  test('error tool_result lines stay debugging events and still report result sizes', () => {
    const line = JSON.stringify({
      ...base, type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'boom', is_error: true }] },
    });
    const ev = parseJsonlLine(line)!;
    expect(ev.kind).toBe('tool');
    expect(ev.activity).toBe('debugging');
    expect(ev.hasError).toBe(true);
    expect(ev.toolResults).toEqual([{ toolUseId: 'tu-1', chars: 4 }]);
  });

  test('a skill body injected as a meta user message becomes a skillLoad telemetry event', () => {
    const path = '/Users/x/.claude/plugins/cache/mkt/superpowers/6.4.1/skills/brainstorming';
    const body = `${SKILL_BODY_PREFIX}${path}\n\n# Brainstorming\nlots of text`;
    const line = JSON.stringify({
      ...base, type: 'user', isMeta: true,
      message: { role: 'user', content: [{ type: 'text', text: body }] },
    });
    const ev = parseJsonlLine(line)!;
    expect(ev.kind).toBe('telemetry');
    expect(ev.skillLoad).toEqual({ path, chars: body.length });
    expect(ev.currentTask).toBeUndefined();
  });

  test('other meta user messages are still ignored', () => {
    const str = JSON.stringify({ ...base, type: 'user', isMeta: true, message: { role: 'user', content: 'hello' } });
    expect(parseJsonlLine(str)).toBeNull();
    const arr = JSON.stringify({ ...base, type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text', text: 'plain reminder' }] } });
    expect(parseJsonlLine(arr)).toBeNull();
  });

  test('a background subagent task-notification is telemetry, not a prompt', () => {
    const text = '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_01X</tool-use-id>\n<status>completed</status>\n<result>Found 16 issues</result>\n</task-notification>';
    const line = JSON.stringify({ ...base, type: 'user', message: { role: 'user', content: text } });
    const ev = parseJsonlLine(line)!;
    expect(ev.kind).toBe('telemetry');
    expect(ev.taskNotification).toEqual({ toolUseId: 'toolu_01X', resultChars: 'Found 16 issues'.length });
    expect(ev.currentTask).toBeUndefined();
  });

  test('parseTaskNotification rejects ordinary prompts and notifications without a tool-use id', () => {
    expect(parseTaskNotification('fix the bug')).toBeNull();
    expect(parseTaskNotification('<task-notification><task-id>a</task-id></task-notification>')).toBeNull();
    expect(parseTaskNotification('<task-notification><tool-use-id>t</tool-use-id></task-notification>'))
      .toEqual({ toolUseId: 't', resultChars: 0 });
  });

  test('compaction markers become telemetry events', () => {
    const sys = JSON.stringify({ ...base, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' });
    const ev = parseJsonlLine(sys)!;
    expect(ev.kind).toBe('telemetry');
    expect(ev.isCompaction).toBe(true);
    const summary = JSON.stringify({ ...base, type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued from a previous conversation…' } });
    const ev2 = parseJsonlLine(summary)!;
    expect(ev2.kind).toBe('telemetry');
    expect(ev2.isCompaction).toBe(true);
    expect(ev2.currentTask).toBeUndefined();
  });

  test('other system lines stay ignored', () => {
    const sys = JSON.stringify({ ...base, type: 'system', subtype: 'turn_duration', durationMs: 1000 });
    expect(parseJsonlLine(sys)).toBeNull();
  });
});
