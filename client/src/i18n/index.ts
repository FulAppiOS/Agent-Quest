import { useSyncExternalStore } from 'react';
import { eventBridge } from '../game/EventBridge';
import enCommon from './locales/en/common.json';
import enDetail from './locales/en/detail.json';
import enEditor from './locales/en/editor.json';
import enFeed from './locales/en/feed.json';
import enShell from './locales/en/shell.json';
import koCommon from './locales/ko/common.json';
import koDetail from './locales/ko/detail.json';
import koEditor from './locales/ko/editor.json';
import koFeed from './locales/ko/feed.json';
import koShell from './locales/ko/shell.json';

/**
 * Minimal JSON-driven i18n.
 *
 * - Built-in locales live in `./locales/<code>/*.json` and are registered in
 *   the fragment tables below. Every file is a nested object whose top-level
 *   keys are namespaces (`topbar`, `settings`, …); all files of one locale
 *   are deep-merged, then flattened to dotted keys (`topbar.status`). English is the base: any key missing from the
 *   active locale falls back to the English string, and a key missing from
 *   English renders as the key itself so it is easy to spot.
 * - A user-supplied JSON file with the same shape can be installed at
 *   runtime as the `custom` locale (see `parseCustomLocale`). It is kept in
 *   localStorage together with the selected locale id.
 * - `t()` interpolates `{name}` placeholders and supports plural variants
 *   via `key_one` / `key_other` (…any Intl.PluralRules category) chosen from
 *   `params.count`.
 * - React components call `useI18n()` so they re-render on locale change;
 *   Phaser code calls `t()` directly and listens for `i18n:changed` on the
 *   event bridge to refresh labels it has already drawn.
 */

import { flatten, isTree, mergeTrees, type FlatMessages, type MessageTree } from './messages';

export { flatten, mergeTrees } from './messages';
export type { FlatMessages, MessageTree } from './messages';
export type BuiltinLocaleId = 'en' | 'ko';
export type LocaleId = BuiltinLocaleId | 'custom';

export interface LocaleOption {
  id: LocaleId;
  /** Display name, taken from the locale's own `meta.name`. */
  name: string;
  /** BCP 47 tag used for `<html lang>` and plural rules. */
  code: string;
}

export interface CustomLocale {
  name: string;
  code: string;
  messages: FlatMessages;
}

export interface CustomLocaleReport {
  name: string;
  code: string;
  /** Number of translatable keys in the English base (excluding `meta.*`). */
  total: number;
  /** Keys of the base that the file provides. */
  matched: number;
  /** Base keys the file lacks — these fall back to English. */
  missing: string[];
  /** Keys in the file that the base doesn't know — ignored. */
  unknown: string[];
}

export type CustomLocaleError = 'invalid-json' | 'not-object' | 'no-strings';

const LOCALE_STORAGE_KEY = 'agent-quest.i18n.locale';
const CUSTOM_STORAGE_KEY = 'agent-quest.i18n.custom';
export const I18N_CHANGED_EVENT = 'i18n:changed';

// ---------------------------------------------------------------------------
// Built-in message tables
// ---------------------------------------------------------------------------

// Fragments are listed explicitly (rather than via import.meta.glob) so the
// module also loads under plain Bun/Node, where unit tests run.
const enFragments: Record<string, MessageTree> = {
  common: enCommon as MessageTree,
  detail: enDetail as MessageTree,
  editor: enEditor as MessageTree,
  feed: enFeed as MessageTree,
  shell: enShell as MessageTree,
};
const koFragments: Record<string, MessageTree> = {
  common: koCommon as MessageTree,
  detail: koDetail as MessageTree,
  editor: koEditor as MessageTree,
  feed: koFeed as MessageTree,
  shell: koShell as MessageTree,
};

function buildTree(fragments: Record<string, MessageTree>): MessageTree {
  // Sort by path so merge order (and therefore "last one wins") is stable.
  let tree: MessageTree = {};
  for (const path of Object.keys(fragments).sort()) {
    const fragment = fragments[path];
    if (fragment !== undefined) tree = mergeTrees(tree, fragment);
  }
  return tree;
}

const EN_TREE = buildTree(enFragments);
const KO_TREE = buildTree(koFragments);
const EN = flatten(EN_TREE);
const KO = flatten(KO_TREE);
const BUILTIN: Record<BuiltinLocaleId, FlatMessages> = { en: EN, ko: KO };

/** Translatable keys of the base locale (everything except `meta.*`). */
const BASE_KEYS: ReadonlySet<string> = new Set(Object.keys(EN).filter((k) => !k.startsWith('meta.')));

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function readLocaleId(): LocaleId {
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (raw === 'en' || raw === 'ko' || raw === 'custom') return raw;
  } catch {
    // storage unavailable (private mode, blocked) — fall through
  }
  return 'en';
}

