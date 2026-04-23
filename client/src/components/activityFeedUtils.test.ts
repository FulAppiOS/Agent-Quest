import { describe, it, expect } from 'bun:test';
import { isPath } from './activityFeedUtils';
import { isError } from './activityFeedUtils';
import { getAgentNameFallback } from './activityFeedUtils';
import { resolvePath } from './activityFeedUtils';
import { filterByAction } from './activityFeedUtils';
import { filterByAgent, groupByAgent } from './activityFeedUtils';
import { categorizeEntry } from './activityFeedUtils';
import { detectCategories } from './activityFeedUtils';
import type { ActionFilter } from './activityFeedUtils';
import type { ActivityLogEntry } from '../types/agent';

describe('isPath', () => {
  it('returns true for absolute path with extension', () => {
    expect(isPath('/Users/foo/src/bar.ts')).toBe(true);
  });

  it('returns true for relative path with extension', () => {
    expect(isPath('src/components/Foo.tsx')).toBe(true);
  });

  it('returns true for dot-leading paths', () => {
    expect(isPath('./scripts/build.sh')).toBe(true);
  });

  it('returns false for plain bash command', () => {
    expect(isPath('git status')).toBe(false);
  });

  it('returns false for grep pattern with quotes', () => {
    expect(isPath('"AgentState" --include=*.ts')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isPath('')).toBe(false);
  });

  it('returns false for command with embedded slash', () => {
    expect(isPath('ls -la /tmp')).toBe(false);
  });
});

describe('isError', () => {
  it('returns true when detail contains "→ exit "', () => {
    expect(isError('Bash', 'npm run build → exit 1')).toBe(true);
  });

  it('returns true when detail starts with "error:"', () => {
    expect(isError('Bash', 'error: command not found')).toBe(true);
  });

  it('returns false for non-Bash actions even with error keyword', () => {
    expect(isError('Read', 'error: file not found')).toBe(false);
  });

  it('returns false for plain Bash success', () => {
    expect(isError('Bash', 'git status')).toBe(false);
  });
});

describe('getAgentNameFallback', () => {
  it('extracts descriptor from agent-<descriptor>-<hex> id', () => {
    expect(getAgentNameFallback('agent-code-reviewer-abc123def4567890')).toBe('code-reviewer');
  });

  it('returns first 12 chars of rest if no hex match', () => {
    expect(getAgentNameFallback('agent-someweirdformat')).toBe('someweirdfor');
  });

  it('returns first 8 chars for non-agent-prefixed id', () => {
    expect(getAgentNameFallback('abc12345-def6-7890-1234-567890abcdef')).toBe('abc12345');
  });
});

