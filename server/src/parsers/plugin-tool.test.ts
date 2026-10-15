import { describe, test, expect } from 'bun:test';
import { parsePluginTool } from './plugin-tool';

describe('parsePluginTool', () => {
  test('plugin-provided MCP tools yield the plugin id', () => {
    expect(parsePluginTool('mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_screenshot'))
      .toEqual({ name: 'chrome-devtools-mcp', kind: 'plugin' });
    expect(parsePluginTool('mcp__plugin_design_slack__slack_send_message'))
      .toEqual({ name: 'design', kind: 'plugin' });
  });

  test('plain MCP tools yield the server name', () => {
    expect(parsePluginTool('mcp__claude_ai_Claude_Docs__batch'))
      .toEqual({ name: 'claude_ai_Claude_Docs', kind: 'mcp' });
    expect(parsePluginTool('mcp__1a59c906-04da-521d-bda7__create'))
      .toEqual({ name: '1a59c906-04da-521d-bda7', kind: 'mcp' });
  });

  test('built-in tools and malformed names are not plugins', () => {
    expect(parsePluginTool('Read')).toBeNull();
    expect(parsePluginTool('Skill')).toBeNull();
    expect(parsePluginTool('mcp__')).toBeNull();
    expect(parsePluginTool('mcp__server')).toBeNull();
  });
});
