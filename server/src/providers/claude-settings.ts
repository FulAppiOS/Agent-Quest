import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Read the `model` a Claude Code install is configured to use, from
 * `<configDir>/settings.json`. The JSONL `message.model` drops the `[1m]`
 * context-window suffix (e.g. settings say `claude-fable-5-1[1m]` while the
 * transcript says `claude-fable-5-1`), so this is the only on-disk hint that a
 * session runs with the 1M-token window. Missing or malformed files yield
 * undefined — the caller falls back to the default window.
 */
export async function readConfiguredModel(configDir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(configDir, 'settings.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return undefined;
    const model = (parsed as { model?: unknown }).model;
    return typeof model === 'string' && model.length > 0 ? model : undefined;
  } catch {
    return undefined;
  }
}