describe('resolvePath', () => {
  it('returns absolute path unchanged', () => {
    expect(resolvePath('/Users/foo/bar.ts', '/cwd')).toBe('/Users/foo/bar.ts');
  });

  it('resolves relative path against cwd', () => {
    expect(resolvePath('src/foo.ts', '/Users/me/project')).toBe('/Users/me/project/src/foo.ts');
  });

  it('handles cwd with trailing slash', () => {
    expect(resolvePath('foo.ts', '/Users/me/project/')).toBe('/Users/me/project/foo.ts');
  });

  it('returns null when cwd is undefined and path is relative', () => {
    expect(resolvePath('src/foo.ts', undefined)).toBeNull();
  });

  it('returns null for ~ paths (vscode:// does not handle them)', () => {
    expect(resolvePath('~/notes.md', '/cwd')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(resolvePath('', '/cwd')).toBeNull();
  });
});

function entry(action: string, detail = ''): ActivityLogEntry {
  return { agentId: 'a', action, detail, timestamp: 1 };
}

describe('filterByAction', () => {
  const log: ActivityLogEntry[] = [
    entry('Read'),
    entry('Edit'),
    entry('Write'),
    entry('Bash', 'git status'),
    entry('Bash', 'npm build → exit 1'),
    entry('Grep'),
    entry('Agent'),
  ];

  it('returns the full log when no filters active', () => {
    expect(filterByAction(log, []).length).toBe(7);
  });

  it('filters to edits', () => {
    const result = filterByAction(log, ['edits']);
    expect(result.map((e) => e.action)).toEqual(['Edit', 'Write']);
  });

  it('filters to bash (error-Bash goes to errors only)', () => {
    const result = filterByAction(log, ['bash']);
    expect(result.map((e) => e.action)).toEqual(['Bash']);
    expect(result[0]!.detail).toBe('git status');
  });

  it('filters to reads', () => {
    const result = filterByAction(log, ['reads']);
    expect(result.map((e) => e.action)).toEqual(['Read', 'Grep']);
  });

  it('filters to errors (bash with error markers only)', () => {
    const result = filterByAction(log, ['errors']);
    expect(result.length).toBe(1);
    expect(result[0]!.detail).toBe('npm build → exit 1');
  });

  it('combines filters as union (multiselect)', () => {
    const result = filterByAction(log, ['edits', 'reads']);
    expect(result.map((e) => e.action).sort()).toEqual(['Edit', 'Grep', 'Read', 'Write']);
  });
});

describe('filterByAgent', () => {
  const log: ActivityLogEntry[] = [
    { agentId: 'a1', action: 'Read', detail: '', timestamp: 1 },
    { agentId: 'a2', action: 'Edit', detail: '', timestamp: 2 },
    { agentId: 'a1', action: 'Bash', detail: '', timestamp: 3 },
  ];

  it('returns log unchanged when filter is null', () => {
    expect(filterByAgent(log, null).length).toBe(3);
  });

  it('keeps only entries for the given agent', () => {
    const result = filterByAgent(log, 'a1');
    expect(result.length).toBe(2);
    expect(result.every((e) => e.agentId === 'a1')).toBe(true);
  });
});

describe('groupByAgent', () => {
  it('groups entries by agentId, ordered by most-recent activity', () => {
    const log: ActivityLogEntry[] = [
      { agentId: 'a1', action: 'Read', detail: 'r1', timestamp: 100 },
      { agentId: 'a2', action: 'Edit', detail: 'e1', timestamp: 200 },
      { agentId: 'a1', action: 'Bash', detail: 'b1', timestamp: 300 },
      { agentId: 'a2', action: 'Read', detail: 'r2', timestamp: 250 },
    ];
    const groups = groupByAgent(log);
    expect(groups.map((g) => g.agentId)).toEqual(['a1', 'a2']);
    // Entries inside a group are sorted newest-first for a stable feed order
    // regardless of input order.
    expect(groups[0]!.entries.map((e) => e.detail)).toEqual(['b1', 'r1']);
    expect(groups[1]!.entries.map((e) => e.detail)).toEqual(['r2', 'e1']);
  });

  it('returns empty array for empty log', () => {
    expect(groupByAgent([])).toEqual([]);
  });
});

describe('categorizeEntry', () => {
  it('classifies Bash error as errors', () => {
    expect(categorizeEntry('Bash', 'npm run build → exit 1')).toBe('errors');
  });

  it('classifies Edit/Write/NotebookEdit as edits', () => {
    expect(categorizeEntry('Edit', 'src/foo.ts')).toBe('edits');
    expect(categorizeEntry('Write', 'src/bar.ts')).toBe('edits');
    expect(categorizeEntry('NotebookEdit', 'foo.ipynb')).toBe('edits');
  });

  it('classifies plain Bash as bash', () => {
    expect(categorizeEntry('Bash', 'git status')).toBe('bash');
  });

  it('classifies Read/Grep/Glob as reads', () => {
    expect(categorizeEntry('Read', 'src/foo.ts')).toBe('reads');
    expect(categorizeEntry('Grep', '"AgentState"')).toBe('reads');
    expect(categorizeEntry('Glob', '**/*.ts')).toBe('reads');
  });

  it('classifies Reply/Prompt as messages', () => {
    expect(categorizeEntry('Reply', 'Hello')).toBe('messages');
    expect(categorizeEntry('Prompt', 'Please do X')).toBe('messages');
  });

  it('classifies Agent as agent', () => {
    expect(categorizeEntry('Agent', 'subagent-general')).toBe('agent');
  });

  it('classifies anything else as other', () => {
    expect(categorizeEntry('TodoWrite', '')).toBe('other');
    expect(categorizeEntry('Thinking', '...')).toBe('other');
    expect(categorizeEntry('WebFetch', 'https://example.com')).toBe('other');
  });
});

describe('detectCategories', () => {
  it('returns empty set and zero counts for empty log', () => {
    const { categories, counts } = detectCategories([]);
    expect(categories.size).toBe(0);
    expect(counts.errors).toBe(0);
    expect(counts.edits).toBe(0);
    expect(counts.bash).toBe(0);
    expect(counts.reads).toBe(0);
    expect(counts.messages).toBe(0);
    expect(counts.agent).toBe(0);
    expect(counts.other).toBe(0);
  });

  it('includes only categories actually present, with counts', () => {
    const log = [
      { agentId: 'a', action: 'Read',   detail: 'foo.ts',           timestamp: 1 },
      { agentId: 'a', action: 'Read',   detail: 'bar.ts',           timestamp: 2 },
      { agentId: 'a', action: 'Agent',  detail: 'sub',              timestamp: 3 },
      { agentId: 'a', action: 'Bash',   detail: 'npm → exit 1',     timestamp: 4 },
      { agentId: 'a', action: 'Reply',  detail: 'Done',             timestamp: 5 },
    ];
    const { categories, counts } = detectCategories(log);
    const sortedCats = [...categories].sort();
    expect(sortedCats).toEqual(['agent', 'errors', 'messages', 'reads'] as ActionFilter[]);
    expect(counts.reads).toBe(2);
    expect(counts.agent).toBe(1);
    expect(counts.errors).toBe(1);
    expect(counts.messages).toBe(1);
    expect(counts.bash).toBe(0);
    expect(counts.edits).toBe(0);
    expect(counts.other).toBe(0);
  });

  it('puts unknown actions into other', () => {
    const { categories, counts } = detectCategories([
      { agentId: 'a', action: 'TodoWrite', detail: '', timestamp: 1 },
      { agentId: 'a', action: 'Thinking',  detail: '', timestamp: 2 },
    ]);
    expect([...categories]).toEqual(['other']);
    expect(counts.other).toBe(2);
  });
});
