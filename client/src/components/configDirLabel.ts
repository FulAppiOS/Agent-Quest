/**
 * Human-friendly label for an agent's source config directory.
 * Handles Claude Code multi-installs (`.claude`, `.claude-work`),
 * Codex (`.codex`), and strips the leading dot for any other dotted
 * directory so the UI doesn't render names like ".foo".
 */
export function configDirLabel(configDir: string): string {
  if (configDir === '') return 'default';
  const xcode = /\/Library\/Developer\/Xcode\/CodingAssistant\/(ClaudeAgentConfig|codex)(?:\/|$)/.exec(configDir);
  if (xcode) return xcode[1] === 'codex' ? 'Xcode · Codex' : 'Xcode · Claude';
  const base = configDir.split('/').pop() ?? configDir;
  if (base === '.claude') return 'claude';
  if (base === '.codex') return 'codex';
  const stripped = base.replace(/^\.claude-?/, '');
  if (stripped !== base) return stripped;
  return base.replace(/^\./, '');
}
