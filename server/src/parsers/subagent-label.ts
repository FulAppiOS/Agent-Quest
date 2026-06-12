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

interface SubagentMeta {
  description?: string;
  agentType?: string;
}

/**
 * Read the sibling `agent-*.meta.json` the CLI writes next to each subagent
 * transcript. Classic Task subagents carry `description` + `agentType`;
 * workflow agents usually only `agentType` (the generic `workflow-subagent`
 * value carries no information and is dropped).
 */
async function readSubagentMeta(filePath: string): Promise<SubagentMeta> {
  const metaFile = Bun.file(filePath.replace(/\.jsonl$/, '.meta.json'));
  try {
    if (!(await metaFile.exists())) return {};
    const meta = (await metaFile.json()) as { description?: unknown; agentType?: unknown };
    const description = typeof meta.description === 'string' && meta.description.length > 0
      ? meta.description
      : undefined;
    const agentType = typeof meta.agentType === 'string' && meta.agentType.length > 0 && meta.agentType !== 'workflow-subagent'
      ? meta.agentType
      : undefined;
    return { description, agentType };
  } catch {
    return {};
  }
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
 * Given a subagent JSONL path (`.../<parentSessionId>/subagents/agent-*.jsonl`,
 * or the ultra-mode variant `.../<parentSessionId>/subagents/workflows/wf_<runId>/agent-*.jsonl`),
 * return a human-readable label. Tiers, best first:
 *
 * 1. `description` from the sibling `agent-*.meta.json`
 * 2. the parent's matching `Agent` tool_use (description / subagent_type)
 * 3. `agentType` from meta.json combined with the prompt's first sentence —
 *    the only informative pair for workflow agents, whose prompts live in
 *    the Workflow script rather than in the parent transcript
 * 4. the first sentence of the subagent prompt
 *
 * Returns `undefined` for non-subagent paths or when nothing usable is available.
 */
export async function resolveSubagentLabel(filePath: string): Promise<string | undefined> {
  let subagentsDir = dirname(filePath);
  // Workflow runs nest two levels deeper: subagents/workflows/wf_<runId>/
  if (basename(dirname(subagentsDir)) === 'workflows') {
    subagentsDir = dirname(dirname(subagentsDir));
  }
  if (basename(subagentsDir) !== 'subagents') return undefined;

  const meta = await readSubagentMeta(filePath);
  if (meta.description !== undefined) return truncate(meta.description);

  const parentSessionDir = dirname(subagentsDir);
  const projectDir = dirname(parentSessionDir);
  const parentSessionId = basename(parentSessionDir);
  const parentPath = join(projectDir, `${parentSessionId}.jsonl`);

  const childFile = Bun.file(filePath);
  if (!(await childFile.exists())) return undefined;
  const childText = await childFile.text();
  const prompt = readFirstLineContent(childText);

  if (prompt !== undefined) {
    const parentFile = Bun.file(parentPath);
    if (await parentFile.exists()) {
      const parentText = await parentFile.text();
      const matched = matchAgentLabel(parentText, prompt);
      if (matched !== undefined) return matched;
    }
  }

  const sentence = prompt !== undefined ? firstSentenceFallback(prompt) : undefined;
  if (meta.agentType !== undefined) {
    return truncate(sentence !== undefined ? `${meta.agentType}: ${sentence}` : meta.agentType);
  }
  return sentence;
}
