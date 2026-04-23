import { basename, dirname, join } from 'node:path';

const MAX_LABEL_LEN = 60;

interface SubagentFirstLine {
  message?: { content?: unknown };
}

interface ParentAssistantLine {
  type?: string;
  message?: { content?: unknown };
}

interface AgentToolUse {
  type?: string;
  name?: string;
  input?: {
    prompt?: unknown;
    description?: unknown;
    subagent_type?: unknown;
  };
}

function truncate(s: string): string {
  return s.length > MAX_LABEL_LEN ? `${s.slice(0, MAX_LABEL_LEN)}…` : s;
}

function firstSentenceFallback(prompt: string): string | undefined {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return undefined;
  const [head] = trimmed.split(/[.\n]/, 1);
  if (head === undefined) return undefined;
  const cleaned = head.trim();
  return cleaned.length > 0 ? truncate(cleaned) : undefined;
}

function readFirstLineContent(text: string): string | undefined {
  const [firstLine] = text.split('\n', 1);
  if (firstLine === undefined || firstLine.trim() === '') return undefined;
  let parsed: SubagentFirstLine;
  try { parsed = JSON.parse(firstLine) as SubagentFirstLine; } catch { return undefined; }
  const content = parsed.message?.content;
  return typeof content === 'string' ? content : undefined;
}

function matchAgentLabel(parentText: string, targetPrompt: string): string | undefined {
  for (const line of parentText.split('\n')) {
    if (line.trim() === '') continue;
    // Cheap pre-filter: skip lines that can't possibly hold an Agent tool_use.
    if (!line.includes('"Agent"')) continue;
    let parsed: ParentAssistantLine;
    try { parsed = JSON.parse(line) as ParentAssistantLine; } catch { continue; }
    if (parsed.type !== 'assistant') continue;
    const content = parsed.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as AgentToolUse[]) {
      if (block === null || typeof block !== 'object') continue;
      if (block.type !== 'tool_use' || block.name !== 'Agent') continue;
      const prompt = block.input?.prompt;
      if (typeof prompt !== 'string' || prompt !== targetPrompt) continue;
      const description = block.input?.description;
      if (typeof description === 'string' && description.length > 0) {
        return truncate(description);
      }
      const subagentType = block.input?.subagent_type;
      if (typeof subagentType === 'string' && subagentType.length > 0) {
        return truncate(subagentType);
      }
    }
  }
  return undefined;
}

/**
 * Given a subagent JSONL path (`.../<parentSessionId>/subagents/agent-*.jsonl`),
 * return a human-readable label by correlating the child's first user prompt
 * against the parent's `Agent` tool_use invocations. Falls back to the first
 * sentence of the subagent prompt when the parent can't be found or doesn't
 * carry an exact prompt match.
 *
 * Returns `undefined` for non-subagent paths or when nothing usable is available.
 */
export async function resolveSubagentLabel(filePath: string): Promise<string | undefined> {
  const subagentsDir = dirname(filePath);
  if (basename(subagentsDir) !== 'subagents') return undefined;

  const parentSessionDir = dirname(subagentsDir);
  const projectDir = dirname(parentSessionDir);
  const parentSessionId = basename(parentSessionDir);
  const parentPath = join(projectDir, `${parentSessionId}.jsonl`);

  const childFile = Bun.file(filePath);
  if (!(await childFile.exists())) return undefined;
  const childText = await childFile.text();
  const prompt = readFirstLineContent(childText);
  if (prompt === undefined) return undefined;

  const parentFile = Bun.file(parentPath);
  if (await parentFile.exists()) {
    const parentText = await parentFile.text();
    const matched = matchAgentLabel(parentText, prompt);
    if (matched !== undefined) return matched;
  }

  return firstSentenceFallback(prompt);
}
