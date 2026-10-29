import { expect, test } from 'bun:test';
import { AgentStateManager } from './agent-state-manager';
import { xcodeProjectName } from './xcode-session';
import type { ParsedEvent } from '../parsers/session-parser';
const event = (overrides: Partial<ParsedEvent> = {}): ParsedEvent => ({
  sessionId: 'synthetic', slug: 'random-slug', timestamp: Date.now(), activity: 'reading',
  toolCalls: [], file: undefined, command: undefined, cwd: '/Projects/Sample App/native', ...overrides,
});
for (const source of ['claude', 'codex'] as const) {
  const configDir = '/Synthetic/Library/Developer/Xcode/CodingAssistant/' + (source === 'claude' ? 'ClaudeAgentConfig/projects' : 'codex/sessions');
  test(`${source}: Xcode project survives later slugs and missing cwd`, () => {
    const state = new AgentStateManager();
    expect(state.processEvent(event(), { source, configDir })!.agent.name).toBe('Sample App');
    expect(state.processEvent(event({ cwd: undefined, slug: 'later-slug' }))!.agent.name).toBe('Sample App');
  });
  test(`${source}: subagents retain their role name`, () => {
    const state = new AgentStateManager();
    expect(state.processEvent(event(), { source, configDir, isSubagent: true, nameOverride: 'Reviewer' })!.agent.name).toBe('Reviewer');
  });
}
test('ordinary sessions keep their slug even when working on an Xcode project', () => {
  expect(new AgentStateManager().processEvent(event(), { configDir: '/Synthetic/.claude' })!.agent.name).toBe('random-slug');
});
test('project paths handle bundles, encoded spaces, trailing separators and unavailable cwd', () => {
  expect(xcodeProjectName('/Projects/Sample/Sample.xcworkspace/')).toBe('Sample');
  expect(xcodeProjectName('file:///Projects/Sample%20App/native/')).toBe('Sample App');
  expect(xcodeProjectName('/Projects/Sample/ios/Sources/')).toBe('Sample');
  expect(xcodeProjectName('')).toBeUndefined();
});
