import { expect, test } from 'bun:test';
import { isXcodeAgent, sourceBadgeLabel } from './sessionIdentity';
import { modelBadge } from './agent';
test('Xcode badge is independent of provider and model availability', () => {
  for (const source of ['claude', 'codex'] as const) {
    const configDir = '/Synthetic/Library/Developer/Xcode/CodingAssistant/' + (source === 'claude' ? 'ClaudeAgentConfig/projects' : 'codex/sessions');
    expect(sourceBadgeLabel({ source, configDir })).toBe('Xcode');
    expect(isXcodeAgent({ configDir })).toBe(true);
  }
  expect(sourceBadgeLabel({ source: 'codex', configDir: '/Synthetic/.codex' })).toBe('CODEX');
  expect(isXcodeAgent({ configDir: '/Synthetic/Xcode/project' })).toBe(false);
  expect(modelBadge('claude-sonnet-4-6')?.short).toBe('SONNET');
  expect(modelBadge('gpt-5.3-codex')?.short).toBe('GPT');
  expect(modelBadge(undefined)).toBeNull();
});
