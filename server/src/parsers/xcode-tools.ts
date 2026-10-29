import type { AgentActivity } from '../types';

// Explicit Xcode tool names, shared by Claude and Codex. Do not classify arbitrary
// third-party tools from substrings like "Read" or "Build".
const ACTIVITIES: Record<string, AgentActivity> = {
  XcodeRead: 'reading', XcodeGrep: 'reading', XcodeGlob: 'reading', XcodeLS: 'reading',
  XcodeListWindows: 'reading', DocumentationSearch: 'reading', GetBuildLog: 'debugging',
  XcodeUpdate: 'editing', XcodeWrite: 'editing', XcodeMakeDir: 'editing',
  XcodeMV: 'editing', XcodeRM: 'editing',
  BuildProject: 'bash', RunAllTests: 'bash', RunSomeTests: 'bash', ExecuteSnippet: 'bash',
  GetTestList: 'reading', RenderPreview: 'bash',
  XcodeRefreshCodeIssuesInFile: 'debugging', XcodeListNavigatorIssues: 'debugging',
};

export function xcodeToolActivity(name: string): AgentActivity | undefined {
  const tool = name.replace(/^(?:mcp__(?:xcode-tools|xcode)__|(?:xcode-tools|xcode)\.)/, '');
  return Object.hasOwn(ACTIVITIES, tool) ? ACTIVITIES[tool] : undefined;
}

export function xcodeToolFile(name: string, input: Record<string, unknown>): string | undefined {
  if (xcodeToolActivity(name) === undefined) return undefined;
  const path = input.filePath ?? input.path ?? input.sourcePath;
  return typeof path === 'string' ? path : undefined;
}