function readCustomLocale(): CustomLocale | null {
  try {
    const raw = window.localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isTree(parsed)) return null;
    const name = typeof parsed['name'] === 'string' ? parsed['name'] : 'Custom';
    const code = typeof parsed['code'] === 'string' ? parsed['code'] : 'en';
    const messages = isTree(parsed['messages']) ? flatten(parsed['messages']) : null;
    if (messages === null) return null;
    return { name, code, messages };
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore — the choice simply won't survive a reload
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const hasWindow = typeof window !== 'undefined';
let custom: CustomLocale | null = hasWindow ? readCustomLocale() : null;
let locale: LocaleId = hasWindow ? readLocaleId() : 'en';
if (locale === 'custom' && custom === null) locale = 'en';

let version = 0;
const listeners = new Set<() => void>();

function activeMessages(): FlatMessages {
  if (locale === 'custom') return custom?.messages ?? EN;
  return BUILTIN[locale];
}

function activeCode(): string {
  if (locale === 'custom') return custom?.code ?? 'en';
  return BUILTIN[locale]['meta.code'] ?? locale;
}

function applyDocumentLang(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = activeCode();
}

function bump(): void {
  version += 1;
  applyDocumentLang();
  for (const listener of listeners) listener();
  eventBridge.emit(I18N_CHANGED_EVENT, locale);
}

applyDocumentLang();

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

const pluralRulesCache = new Map<string, Intl.PluralRules | null>();

function pluralCategory(code: string, count: number): Intl.LDMLPluralRule {
  let rules = pluralRulesCache.get(code);
  if (rules === undefined) {
    try {
      rules = new Intl.PluralRules(code);
    } catch {
      rules = null;
    }
    pluralRulesCache.set(code, rules);
  }
  return rules === null ? (count === 1 ? 'one' : 'other') : rules.select(count);
}

function interpolate(template: string, params: Record<string, string | number> | undefined): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** True when the active locale or the English base knows `key`. */
export function hasMessage(key: string): boolean {
  return key in activeMessages() || key in EN;
}

/**
 * Translate `key`, interpolating `{placeholders}` from `params`. When
 * `params.count` is a number, `key_<pluralCategory>` / `key_other` are tried
 * before the bare key.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const messages = activeMessages();
  let template: string | undefined;
  const count = params?.['count'];
  if (typeof count === 'number') {
    const category = pluralCategory(activeCode(), count);
    template =
      messages[`${key}_${category}`] ??
      messages[`${key}_other`] ??
      EN[`${key}_${pluralCategory('en', count)}`] ??
      EN[`${key}_other`];
  }
  template ??= messages[key] ?? EN[key] ?? key;
  return interpolate(template, params);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getLocale(): LocaleId {
  return locale;
}

export function getCustomLocale(): CustomLocale | null {
  return custom;
}

export function localeOptions(): LocaleOption[] {
  const options: LocaleOption[] = [
    { id: 'en', name: EN['meta.name'] ?? 'English', code: EN['meta.code'] ?? 'en' },
    { id: 'ko', name: KO['meta.name'] ?? '한국어', code: KO['meta.code'] ?? 'ko' },
  ];
  if (custom !== null) options.push({ id: 'custom', name: custom.name, code: custom.code });
  return options;
}

export function setLocale(next: LocaleId): void {
  if (next === 'custom' && custom === null) return;
  if (next === locale) return;
  locale = next;
  writeStorage(LOCALE_STORAGE_KEY, locale);
  bump();
}

/**
 * Parse a user-supplied locale file. Accepts the nested shape of the
 * English template (optionally with `meta.name` / `meta.code`) or an object
 * of already-dotted keys. Throws a `CustomLocaleError` code on bad input.
 */
export function parseCustomLocale(raw: string): { locale: CustomLocale; report: CustomLocaleReport } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('invalid-json' satisfies CustomLocaleError);
  }
  if (!isTree(parsed)) throw new Error('not-object' satisfies CustomLocaleError);

  const flat = flatten(parsed);
  const name = typeof flat['meta.name'] === 'string' && flat['meta.name'] !== '' ? flat['meta.name'] : 'Custom';
  const code = typeof flat['meta.code'] === 'string' && flat['meta.code'] !== '' ? flat['meta.code'] : 'en';

  const messages: FlatMessages = {};
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(flat)) {
    if (key.startsWith('meta.')) continue;
    // Plural variants (`key_one`) are valid when their base key is known.
    const base = key.replace(/_(zero|one|two|few|many|other)$/, '');
    if (BASE_KEYS.has(key) || BASE_KEYS.has(base)) messages[key] = value;
    else unknown.push(key);
  }
  const matchedKeys = new Set(Object.keys(messages).map((k) => k.replace(/_(zero|one|two|few|many|other)$/, '')));
  const missing = [...BASE_KEYS].filter((k) => !matchedKeys.has(k) && !matchedKeys.has(k.replace(/_(zero|one|two|few|many|other)$/, '')));
  if (matchedKeys.size === 0) throw new Error('no-strings' satisfies CustomLocaleError);

  return {
    locale: { name, code, messages },
    report: { name, code, total: BASE_KEYS.size, matched: matchedKeys.size, missing, unknown },
  };
}

/** Store a custom locale and switch to it. */
export function installCustomLocale(next: CustomLocale): void {
  custom = next;
  writeStorage(CUSTOM_STORAGE_KEY, JSON.stringify(next));
  locale = 'custom';
  writeStorage(LOCALE_STORAGE_KEY, locale);
  bump();
}

/** Forget the custom locale; falls back to English if it was active. */
export function removeCustomLocale(): void {
  custom = null;
  writeStorage(CUSTOM_STORAGE_KEY, null);
  if (locale === 'custom') {
    locale = 'en';
    writeStorage(LOCALE_STORAGE_KEY, locale);
  }
  bump();
}

/** Pretty-printed English base, ready to be translated and re-uploaded. */
export function englishTemplate(): string {
  return JSON.stringify(EN_TREE, null, 2);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

/** React hook: re-renders the caller whenever the locale changes. */
export function useI18n(): { t: typeof t; locale: LocaleId; code: string } {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return { t, locale, code: activeCode() };
}
