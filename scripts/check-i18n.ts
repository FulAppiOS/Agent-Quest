/**
 * Consistency check for the client locale files.
 *
 *   bun run check:i18n
 *
 * - Every non-English locale must define the same keys as English (plural
 *   variants `_one` / `_other` … are matched on their base key).
 * - Every literal `t('ns.key')` call in client/src must resolve in English.
 * - Every English key must be referenced somewhere, unless it belongs to a
 *   namespace that is looked up dynamically (`t(\`activity.${x}\`)`).
 *
 * Exits non-zero when anything is off so it can run in CI.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const LOCALES_DIR = join(ROOT, 'client', 'src', 'i18n', 'locales');
const SRC_DIR = join(ROOT, 'client', 'src');
const BASE = 'en';
/** Namespaces whose keys are built at runtime from data; skip the unused check for them. */
const DYNAMIC_PREFIXES = ['meta.', 'activity.', 'status.', 'heroClass.', 'building.', 'assets.category.'];
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

type Tree = { [key: string]: string | Tree };

function isTree(v: unknown): v is Tree {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function flatten(tree: Tree, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix === '' ? k : `${prefix}.${k}`;
    if (typeof v === 'string') out[path] = v;
    else if (isTree(v)) flatten(v, path, out);
  }
  return out;
}

function walk(dir: string, filter: (p: string) => boolean, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, filter, acc);
    else if (filter(full)) acc.push(full);
  }
  return acc;
}

function loadLocale(code: string): Record<string, string> {
  const files = walk(join(LOCALES_DIR, code), (p) => p.endsWith('.json'));
  const out: Record<string, string> = {};
  for (const file of files.sort()) {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!isTree(parsed)) throw new Error(`${relative(ROOT, file)}: top level must be an object`);
    for (const [k, v] of Object.entries(flatten(parsed))) {
      if (k in out) problems.push(`${code}: duplicate key "${k}" (last seen in ${relative(ROOT, file)})`);
      out[k] = v;
    }
  }
  return out;
}

const problems: string[] = [];
const baseKey = (k: string): string => k.replace(PLURAL_SUFFIX, '');

const locales = readdirSync(LOCALES_DIR).filter((d) => statSync(join(LOCALES_DIR, d)).isDirectory());
if (!locales.includes(BASE)) throw new Error(`missing base locale "${BASE}"`);
const en = loadLocale(BASE);
const enBases = new Set(Object.keys(en).map(baseKey));

for (const code of locales) {
  if (code === BASE) continue;
  const messages = loadLocale(code);
  const bases = new Set(Object.keys(messages).map(baseKey));
  for (const k of enBases) if (!bases.has(k)) problems.push(`${code}: missing "${k}"`);
  for (const k of bases) if (!enBases.has(k)) problems.push(`${code}: extra key "${k}" (not in ${BASE})`);
  for (const [k, v] of Object.entries(messages)) {
    const enValue = en[k] ?? en[`${baseKey(k)}_other`] ?? en[baseKey(k)];
    if (enValue === undefined) continue;
    const want = new Set(enValue.match(/\{\w+\}/g) ?? []);
    const have = new Set(v.match(/\{\w+\}/g) ?? []);
    for (const ph of want) if (!have.has(ph)) problems.push(`${code}: "${k}" lacks placeholder ${ph}`);
  }
}

// References from source: literal `t('…')` calls must resolve; for the
// "unused" check any quoted string equal to a key counts (label maps store
// keys in data, e.g. `labelKey: 'editor.toolbar.select'`), as does any
// template prefix `t(\`ns.sub.${…}\`)`.
const sources = walk(SRC_DIR, (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith('.test.ts') && !p.includes('/i18n/'));
const used = new Set<string>();
const templatePrefixes: string[] = [];
const callRe = /\bt\(\s*(['"])([^'"$]+?)\1/g;
const literalRe = /(['"`])([A-Za-z][\w.]*)\1/g;
const templateRe = /\bt\(\s*`([\w.]+\.)\$\{/g;
for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(callRe)) {
    const key = m[2];
    if (key === undefined) continue;
    if (!enBases.has(key) && !(key in en)) problems.push(`${relative(ROOT, file)}: t('${key}') has no ${BASE} string`);
  }
  for (const m of text.matchAll(literalRe)) {
    const key = m[2];
    if (key !== undefined && enBases.has(key)) used.add(key);
  }
  for (const m of text.matchAll(templateRe)) {
    const prefix = m[1];
    if (prefix !== undefined) templatePrefixes.push(prefix);
  }
}
for (const k of enBases) {
  if (used.has(k)) continue;
  if (DYNAMIC_PREFIXES.some((p) => k.startsWith(p))) continue;
  if (templatePrefixes.some((p) => k.startsWith(p))) continue;
  problems.push(`${BASE}: "${k}" is never referenced from client/src`);
}

if (problems.length > 0) {
  console.error(`[check-i18n] ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`[check-i18n] OK — ${locales.length} locale(s), ${enBases.size} keys, ${used.size} referenced.`);
