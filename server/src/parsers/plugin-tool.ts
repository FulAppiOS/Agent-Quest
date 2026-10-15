/**
 * Classify an MCP tool name as Claude Code writes it in `tool_use.name`.
 *
 * Two shapes exist:
 *   - `mcp__plugin_<plugin>_<server>__<tool>` — a tool exposed by an installed
 *     plugin's MCP server (the plugin id is what we attribute usage to);
 *   - `mcp__<server>__<tool>` — a user-configured MCP server.
 *
 * Returns null for built-in tools (`Read`, `Bash`, `Skill`, …) and for
 * malformed names, so callers can treat "not a plugin" as the common case.
 */
export interface PluginToolRef {
  name: string;
  kind: 'plugin' | 'mcp';
}

const MCP_PREFIX = 'mcp__';
const PLUGIN_MARKER = 'plugin_';

export function parsePluginTool(toolName: string): PluginToolRef | null {
  if (!toolName.startsWith(MCP_PREFIX)) return null;
  const sep = toolName.lastIndexOf('__');
  if (sep < MCP_PREFIX.length) return null;
  const server = toolName.slice(MCP_PREFIX.length, sep);
  if (server.length === 0) return null;

  if (server.startsWith(PLUGIN_MARKER)) {
    // `<plugin>_<server>`: plugin ids use dashes, so the first underscore is
    // the boundary between the plugin id and its server name.
    const rest = server.slice(PLUGIN_MARKER.length);
    const cut = rest.indexOf('_');
    const plugin = cut === -1 ? rest : rest.slice(0, cut);
    if (plugin.length === 0) return null;
    return { name: plugin, kind: 'plugin' };
  }
  return { name: server, kind: 'mcp' };
}
