/** Xcode provenance comes from its session storage, never from tool names. */
export function isXcodeConfigDir(configDir: string): boolean {
  return /\/Library\/Developer\/Xcode\/CodingAssistant\/(?:ClaudeAgentConfig|codex)(?:\/|$)/.test(configDir);
}

/** Use the project directory, skipping conventional platform/source folders. */
export function xcodeProjectName(cwd: string): string | undefined {
  let path = cwd;
  if (path.startsWith('file://')) {
    try { path = decodeURIComponent(path.replace(/^file:\/\/(?:localhost)?/, '')); } catch { return undefined; }
  }
  const parts = path.split('/').filter(Boolean);
  const bundle = parts.find(part => /\.(?:xcodeproj|xcworkspace)$/i.test(part));
  if (bundle) return bundle.replace(/\.(?:xcodeproj|xcworkspace)$/i, '');
  while (parts.length > 1 && /^(?:native|ios|macos|Sources|src)$/i.test(parts.at(-1)!)) parts.pop();
  return parts.at(-1);
}
