/** Pure helpers for locale message trees (no Vite / DOM dependencies). */

export type MessageTree = { [key: string]: string | MessageTree };
export type FlatMessages = Record<string, string>;

export function isTree(value: unknown): value is MessageTree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merge `source` into a copy of `target`; strings in `source` win. */
export function mergeTrees(target: MessageTree, source: MessageTree): MessageTree {
  const out: MessageTree = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = out[key];
    if (isTree(value) && isTree(existing)) {
      out[key] = mergeTrees(existing, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Flatten a nested tree into dotted keys. Non-string leaves are skipped. */
export function flatten(tree: MessageTree, prefix = ''): FlatMessages {
  const out: FlatMessages = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') {
      out[path] = value;
    } else if (isTree(value)) {
      Object.assign(out, flatten(value, path));
    }
  }
  return out;
}

