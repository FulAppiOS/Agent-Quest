import { describe, test, expect } from 'bun:test';
import { parseJsonlLine, toolNameToActivity, extractFileFromToolUse } from './session-parser';

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

  test('user-role tool_result without errors returns null', () => {
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

    expect(parseJsonlLine(line)).toBeNull();
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
